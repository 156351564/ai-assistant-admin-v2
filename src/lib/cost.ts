/**
 * D3 · 成本核算
 *
 * 单价来源：2026-11-10 的真实账单导出（`amount-*.csv`）。
 * 注意两件事：
 *   1. 单位是「元 / token」，不是「元 / 百万 token」——差 6 个数量级，最容易写错。
 *   2. 存在**时段折扣**（账单里 19:00 的单价正好是白天的 50%），
 *      所以价格必须查表，不能写死一个常数。
 */

/** 元 / token */
export interface PriceTier {
  /** 输入，缓存未命中 */
  inputMiss: number;
  /** 输入，缓存命中（便宜约 50 倍，这是最大的优化空间） */
  inputHit: number;
  /** 输出（最贵，是输入的 4 倍） */
  output: number;
}

export type Tariff = "standard" | "discount";

export const PRICE_TABLE: Record<Tariff, PriceTier> = {
  // 白天实测：¥2 / ¥0.04 / ¥8 每百万 token
  standard: { inputMiss: 2e-6, inputHit: 4e-8, output: 8e-6 },
  // 折扣时段实测：正好半价
  discount: { inputMiss: 1e-6, inputHit: 2e-8, output: 4e-6 },
};

export interface UsageTokens {
  inputMissTokens: number;
  inputHitTokens: number;
  outputTokens: number;
}

/**
 * 估算一次（或一次会话累计）的成本，单位：元。
 *
 * 为什么要自己算：API 响应里只有 token 数，没有金额；
 * 账单是按小时导出的，拿不到「这一次请求花了多少」。
 * 所以前端展示的「本次花费」一定是估算值，要和账单对得上就必须用同一张价格表。
 */
export function estimateCost(
  tokens: UsageTokens,
  tariff: Tariff = "standard",
): number {
  const p = PRICE_TABLE[tariff];
  return (
    tokens.inputMissTokens * p.inputMiss +
    tokens.inputHitTokens * p.inputHit +
    tokens.outputTokens * p.output
  );
}

/** 金额太小，直接显示会全是 0，这里做成人话 */
export function formatCny(yuan: number): string {
  if (yuan === 0) return "¥0";
  if (yuan < 0.0001) return "< ¥0.0001";
  if (yuan < 0.01) return `¥${yuan.toFixed(5)}`;
  if (yuan < 1) return `¥${yuan.toFixed(4)}`;
  return `¥${yuan.toFixed(2)}`;
}

/** 千次成本，面试最常问的口径 */
export function costPerThousand(tokens: UsageTokens, tariff: Tariff = "standard"): string {
  return formatCny(estimateCost(tokens, tariff) * 1000);
}

/**
 * 典型的三种场景（数值来自今天的实测，不要凭感觉改）
 * 这些数字 D4 做配额时要直接写进配置。
 */
export const SCENARIO_SAMPLES: Record<string, UsageTokens> = {
  普通问答: { inputMissTokens: 300, inputHitTokens: 0, outputTokens: 50 },
  "FC 单工具": { inputMissTokens: 1155, inputHitTokens: 0, outputTokens: 54 },
  "FC 双工具": { inputMissTokens: 1833, inputHitTokens: 0, outputTokens: 97 },
  "FC 双工具（前缀命中缓存）": {
    inputMissTokens: 813,
    inputHitTokens: 1020,
    outputTokens: 97,
  },
};

/**
 * 从 OpenAI 兼容响应里提取「缓存命中」字段。
 * DeepSeek 会返回 prompt_cache_hit_tokens / prompt_cache_miss_tokens，
 * 但这不是 OpenAI 标准字段，所以要做兼容读取。
 */
export function readCacheTokens(usage: unknown): {
  hit: number;
  miss: number;
} {
  const u = (usage ?? {}) as {
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens?: number;
  };
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? (u.prompt_tokens ?? 0) - hit;
  return { hit, miss };
}
