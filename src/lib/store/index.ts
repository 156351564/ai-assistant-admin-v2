/**
 * 存储层门面。
 *
 * 设计：调用方只认这一层，不关心背后是内存还是 Postgres。
 *   - 配了 DATABASE_URL → postgres 后端（多实例共享、并发安全）
 *   - 没配 → memory 后端（本地开发零配置，重启即丢）
 *
 * 为什么要这么绕：
 *   接数据库是为了修「Vercel 多实例各存一份」的问题，但不能因此让本地开发
 *   也必须装数据库。所以用环境变量做开关，两边都能跑，接口完全一致。
 *
 * ⚠️ 所有方法都是 async —— 内存实现虽然是同步的，也包成 Promise，
 *    否则切换后端时调用方要改一遍，等于没抽象。
 */
import type { UsageTokens } from "../cost";
import { memoryBackend } from "./memory";
import { postgresBackend } from "./postgres";
import type {
  QuotaState,
  SessionPage,
  StoredMessage,
  StoredSession,
  UsageBucket,
} from "./types";

export type {
  QuotaState,
  Role,
  SessionListItem,
  SessionPage,
  StoreBackend,
  StoredMessage,
  StoredSession,
  UsageBucket,
} from "./types";

const USE_DB = Boolean(process.env.DATABASE_URL);

/** 当前生效的后端，日志或调试接口里可以打出来 */
export const backend = USE_DB ? postgresBackend : memoryBackend;
export const backendKind = backend.kind;

// ---------------- 会话 ----------------

export function createSession(title: string, model: string): Promise<StoredSession> {
  return backend.createSession(title, model);
}

export function appendMessage(
  sessionId: string,
  msg: Omit<StoredMessage, "id" | "createdAt">,
): Promise<void> {
  return backend.appendMessage(sessionId, msg);
}

export function getSession(id: string): Promise<StoredSession | undefined> {
  return backend.getSession(id);
}

export function listSessions(page = 1, size = 20): Promise<SessionPage> {
  return backend.listSessions(page, size);
}

// ---------------- 用量 ----------------

export function recordUsage(tokens: UsageTokens, latencyMs: number): Promise<number> {
  return backend.recordUsage(tokens, latencyMs);
}

function emptyBucket(date: string): UsageBucket {
  return {
    date,
    requests: 0,
    promptTokens: 0,
    promptMissTokens: 0,
    promptHitTokens: 0,
    completionTokens: 0,
    costYuan: 0,
    avgLatencyMs: 0,
  };
}

function dateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 连续 N 天（含今天）。数据库只返回有记录的天，这里统一补零，
 * 保证两个后端的输出形状一致，图表不会出现断点。
 */
export async function usageSeries(days = 7): Promise<UsageBucket[]> {
  const raw = await backend.usageSeries(days);
  const byDate = new Map(raw.map((b) => [b.date, b]));
  const out: UsageBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    out.push(byDate.get(key) ?? emptyBucket(key));
  }
  return out;
}

export async function usageSummary(days = 7) {
  const series = await usageSeries(days);
  const todayBucket = series[series.length - 1];
  const sum = series.reduce(
    (acc, b) => ({
      ...acc,
      requests: acc.requests + b.requests,
      promptTokens: acc.promptTokens + b.promptTokens,
      promptMissTokens: acc.promptMissTokens + b.promptMissTokens,
      promptHitTokens: acc.promptHitTokens + b.promptHitTokens,
      completionTokens: acc.completionTokens + b.completionTokens,
      costYuan: acc.costYuan + b.costYuan,
    }),
    emptyBucket(""),
  );
  const cacheHitRate =
    sum.promptMissTokens + sum.promptHitTokens > 0
      ? sum.promptHitTokens / (sum.promptMissTokens + sum.promptHitTokens)
      : 0;
  return {
    today: todayBucket,
    week: { ...sum, costYuan: Number(sum.costYuan.toFixed(6)), cacheHitRate },
    series,
  };
}

// ---------------- 配额 ----------------

/**
 * 为什么按金额而不是按次数：
 *   实测普通问答单次约 ¥0.0010，双工具 Function Calling 单次约 ¥0.0044，差 4 倍以上。
 *   如果按次数限制，刷 4 次便宜问答和刷 1 次工具调用花费相当，次数配额完全拦不住。
 */
export const QUOTA_LIMIT_YUAN = Number(process.env.DAILY_QUOTA_YUAN ?? 5);

/** 次日零点（本地时区） */
function nextMidnight(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export async function quotaState(limitYuan = QUOTA_LIMIT_YUAN): Promise<QuotaState> {
  const series = await usageSeries(1);
  const todayBucket = series[0];
  const used = todayBucket?.costYuan ?? 0;
  // 保留 6 位小数：单次成本是 1e-3 量级，截断太狠会显示成 0
  const usedYuan = Number(used.toFixed(6));
  const remaining = Math.max(0, limitYuan - usedYuan);
  return {
    date: todayBucket?.date ?? dateKey(new Date()),
    limitYuan,
    usedYuan,
    remainingYuan: Number(remaining.toFixed(6)),
    percent: limitYuan > 0 ? Math.round((usedYuan / limitYuan) * 1000) / 10 : 0,
    exceeded: usedYuan >= limitYuan,
    resetAt: nextMidnight(),
  };
}

/** 调用模型前先判一次，超额直接拒绝，不要等到生成完再记账 */
export async function checkQuota(): Promise<{ ok: boolean; state: QuotaState }> {
  const state = await quotaState();
  return { ok: !state.exceeded, state };
}
