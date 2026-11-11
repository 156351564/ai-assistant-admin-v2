import { client, llmConfig } from "@/lib/llm";
import type { ChatMessage, ChatRole } from "@/lib/types";
import { readCacheTokens } from "@/lib/cost";
import { appendMessage, createSession, recordUsage } from "@/lib/store";

/**
 * D2 · 流式对话（SSE）
 *
 * 设计要点（面试会被追问的四个地方，都写在这里）：
 * 1. 为什么用 SSE 不用 WebSocket —— 对话是单向下行流，HTTP 原生、网关/日志/鉴权能复用
 * 2. 为什么不用 EventSource —— 它只能 GET、不能带 body 和自定义 header
 * 3. 帧格式自己定 —— event: delta / done / error，前端按 type 分流，不靠"连接断了"猜结束
 * 4. 中断要传到上游 —— request.signal abort 时把 SDK 的流也 abort，否则用户点了停止还在烧钱
 */
export const maxDuration = 60;

const ROLES: readonly ChatRole[] = ["system", "user", "assistant"];

const HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  // no-transform：告诉中间层（CDN / 反向代理）不要压缩或改写，否则流会被缓冲住
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // nginx 专用：关掉 proxy_buffering，不然前端要等缓冲满才收到
  "x-accel-buffering": "no",
};

/** 一帧 SSE：`event: 名字` + `data: JSON` + 空行分隔 */
type FrameEvent = "start" | "delta" | "usage" | "done" | "error";

function frame(event: FrameEvent, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.content === "string" &&
    typeof m.role === "string" &&
    ROLES.includes(m.role as ChatRole)
  );
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "BAD_REQUEST",
        message: "非法 JSON",
        traceId,
      }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  const body = (payload ?? {}) as { message?: unknown; messages?: unknown };
  let messages: ChatMessage[];
  if (typeof body.message === "string" && body.message.trim()) {
    messages = [{ role: "user", content: body.message }];
  } else if (
    Array.isArray(body.messages) &&
    body.messages.every(isChatMessage)
  ) {
    messages = body.messages;
  } else {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "BAD_REQUEST",
        message: "需要 message 或 messages",
        traceId,
      }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  if (!llmConfig.apiKey || !llmConfig.baseURL || !llmConfig.model) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: "MISSING_KEY",
        message: "环境变量缺失",
        traceId,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );  }

  const encoder = new TextEncoder();
  let firstTokenAt: number | null = null;
  /** 客户端主动断开（点停止 / 关页面）后置位，之后禁止再往 controller 写 */
  let clientGone = false;
  /** 生成耗时里程碑，客户端提前断开时也要能打日志 */
  let ttftMs: number | null = null;
  /** 累积完整回答，流结束后一次性落库 */
  let acc = "";
  /** 流式下的 usage 只在最后一块出现，先存下来 */
  let usageTokens: { hit: number; miss: number; output: number } | null = null;

  // 会话记录：标题取最后一条用户消息
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const session = createSession(lastUser?.content ?? "新对话", llmConfig.model);
  if (lastUser) {
    appendMessage(session.id, { role: "user", content: lastUser.content });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let controllerClosed = false;

      /**
       * 写一帧，并且容错。
       *
       * 踩过的坑：客户端断开后，ReadableStream 的 controller 已被取消，
       * 此时再 enqueue 会抛 "Invalid state: Controller is already closed"。
       * 这个异常会冒到 catch 里被当成业务错误打日志，掩盖真正的问题。
       * 所以：写之前查标记，写的时候吞掉异常。
       */
      const send = (event: FrameEvent, data: unknown) => {
        if (controllerClosed || clientGone) return;
        try {
          controller.enqueue(encoder.encode(frame(event, data)));
        } catch {
          controllerClosed = true;
        }
      };

      send("start", { traceId, model: llmConfig.model });

      try {
        // stream: true 后 SDK 返回的是 AsyncIterable，可以直接 for await
        // 注意：request.signal 一旦 abort（用户关页面 / 点停止），这里会抛出，上游连接随之断开
        const upstream = await client.chat.completions.create(
          {
            model: llmConfig.model,
            messages,
            max_tokens: llmConfig.maxTokens,
            stream: true,
            // 拿流式下的 usage（DeepSeek 支持；某些供应商会报 400，报错就删掉）
            stream_options: { include_usage: true },
          },
          { signal: request.signal },
        );

        for await (const chunk of upstream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) {
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();
              ttftMs = firstTokenAt - startedAt;
            }
            acc += text;
            // 一帧一个 delta，前端收到就追加
            send("delta", { text });
          }
          // usage 只有在 include_usage 打开时才会出现在最后一块
          if (chunk.usage) {
            const cache = readCacheTokens(chunk.usage);
            usageTokens = {
              hit: cache.hit,
              miss: cache.miss,
              output: chunk.usage.completion_tokens ?? 0,
            };
            send("usage", {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
            });
          }
        }

        const totalMs = Date.now() - startedAt;
        console.log(
          `[chat:stream] trace=${traceId} model=${llmConfig.model} ttft=${ttftMs}ms total=${totalMs}ms${clientGone ? " (client gone)" : ""}`,
        );

        // 落库：即使客户端断开，已生成的内容也要留下（否则后台看不到这次对话）
        const tokens = usageTokens ?? {
          hit: 0,
          miss: Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) * 1.2),
          output: Math.ceil(acc.length * 1.2),
        };
        const costYuan = recordUsage(
          { inputMissTokens: tokens.miss, inputHitTokens: tokens.hit, outputTokens: tokens.output },
          totalMs,
        );
        appendMessage(session.id, {
          role: "assistant",
          content: acc,
          latencyMs: totalMs,
          ttftMs: ttftMs ?? undefined,
          promptTokens: tokens.miss + tokens.hit,
          completionTokens: tokens.output,
          costYuan,
        });

        send("done", { traceId, ttftMs, totalMs, sessionId: session.id });
      } catch (err) {
        const name = err instanceof Error ? err.name : "Unknown";
        // 客户端主动断开不是错误，不要报给前端
        if (name === "AbortError" || clientGone) {
          console.log(
            `[chat:stream] trace=${traceId} aborted by client after ${Date.now() - startedAt}ms (ttft=${ttftMs}ms)`,
          );
        } else {
          const msg =
            err instanceof Error ? err.message.slice(0, 200) : "未知错误";
          console.error(`[chat:stream] trace=${traceId} error=${msg}`);
          send("error", { code: "UPSTREAM", message: msg, traceId });
        }
      } finally {
        if (!controllerClosed) {
          try {
            controller.close();
          } catch {
            // 已被取消，忽略
          }
          controllerClosed = true;
        }
      }
    },
    cancel() {
      // 客户端取消订阅（停止 / 离开页面）时触发
      clientGone = true;
    },
  });

  return new Response(stream, { headers: HEADERS });
}

export async function GET() {
  return new Response(
    JSON.stringify({
      ok: false,
      code: "BAD_REQUEST",
      message: "只支持 POST",
      traceId: "-",
    }),
    {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
