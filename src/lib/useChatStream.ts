"use client";

/**
 * 流式对话（多轮版）
 *
 * 相比单轮版的三处升级：
 *   1. turns 数组维护整段会话，每次请求把历史一起发过去（多轮上下文）
 *   2. 上下文窗口截断（MAX_CONTEXT_MESSAGES），防止对话越长越贵
 *   3. 每个 assistant 消息带自己的状态，中断/出错能精确标到那一条
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createSseParser } from "./sse";

export type TurnState = "streaming" | "done" | "aborted" | "error";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  state: TurnState;
}

export type StreamStatus = "idle" | "streaming" | "error";

export interface StreamMetrics {
  ttftMs: number | null;
  totalMs: number | null;
  traceId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

const EMPTY_METRICS: StreamMetrics = {
  ttftMs: null,
  totalMs: null,
  traceId: null,
  promptTokens: null,
  completionTokens: null,
};

/**
 * 带进上下文的最大消息条数（含本条）。
 * 20 条 ≈ 几千 token，是「够用」和「不烧钱」的折中；
 * D3 会换成按 token 预算动态截断 + 摘要压缩。
 */
const MAX_CONTEXT_MESSAGES = 20;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function useChatStream() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StreamMetrics>(EMPTY_METRICS);

  const abortRef = useRef<AbortController | null>(null);
  /** turns 的镜像：发请求时要读最新历史，但不能依赖 state 闭包 */
  const turnsRef = useRef<Turn[]>([]);
  /** 待提交的增量文本 */
  const pendingRef = useRef("");
  /** 当前正在写入的 assistant 消息 id */
  const targetIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const flush = useCallback(() => {
    rafRef.current = null;
    const chunk = pendingRef.current;
    const id = targetIdRef.current;
    if (!chunk || !id) return;
    pendingRef.current = "";
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content: t.content + chunk } : t)),
    );
  }, []);

  const append = useCallback(
    (delta: string) => {
      pendingRef.current += delta;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  const setTurnState = useCallback((id: string, state: TurnState) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, state } : t)));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setStatus("idle");
    setError(null);
    setMetrics(EMPTY_METRICS);
  }, []);

  const send = useCallback(
    async (input: string) => {
      const content = input.trim();
      if (!content) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userId = uid();
      const assistantId = uid();

      // ① 构造上下文：把历史（只取有内容的）拼上本条，再按窗口截断
      const history = [
        ...turnsRef.current
          .filter((t) => t.content.trim().length > 0)
          .map((t) => ({ role: t.role, content: t.content })),
        { role: "user" as const, content },
      ].slice(-MAX_CONTEXT_MESSAGES);

      pendingRef.current = "";
      targetIdRef.current = assistantId;
      doneRef.current = false;
      setError(null);
      setMetrics(EMPTY_METRICS);
      setStatus("streaming");
      setTurns((prev) => [
        ...prev,
        { id: userId, role: "user", content, state: "done" },
        { id: assistantId, role: "assistant", content: "", state: "streaming" },
      ]);

      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const raw = await res.text();
          throw new Error(raw.slice(0, 200) || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");

        const parser = createSseParser(({ event, data }) => {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(data) as Record<string, unknown>;
          } catch {
            return;
          }

          switch (event) {
            case "start":
              setMetrics((m) => ({
                ...m,
                traceId: (payload.traceId as string) ?? null,
              }));
              break;
            case "delta":
              append((payload.text as string) ?? "");
              break;
            case "usage":
              setMetrics((m) => ({
                ...m,
                promptTokens: (payload.promptTokens as number) ?? null,
                completionTokens: (payload.completionTokens as number) ?? null,
              }));
              break;
            case "done":
              doneRef.current = true;
              setMetrics((m) => ({
                ...m,
                ttftMs: (payload.ttftMs as number) ?? null,
                totalMs: (payload.totalMs as number) ?? null,
              }));
              setStatus("idle");
              break;
            case "error":
              doneRef.current = true;
              setError((payload.message as string) ?? "服务端返回错误");
              setStatus("error");
              break;
            default:
              break;
          }
        });

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
        parser.flush();

        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        flush();

        if (!doneRef.current) {
          setTurnState(assistantId, "error");
          setError("连接中断，回答可能不完整");
          setStatus("error");
        } else {
          setTurnState(assistantId, "done");
        }
      } catch (err) {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        flush();

        // ② 用户主动停止：保留已生成的内容，标成 aborted，不报错
        if (err instanceof DOMException && err.name === "AbortError") {
          setTurnState(assistantId, "aborted");
          setStatus("idle");
        } else {
          setTurnState(assistantId, "error");
          setError(err instanceof Error ? err.message : "网络错误");
          setStatus("error");
        }
      } finally {
        targetIdRef.current = null;
      }
    },
    [append, flush, setTurnState],
  );

  return { turns, status, error, metrics, send, stop, reset };
}
