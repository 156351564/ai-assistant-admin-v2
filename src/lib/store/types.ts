/**
 * 存储层类型与后端接口。
 *
 * 为什么把类型单独放一个文件：
 * 两个后端（memory / postgres）都要用同一套结构，放这里避免循环依赖。
 * 门面（index.ts）只依赖这个文件 + 一个后端实现。
 */
import type { UsageTokens } from "../cost";

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

export interface SessionListItem {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  totalTokens: number;
  costYuan: number;
  lastMessage: string;
}

export interface SessionPage {
  total: number;
  page: number;
  size: number;
  items: SessionListItem[];
}

export interface QuotaState {
  date: string;
  limitYuan: number;
  usedYuan: number;
  remainingYuan: number;
  /** 0-100，超额时可能 >100 */
  percent: number;
  exceeded: boolean;
  /** 次日零点的时间戳，前端用来显示「何时重置」 */
  resetAt: number;
}

/**
 * 存储后端必须实现的能力。
 * 所有方法都是 async —— 即使内存实现本身是同步的，也统一成 Promise，
 * 这样门面和调用方不需要关心背后是内存还是数据库。
 */
export interface StoreBackend {
  readonly kind: "memory" | "postgres";
  createSession(title: string, model: string): Promise<StoredSession>;
  appendMessage(
    sessionId: string,
    msg: Omit<StoredMessage, "id" | "createdAt">,
  ): Promise<void>;
  getSession(id: string): Promise<StoredSession | undefined>;
  listSessions(page: number, size: number): Promise<SessionPage>;
  /** 返回本次调用的成本（元） */
  recordUsage(tokens: UsageTokens, latencyMs: number): Promise<number>;
  /** 连续 N 天（含今天），缺失的日期由门面补 0 */
  usageSeries(days: number): Promise<UsageBucket[]>;
}
