import { NextResponse } from "next/server";
import { listSessions } from "@/lib/store";

/** GET /api/sessions?page=1&size=20 —— 会话列表（不含消息正文） */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const size = Math.min(50, Math.max(1, Number(url.searchParams.get("size") ?? 20)));

  return NextResponse.json(
    { ok: true, data: await listSessions(page, size) },
    { headers: { "cache-control": "no-store" } },
  );
}
