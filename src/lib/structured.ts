import type { z } from "zod";
import { client, llmConfig } from "./llm";

/**
 * 带校验和重试的结构化调用
 *
 * 流程：调模型 → 剥掉代码块围栏 → JSON.parse → zod 校验
 *      → 失败就把「哪里错了」告诉模型，重试一次
 *
 * 为什么重试时要把错误回传给模型：
 * 只重试不告诉它错在哪，等于让它再随机猜一次；把 zod 的报错原文喂回去，
 * 第二次的成功率会明显提高。这是结构化输出最实用的一招。
 */

export interface JsonCallResult<T> {
  ok: boolean;
  data?: T;
  /** 模型最后一次返回的原始文本，排查用 */
  raw?: string;
  attempts: number;
  error?: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

/** 模型经常把 JSON 包在 ```json ... ``` 里，这里剥掉 */
function stripFence(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : t;
}

export async function callJson<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxAttempts?: number;
  traceId?: string;
}): Promise<JsonCallResult<T>> {
  const { system, user, schema, maxAttempts = 2, traceId = "-" } = opts;
  const startedAt = Date.now();

  let promptTokens = 0;
  let completionTokens = 0;
  let lastRaw = "";
  let lastError = "";

  // 对话历史：第一次是原始问题，重试时追加「你上次错了，错在这」
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: llmConfig.model,
        messages,
        max_tokens: llmConfig.maxTokens,
        temperature: 0,
        // 要求供应商返回合法 JSON（DeepSeek 支持；不支持的话删掉这行，靠 prompt + zod 兜底）
        response_format: { type: "json_object" },
      });

      promptTokens += res.usage?.prompt_tokens ?? 0;
      completionTokens += res.usage?.completion_tokens ?? 0;

      lastRaw = res.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(stripFence(lastRaw));
      const checked = schema.safeParse(parsed);

      if (checked.success) {
        const latencyMs = Date.now() - startedAt;
        console.log(
          `[json] trace=${traceId} ok attempt=${attempt} ms=${latencyMs} in=${promptTokens} out=${completionTokens}`,
        );
        return {
          ok: true,
          data: checked.data,
          raw: lastRaw,
          attempts: attempt,
          latencyMs,
          promptTokens,
          completionTokens,
        };
      }

      // 校验失败：把具体的字段错误回传给模型
      lastError = checked.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 200) : "未知错误";
    }

    console.warn(
      `[json] trace=${traceId} attempt=${attempt} failed: ${lastError}`,
    );

    // 把失败的输出和错误一起喂回去，让模型自我修正
    messages.push({ role: "assistant", content: lastRaw || "(空)" });
    messages.push({
      role: "user",
      content: `上面的输出不符合要求，问题：${lastError}。请只输出修正后的 JSON，不要任何解释和代码块。`,
    });
  }

  return {
    ok: false,
    raw: lastRaw,
    attempts: maxAttempts,
    error: lastError,
    latencyMs: Date.now() - startedAt,
    promptTokens,
    completionTokens,
  };
}
