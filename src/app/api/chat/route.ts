import { NextResponse } from "next/server";
import { callChat } from "@/lib/llm";
import type { ChatErrorCode, ChatMessage, ChatResult, ChatRole } from "@/lib/types";

/**
 * Next 16 notes:
 * - 本项目启用了 cacheComponents，按官方文档不能导出 `runtime`（Edge 已废弃，默认就是 nodejs）
 * - `maxDuration` 仅作为部署平台的执行上限提示
 */
export const maxDuration = 60;

const STATUS_OF: Record<ChatErrorCode, number> = {
  MISSING_KEY: 500,
  BAD_REQUEST: 400,
  RATE_LIMIT: 429,
  TIMEOUT: 504,
  UPSTREAM: 502,
  UNKNOWN: 500,
};

const ROLES: readonly ChatRole[] = ["system", "user", "assistant"];

/**
 * 统一出口：显式声明 charset=utf-8。
 * 少了 charset，Windows PowerShell 5.1 会按 ISO-8859-1 解码，中文全变乱码。
 * no-store：对话结果不该被任何缓存层留住。
 */
function json(body: ChatResult, status: number): Response {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fail(
  code: ChatErrorCode,
  message: string,
  traceId: string,
  latencyMs = 0,
): Response {
  const body: ChatResult = { ok: false, code, message, latencyMs, traceId };
  return json(body, STATUS_OF[code]);
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("BAD_REQUEST", "请求体不是合法 JSON", traceId);
  }

  const body = (payload ?? {}) as { message?: unknown; messages?: unknown };

  let messages: ChatMessage[];
  if (typeof body.message === "string" && body.message.trim()) {
    messages = [{ role: "user", content: body.message }];
  } else if (Array.isArray(body.messages) && body.messages.every(isChatMessage)) {
    messages = body.messages;
  } else {
    return fail(
      "BAD_REQUEST",
      '需要 { "message": "..." } 或 { "messages": [{ "role": "user", "content": "..." }] }',
      traceId,
    );
  }

  if (messages.length === 0) {
    return fail("BAD_REQUEST", "messages 不能为空", traceId);
  }

  const result = await callChat(messages, traceId);
  return json(result, result.ok ? 200 : STATUS_OF[result.code]);
}

/** 只开放 POST，其余方法统一 405 */
export async function GET() {
  const body: ChatResult = {
    ok: false,
    code: "BAD_REQUEST",
    message: "只支持 POST",
    latencyMs: 0,
    traceId: "-",
  };
  return json(body, 405);
}
