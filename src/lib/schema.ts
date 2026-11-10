import { z } from "zod";

/**
 * D3 · 结构化输出的 schema 定义
 *
 * 为什么用 zod 而不是只靠 Prompt 要求模型「输出 JSON」：
 * 模型不是 JSON 编译器，它只是「尽量像 JSON」。线上一定会遇到：
 *   - 多包了一层 ```json 代码块
 *   - 字符串里带未转义的换行
 *   - 字段名大小写不一致
 *   - 该给数字给了 "3 年"
 * 所以必须「Prompt 约束 + 程序校验 + 失败重试」三件套。
 */

/** 从一段自由文本里抽出的候选人画像（也为 D6 的简历解析铺路） */
export const CandidateSchema = z.object({
  name: z.string().nullable().describe("姓名，没提到就 null"),
  yearsOfExperience: z
    .number()
    .nullable()
    .describe("工作年限，纯数字，比如 2；不确定就 null"),
  currentTitle: z.string().nullable().describe("当前职位"),
  targetRole: z.string().nullable().describe("期望岗位"),
  city: z.string().nullable().describe("目标城市"),
  skills: z.array(z.string()).describe("技能关键词，没有就给空数组"),
  summary: z.string().describe("一句话概括这个人，不超过 40 字"),
});

export type Candidate = z.infer<typeof CandidateSchema>;

/**
 * 把 zod schema 转成「给模型看的字段说明」。
 * 手写这段容易和 schema 脱节，所以从 schema 里读 description 自动生成。
 */
export function describeSchema(schema: z.ZodObject<z.ZodRawShape>): string {
  return Object.entries(schema.shape)
    .map(([key, value]) => {
      const desc = (value as { description?: string }).description ?? "";
      const type = (value as { type?: string }).type ?? "unknown";
      return `- ${key} (${type}): ${desc}`;
    })
    .join("\n");
}
