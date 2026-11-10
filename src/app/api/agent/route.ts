import type OpenAI from "openai";
import { NextResponse } from "next/server";
import { client, llmConfig } from "@/lib/llm";
import { executeTool, toolDefinitions, TOOL_LABELS } from "@/lib/tools";

/**
 * D3 · Function Calling 完整链路
 *
 * 一次用户提问，背后可能是 1~N 次模型调用。循环的核心是三件事：
 *   1. 把 assistant 的回复（含 tool_calls）push 回 messages
 *   2. 执行工具，把结果以 role:"tool" push 回去
 *   3. 再调一次模型，直到它不再要工具
 */
export const maxDuration = 60;

/** 防死循环：模型理论上可能一直调工具 */
const MAX_ROUNDS = 5;

const SYSTEM = `你是一个电商客服助手。

规则：
1. 需要查订单、查时间时，调用提供的工具，不要凭空编造数据。
2. 一次只回答用户问的事，不要说多余的客套话。
3. 查「预计送达时间」前必须先确认订单已发货；如果未发货，直接说明情况，不要调用 ETA 工具。
4. 工具返回错误时，用自然语言告诉用户该怎么做，不要暴露内部错误码或 JSON。`;

interface Step {
  round: number;
  tool: string;
  label: string;
  args: unknown;
  ok: boolean;
  result: string;
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  // ---------- 1. 入参校验 ----------
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "请求体不是合法 JSON", traceId },
      { status: 400 },
    );
  }

  const userInput = (payload as { message?: unknown })?.message;
  if (typeof userInput !== "string" || !userInput.trim()) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "需要 { message: string }", traceId },
      { status: 400 },
    );
  }

  // ---------- 2. 准备消息数组 ----------
  // 这个数组就是「模型的全部记忆」。模型本身无状态，每次都要把整段历史发过去。
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userInput },
  ];

  const steps: Step[] = [];
  let rounds = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    // ---------- 3. 循环：调模型 → 要不要工具？→ 执行并回填 ----------
    while (rounds < MAX_ROUNDS) {
      rounds++;

      const res = await client.chat.completions.create({
        model: llmConfig.model,
        messages,
        tools: toolDefinitions, // 给模型的「工具说明书」
        tool_choice: "auto", // auto = 模型自己决定要不要用
        temperature: 0.2, // 客服场景要稳，别发散
        max_tokens: llmConfig.maxTokens,
      });

      // 累计 token：每一轮的 input 都要重新发一遍历史，所以是累加不是取最后一次
      promptTokens += res.usage?.prompt_tokens ?? 0;
      completionTokens += res.usage?.completion_tokens ?? 0;

      const msg = res.choices[0]?.message;
      if (!msg) {
        return NextResponse.json(
          { ok: false, code: "UPSTREAM", message: "模型没有返回 message", traceId },
          { status: 502 },
        );
      }

      // ★ 关键：assistant 消息必须原样进历史（里面有 tool_calls）
      //   漏了这一步，下一轮把工具结果回填时会报 400：
      //   "messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
      messages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls,
      });

      const calls = msg.tool_calls ?? [];

      // 没有工具调用 → 这就是最终答案
      if (calls.length === 0) {
        const latencyMs = Date.now() - startedAt;
        console.log(
          `[agent] trace=${traceId} rounds=${rounds} tools=${steps.length} ms=${latencyMs} in=${promptTokens} out=${completionTokens}`,
        );
        return NextResponse.json({
          ok: true,
          answer: msg.content ?? "",
          steps,
          meta: {
            rounds,
            toolCalls: steps.length,
            latencyMs,
            promptTokens,
            completionTokens,
            traceId,
          },
        });
      }

      // 有工具调用 → 逐个执行，结果回填
      for (const call of calls) {
        // SDK v7 的 tool_calls 是联合类型：function（普通工具）和 custom（自定义工具）。
        // 本项目只用普通工具，custom 直接跳过。
        if (call.type !== "function") continue;

        const name = call.function.name;
        const rawArgs = call.function.arguments; // 注意：这是字符串，不是对象

        // 仅用于展示/日志，真正的解析和校验在 executeTool 里
        let parsedArgs: unknown = rawArgs;
        try {
          parsedArgs = JSON.parse(rawArgs || "{}");
        } catch {
          parsedArgs = rawArgs;
        }

        const result = await executeTool(name, rawArgs);

        steps.push({
          round: rounds,
          tool: name,
          label: TOOL_LABELS[name] ?? name,
          args: parsedArgs,
          ok: result.ok,
          result: result.content,
        });

        // ★ 回填：tool_call_id 必须和上面那个 call.id 对应
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.content,
        });
      }
      // 循环继续：带着工具结果再问一次模型
    }

    // ---------- 4. 轮数用尽 ----------
    console.warn(`[agent] trace=${traceId} 超过最大轮数 ${MAX_ROUNDS}`);
    return NextResponse.json(
      {
        ok: false,
        code: "TOO_MANY_ROUNDS",
        message: `工具调用次数超过 ${MAX_ROUNDS} 轮，已中止`,
        steps,
        traceId,
      },
      { status: 508 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "未知错误";
    console.error(`[agent] trace=${traceId} error=${msg}`);
    return NextResponse.json(
      { ok: false, code: "UPSTREAM", message: msg, steps, traceId },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, code: "BAD_REQUEST", message: "只支持 POST", traceId: "-" },
    { status: 405 },
  );
}
