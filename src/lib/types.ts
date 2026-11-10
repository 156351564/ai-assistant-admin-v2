export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * 思考 token（推理模型才有，如 DeepSeek-R1 系列 / 中转站的推理模型）。
   * 这类 token 也计费，但不会出现在 content 里。
   * 官方 deepseek-chat 返回 0 或该字段不存在。
   */
  reasoningTokens: number;
}

export type ChatErrorCode =
  | "MISSING_KEY"
  | "BAD_REQUEST"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "UPSTREAM"
  | "UNKNOWN";

export interface ChatOk {
  ok: true;
  content: string;
  usage: ChatUsage;
  latencyMs: number;
  traceId: string;
  model: string;
}

export interface ChatErr {
  ok: false;
  code: ChatErrorCode;
  message: string;
  latencyMs: number;
  traceId: string;
}

export type ChatResult = ChatOk | ChatErr;
