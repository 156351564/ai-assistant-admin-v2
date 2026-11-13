/**
 * 内存后端：本地开发 / 没配 DATABASE_URL 时的兜底。
 *
 * ⚠️ 限制（这就是为什么要接 Postgres）：
 *   1. 进程重启数据全丢
 *   2. 多实例之间不共享 —— Vercel 上每个函数实例各有一份，
 *      发消息的实例和看后台的实例往往不是同一个，所以「聊天后后台看不到数据」
 *   3. recordUsage 是「读-改-写」，并发下会丢更新（数据库用原子 upsert 解决）
 */
import { estimateCost, type UsageTokens } from "../cost";
import type {
  SessionPage,
  StoreBackend,
  StoredSession,
  UsageBucket,
} from "./types";

interface MemStore {
  sessions: Map<string, StoredSession>;
  usage: UsageBucket[];
}

/**
 * 挂在 globalThis 上，否则 Next 的 HMR 每次热更新都会重置模块级变量，
 * 开发时会看到「数据莫名消失」。
 */
const g = globalThis as unknown as { __aiStore?: MemStore };

function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10);
}

function today(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
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

function db(): MemStore {
  if (!g.__aiStore) {
    g.__aiStore = { sessions: new Map(), usage: [] };
  }
  return g.__aiStore;
}

export const memoryBackend: StoreBackend = {
  kind: "memory",

  async createSession(title, model) {
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
  },

  async appendMessage(sessionId, msg) {
    const s = db().sessions.get(sessionId);
    if (!s) return;
    s.messages.push({ ...msg, id: uid("m_"), createdAt: Date.now() });
    s.updatedAt = Date.now();
  },

  async getSession(id) {
    return db().sessions.get(id);
  },

  async listSessions(page, size): Promise<SessionPage> {
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
  },

  async recordUsage(tokens: UsageTokens, latencyMs: number): Promise<number> {
    const cost = estimateCost(tokens);
    const date = today();
    const store = db();
    let bucket = store.usage.find((b) => b.date === date);
    if (!bucket) {
      bucket = emptyBucket(date);
      store.usage.push(bucket);
    }
    bucket.promptMissTokens += tokens.inputMissTokens;
    bucket.promptHitTokens += tokens.inputHitTokens;
    bucket.promptTokens += tokens.inputMissTokens + tokens.inputHitTokens;
    bucket.completionTokens += tokens.outputTokens;
    bucket.costYuan += cost;
    // 增量平均：旧平均 × 旧次数 + 本次 → 除以新次数
    const prevCount = bucket.requests;
    bucket.requests += 1;
    bucket.avgLatencyMs = Math.round(
      (bucket.avgLatencyMs * prevCount + latencyMs) / bucket.requests,
    );
    return cost;
  },

  async usageSeries(days: number): Promise<UsageBucket[]> {
    const out: UsageBucket[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const m = `${d.getMonth() + 1}`.padStart(2, "0");
      const day = `${d.getDate()}`.padStart(2, "0");
      const key = `${d.getFullYear()}-${m}-${day}`;
      out.push(db().usage.find((b) => b.date === key) ?? emptyBucket(key));
    }
    return out;
  },
};
