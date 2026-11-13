/**
 * Postgres 后端（Neon serverless，走 HTTP，适合 Vercel 函数）。
 *
 * 相比内存版多解决两个问题：
 *   1. 多实例共享：所有实例读同一份数据库，「发消息的实例」和「看后台的实例」
 *      不再是两个世界
 *   2. 并发安全：用量累加用 `INSERT ... ON CONFLICT DO UPDATE SET x = x + excluded.x`
 *      一条 SQL 完成，避免「读-改-写」在并发下丢更新
 *
 * 表结构在 ensureSchema() 里惰性创建，第一次查询前执行一次。
 */
import { neon } from "@neondatabase/serverless";

import { estimateCost, type UsageTokens } from "../cost";
import type {
  SessionPage,
  StoreBackend,
  StoredMessage,
  StoredSession,
  UsageBucket,
} from "./types";

const URL_ = process.env.DATABASE_URL!;
const sql = neon(URL_);

let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        create table if not exists sessions (
          id          text primary key,
          title       text not null,
          model       text not null,
          created_at  bigint not null,
          updated_at  bigint not null
        )
      `;
      await sql`
        create table if not exists messages (
          id                text primary key,
          session_id        text not null references sessions(id) on delete cascade,
          role              text not null,
          content           text not null,
          created_at        bigint not null,
          latency_ms        integer,
          ttft_ms           integer,
          prompt_tokens     integer,
          completion_tokens integer,
          cost_yuan         double precision
        )
      `;
      await sql`
        create index if not exists idx_messages_session
        on messages (session_id, created_at)
      `;
      await sql`
        create table if not exists usage_daily (
          date               text primary key,
          requests           integer not null default 0,
          prompt_tokens      bigint  not null default 0,
          prompt_miss_tokens bigint  not null default 0,
          prompt_hit_tokens  bigint  not null default 0,
          completion_tokens  bigint  not null default 0,
          cost_yuan          double precision not null default 0,
          latency_sum        bigint  not null default 0
        )
      `;
    })();
  }
  return schemaReady;
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

function dateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Neon 的查询结果是 Record<string, unknown>[]，这里显式声明行结构，
// 避免 noImplicitAny 下每个 .map 回调都报 TS7006。
interface SessionRow {
  id: string; title: string; model: string;
  created_at: string | number; updated_at: string | number;
}
interface MessageRow {
  id: string; role: string; content: string; created_at: string | number;
  latency_ms: number | null; ttft_ms: number | null;
  prompt_tokens: number | null; completion_tokens: number | null;
  cost_yuan: number | string | null;
}
interface ListRow extends SessionRow {
  message_count: number; total_tokens: string | number;
  cost_yuan: string | number; last_message: string;
}
interface UsageRow {
  date: string; requests: number; prompt_tokens: string | number;
  prompt_miss_tokens: string | number; prompt_hit_tokens: string | number;
  completion_tokens: string | number; cost_yuan: string | number;
  latency_sum: string | number;
}

export const postgresBackend: StoreBackend = {
  kind: "postgres",

  async createSession(title, model) {
    await ensureSchema();
    const now = Date.now();
    const session: StoredSession = {
      id: uid("s_"),
      title: title.slice(0, 40) || "新对话",
      model,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await sql`
      insert into sessions (id, title, model, created_at, updated_at)
      values (${session.id}, ${session.title}, ${session.model}, ${now}, ${now})
    `;
    return session;
  },

  async appendMessage(sessionId, msg) {
    await ensureSchema();
    const now = Date.now();
    await sql`
      insert into messages (
        id, session_id, role, content, created_at,
        latency_ms, ttft_ms, prompt_tokens, completion_tokens, cost_yuan
      ) values (
        ${uid("m_")}, ${sessionId}, ${msg.role}, ${msg.content}, ${now},
        ${msg.latencyMs ?? null}, ${msg.ttftMs ?? null},
        ${msg.promptTokens ?? null}, ${msg.completionTokens ?? null},
        ${msg.costYuan ?? null}
      )
    `;
    // 会话的 updatedAt 要同步，否则列表排序不反映最新活动
    await sql`update sessions set updated_at = ${now} where id = ${sessionId}`;
  },

  async getSession(id) {
    await ensureSchema();
    const rows = (await sql`
      select id, title, model, created_at, updated_at
      from sessions where id = ${id}
    `) as unknown as SessionRow[];
    if (rows.length === 0) return undefined;
    const s = rows[0];
    const msgs = (await sql`
      select id, role, content, created_at, latency_ms, ttft_ms,
             prompt_tokens, completion_tokens, cost_yuan
      from messages where session_id = ${id} order by created_at asc
    `) as unknown as MessageRow[];
    return {
      id: s.id as string,
      title: s.title as string,
      model: s.model as string,
      createdAt: num(s.created_at),
      updatedAt: num(s.updated_at),
      messages: msgs.map(
        (m): StoredMessage => ({
          id: m.id as string,
          role: m.role as StoredMessage["role"],
          content: m.content as string,
          createdAt: num(m.created_at),
          latencyMs: m.latency_ms === null ? undefined : num(m.latency_ms),
          ttftMs: m.ttft_ms === null ? undefined : num(m.ttft_ms),
          promptTokens: m.prompt_tokens === null ? undefined : num(m.prompt_tokens),
          completionTokens:
            m.completion_tokens === null ? undefined : num(m.completion_tokens),
          costYuan: m.cost_yuan === null ? undefined : num(m.cost_yuan),
        }),
      ),
    };
  },

  async listSessions(page, size): Promise<SessionPage> {
    await ensureSchema();
    const countRows = await sql`select count(*)::int as total from sessions`;
    const total = num(countRows[0]?.total);
    const offset = (page - 1) * size;

    // 一次查询拿到「消息数 / 总 token / 累计成本 / 最后一条内容」，
    // 避免 N+1（列表里每条会话再查一次）。
    const rows = (await sql`
      select s.id, s.title, s.model, s.created_at, s.updated_at,
             count(m.id)::int as message_count,
             coalesce(sum(coalesce(m.prompt_tokens, 0) + coalesce(m.completion_tokens, 0)), 0)::bigint as total_tokens,
             coalesce(sum(coalesce(m.cost_yuan, 0)), 0) as cost_yuan,
             coalesce((array_agg(m.content order by m.created_at desc))[1], '') as last_message
      from sessions s
      left join messages m on m.session_id = s.id
      group by s.id, s.title, s.model, s.created_at, s.updated_at
      order by s.updated_at desc
      limit ${size} offset ${offset}
    `) as unknown as ListRow[];

    return {
      total,
      page,
      size,
      items: rows.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        model: r.model as string,
        createdAt: num(r.created_at),
        updatedAt: num(r.updated_at),
        messageCount: num(r.message_count),
        totalTokens: num(r.total_tokens),
        costYuan: Number(num(r.cost_yuan).toFixed(6)),
        lastMessage: (r.last_message as string).slice(0, 60),
      })),
    };
  },

  async recordUsage(tokens: UsageTokens, latencyMs: number): Promise<number> {
    await ensureSchema();
    const cost = estimateCost(tokens);
    const promptTokens = tokens.inputMissTokens + tokens.inputHitTokens;

    // 原子累加：并发下不会丢更新（内存版的「读-改-写」会）
    await sql`
      insert into usage_daily (
        date, requests, prompt_tokens, prompt_miss_tokens,
        prompt_hit_tokens, completion_tokens, cost_yuan, latency_sum
      ) values (
        ${today()}, 1, ${promptTokens}, ${tokens.inputMissTokens},
        ${tokens.inputHitTokens}, ${tokens.outputTokens}, ${cost}, ${latencyMs}
      )
      on conflict (date) do update set
        requests           = usage_daily.requests + 1,
        prompt_tokens      = usage_daily.prompt_tokens + excluded.prompt_tokens,
        prompt_miss_tokens = usage_daily.prompt_miss_tokens + excluded.prompt_miss_tokens,
        prompt_hit_tokens  = usage_daily.prompt_hit_tokens + excluded.prompt_hit_tokens,
        completion_tokens  = usage_daily.completion_tokens + excluded.completion_tokens,
        cost_yuan          = usage_daily.cost_yuan + excluded.cost_yuan,
        latency_sum        = usage_daily.latency_sum + excluded.latency_sum
    `;
    return cost;
  },

  async usageSeries(days: number): Promise<UsageBucket[]> {
    await ensureSchema();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    const rows = (await sql`
      select date, requests, prompt_tokens, prompt_miss_tokens,
             prompt_hit_tokens, completion_tokens, cost_yuan, latency_sum
      from usage_daily where date >= ${dateKey(start)}
    `) as unknown as UsageRow[];
    const byDate = new Map<string, UsageBucket>();
    for (const r of rows) {
      const requests = num(r.requests);
      const latencySum = num(r.latency_sum);
      byDate.set(r.date as string, {
        date: r.date as string,
        requests,
        promptTokens: num(r.prompt_tokens),
        promptMissTokens: num(r.prompt_miss_tokens),
        promptHitTokens: num(r.prompt_hit_tokens),
        completionTokens: num(r.completion_tokens),
        costYuan: num(r.cost_yuan),
        avgLatencyMs: requests > 0 ? Math.round(latencySum / requests) : 0,
      });
    }
    // 缺失的日期补 0（图表才不会断），补零逻辑在门面里统一做
    return [...byDate.values()];
  },
};
