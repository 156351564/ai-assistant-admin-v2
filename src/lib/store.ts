/**
 * D4 · 会话与用量存储（内存版）
 *
 * 为什么先做内存版：
 *   1. M1 的目标是「能演示 + 投出去」，不是「生产级持久化」
 *   2. Vercel 是 serverless，文件写不持久；真持久化要接 Neon，那是 D5 的事
 *   3. 但接口按「存储接口」设计，后面换 Neon 只改这一个文件
 *
 * ⚠️ 已知限制（面试要主动说）：
 *   进程重启数据就没了，多实例之间也不共享。
 */
import { estimateCost, type UsageTokens } from "./cost";

export type Role = "system" | "user" | "assistant";

export interface StoredMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** 仅 assistant 消息有 */
  latencyMs?: number;
  ttftMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  costYuan?: number;
}

export interface StoredSession {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

export interface UsageBucket {
  /** YYYY-MM-DD（本地时区） */
  date: string;
  requests: number;
  /** miss + hit，保留这个字段是为了图表方便 */
  promptTokens: number;
  /** 缓存未命中（贵） */
  promptMissTokens: number;
  /** 缓存命中（便宜 50 倍，命中率是成本优化的核心指标） */
  promptHitTokens: number;
  completionTokens: number;
  costYuan: number;
  /** 平均总耗时，用于排查「是模型慢还是链路慢」 */
  avgLatencyMs: number;
}

interface Store {
  sessions: Map<string, StoredSession>;
  usage: UsageBucket[];
}

/**
 * 挂在 globalThis 上，否则 Next 的 HMR 每次热更新都会重置模块级变量，
 * 开发时会看到「数据莫名消失」。这是开发期的经典坑。
 */
const g = globalThis as unknown as { __aiStore?: Store };

function db(): Store {
  if (!g.__aiStore) {
    g.__aiStore = { sessions: new Map(), usage: [] };
    seed(g.__aiStore);
  }
  return g.__aiStore;
}

function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function today(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 预置两条演示会话，避免第一次打开后台是空的 */
function seed(s: Store) {
  const now = Date.now();
  const demos: Array<[string, string, string, number]> = [
    ["订单查询", "订单 A123 什么时候能到", "订单 A123 已发货，预计 11月12日 送达。", 2400],
    ["流式原理", "用一句话解释 SSE", "SSE 是服务器通过一条 HTTP 长连接，以 text/event-stream 格式持续向客户端推送增量数据的机制。", 830],
  ];
  for (const [title, q, a, ms] of demos) {
    const id = uid("s_");
    s.sessions.set(id, {
      id,
      title,
      model: "deepseek-chat",
      createdAt: now - 3600_000,
      updatedAt: now - 3600_000,
      messages: [
        { id: uid("m_"), role: "user", content: q, createdAt: now - 3600_000 },
        {
          id: uid("m_"),
          role: "assistant",
          content: a,
          createdAt: now - 3599_000,
          latencyMs: ms,
          ttftMs: Math.round(ms * 0.45),
          promptTokens: 320,
          completionTokens: 48,
          costYuan: estimateCost({ inputMissTokens: 320, inputHitTokens: 0, outputTokens: 48 }),
        },
      ],
    });
  }
}

/** 新建会话 */
export function createSession(title: string, model: string): StoredSession {
  const now = Date.now();
  const session: StoredSession = {
    id: uid("s_"),
    title: title.slice(0, 40) || "新对话",
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  db().sessions.set(session.id, session);
  return session;
}

export function appendMessage(sessionId: string, msg: Omit<StoredMessage, "id" | "createdAt">): void {
  const s = db().sessions.get(sessionId);
  if (!s) return;
  s.messages.push({ ...msg, id: uid("m_"), createdAt: Date.now() });
  s.updatedAt = Date.now();
}

/** 记录一次模型调用，同时累加当日用量 */
export function recordUsage(tokens: UsageTokens, latencyMs: number): number {
  const cost = estimateCost(tokens);
  const date = today();
  const store = db();
  let bucket = store.usage.find((b) => b.date === date);
  if (!bucket) {
    bucket = {
      date,
      requests: 0,
      promptTokens: 0,
      promptMissTokens: 0,
      promptHitTokens: 0,
      completionTokens: 0,
      costYuan: 0,
      avgLatencyMs: 0,
    };
    store.usage.push(bucket);
  }
  bucket.promptMissTokens += tokens.inputMissTokens;
  bucket.promptHitTokens += tokens.inputHitTokens;
  bucket.promptTokens += tokens.inputMissTokens + tokens.inputHitTokens;
  bucket.completionTokens += tokens.outputTokens;
  bucket.costYuan += cost;
  // 增量平均：这次之前的平均值 × 旧次数 + 本次 → 除以新次数
  const prevCount = bucket.requests;
  bucket.requests += 1;
  bucket.avgLatencyMs = Math.round(
    (bucket.avgLatencyMs * prevCount + latencyMs) / bucket.requests,
  );
  return cost;
}

/** 列表：不带 messages，只给摘要 */
export function listSessions(page = 1, size = 20) {
  const all = [...db().sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const start = (page - 1) * size;
  return {
    total: all.length,
    page,
    size,
    items: all.slice(start, start + size).map((s) => {
      const last = s.messages[s.messages.length - 1];
      const cost = s.messages.reduce((sum, m) => sum + (m.costYuan ?? 0), 0);
      const tokens = s.messages.reduce(
        (sum, m) => sum + (m.promptTokens ?? 0) + (m.completionTokens ?? 0),
        0,
      );
      return {
        id: s.id,
        title: s.title,
        model: s.model,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        totalTokens: tokens,
        costYuan: Number(cost.toFixed(6)),
        lastMessage: last ? last.content.slice(0, 60) : "",
      };
    }),
  };
}

export function getSession(id: string): StoredSession | undefined {
  return db().sessions.get(id);
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

/** 最近 N 天的用量（含今天），缺失的日期补 0，图表才不会断 */
export function usageSeries(days = 7): UsageBucket[] {
  const store = db();
  const out: UsageBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    const key = `${d.getFullYear()}-${m}-${day}`;
    out.push(store.usage.find((b) => b.date === key) ?? emptyBucket(key));
  }
  return out;
}

export function usageSummary(days = 7) {
  const series = usageSeries(days);
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
