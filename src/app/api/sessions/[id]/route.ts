import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";

/**
 * GET /api/sessions/{id} —— 会话详情（含全部消息）
 *
 * Next 16 注意：动态路由的 params 是 Promise，必须 await。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);

  if (!session) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "会话不存在（内存版重启后会丢失）" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { ok: true, data: session },
    { headers: { "cache-control": "no-store" } },
  );
}
