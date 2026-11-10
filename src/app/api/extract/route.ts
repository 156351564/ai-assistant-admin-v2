import { NextResponse } from "next/server";
import { callJson } from "@/lib/structured";
import { CandidateSchema, describeSchema } from "@/lib/schema";

/**
 * D3 · 结构化输出示例接口
 *
 * POST { "text": "我叫陈卓，25 岁，2 年前端…" }
 * → { ok: true, data: { name, yearsOfExperience, targetRole, skills, summary } }
 *
 * 这个接口不只是练习：D6 做「投递跟踪」时，把 JD 文本或简历文本喂进来，
 * 就能自动结构化，直接复用。
 */
export const maxDuration = 60;

const SYSTEM = `你是一个信息抽取器。从用户给出的文本里抽取字段，严格按下面的字段说明输出 JSON。
规则：
1. 只输出 JSON，不要任何解释、不要 markdown 代码块。
2. 没有提到的字段用 null；数组类字段没有内容就用空数组。
3. 数字字段必须是数字类型，不要带单位。
4. 不要臆造文本里没有的信息。

字段说明：
${describeSchema(CandidateSchema)}`;

export async function POST(request: Request) {
  const traceId = crypto.randomUUID().slice(0, 8);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "请求体不是合法 JSON", traceId },
      { status: 400 },
    );
  }

  const text = (payload as { text?: unknown })?.text;
  if (typeof text !== "string" || text.trim().length < 5) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "需要 { text: string }，且不少于 5 个字", traceId },
      { status: 400 },
    );
  }

  const result = await callJson({
    system: SYSTEM,
    user: text,
    schema: CandidateSchema,
    traceId,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "SCHEMA_INVALID",
        message: result.error ?? "模型输出未通过校验",
        attempts: result.attempts,
        raw: result.raw,
        traceId,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result.data,
    meta: {
      attempts: result.attempts,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      traceId,
    },
  });
}
