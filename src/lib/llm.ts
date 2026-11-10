import OpenAI from "openai";
import type { ChatErrorCode, ChatMessage, ChatResult, ChatUsage } from "./types";

/**
 * 供应商配置全部走环境变量。
 * 切供应商 / 加降级时只改 .env.local，不碰业务代码。
 */
export const llmConfig = {
  baseURL: process.env.OPENAI_BASE_URL ?? "",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  model: process.env.OPENAI_MODEL ?? "",
  maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1024),
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60_000),
};

/** 留出参数，D3 做「主备降级」时用它 new 出备用 client */
export function createClient(baseURL = llmConfig.baseURL, apiKey = llmConfig.apiKey) {
  return new OpenAI({ baseURL, apiKey });
}

export const client = createClient();

function normalizeUsage(usage: OpenAI.CompletionUsage | undefined): ChatUsage {
  // reasoning_tokens 不是 OpenAI 标准字段，各家的命名位置略有差异，这里做兼容兜底
  const raw = usage as
    | (OpenAI.CompletionUsage & {
        completion_tokens_details?: { reasoning_tokens?: number };
        reasoning_tokens?: number;
      })
    | undefined;

  const reasoning =
    raw?.completion_tokens_details?.reasoning_tokens ?? raw?.reasoning_tokens ?? 0;

  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    reasoningTokens: reasoning,
  };
}

function mapError(err: unknown): { code: ChatErrorCode; message: string } {
  if (err instanceof OpenAI.APIError) {
    const detail = err.message.slice(0, 200);
    if (err.status === 429) return { code: "RATE_LIMIT", message: `上游限流：${detail}` };
    if (typeof err.status === "number" && err.status >= 500) {
      return { code: "UPSTREAM", message: `上游异常 ${err.status}：${detail}` };
    }
    return { code: "BAD_REQUEST", message: `请求被拒绝 ${err.status ?? ""}：${detail}` };
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "APIUserAbortError") {
      return { code: "TIMEOUT", message: `请求超时（>${llmConfig.timeoutMs}ms）` };
    }
    return { code: "UNKNOWN", message: err.message.slice(0, 200) };
  }
  return { code: "UNKNOWN", message: "未知错误" };
}

/**
 * 一次对话调用。永不抛错，统一返回 ChatResult（可判别联合）。
 * D2 会在这个文件旁边新增 callChatStream()，不要改坏这个。
 */
export async function callChat(messages: ChatMessage[], traceId = "-"): Promise<ChatResult> {
  const startedAt = Date.now();

  if (!llmConfig.apiKey || !llmConfig.baseURL || !llmConfig.model) {
    return {
      ok: false,
      code: "MISSING_KEY",
      message: "环境变量缺失：需要 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL",
      latencyMs: 0,
      traceId,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llmConfig.timeoutMs);

  try {
    const res = await client.chat.completions.create(
      {
        model: llmConfig.model,
        messages,
        max_tokens: llmConfig.maxTokens,
        stream: false,
      },
      { signal: controller.signal },
    );

    const usage = normalizeUsage(res.usage);
    const content = res.choices[0]?.message?.content ?? "";
    const latencyMs = Date.now() - startedAt;

    console.log(
      `[chat] trace=${traceId} model=${res.model} ms=${latencyMs} in=${usage.promptTokens} out=${usage.completionTokens} think=${usage.reasoningTokens}`,
    );

    return { ok: true, content, usage, latencyMs, traceId, model: res.model };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const { code, message } = mapError(err);
    console.error(`[chat] trace=${traceId} fail=${code} ms=${latencyMs} msg=${message}`);
    return { ok: false, code, message, latencyMs, traceId };
  } finally {
    clearTimeout(timer);
  }
}
