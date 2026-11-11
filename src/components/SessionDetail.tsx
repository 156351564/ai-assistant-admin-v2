"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface StoredMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: number;
  latencyMs?: number;
  ttftMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  costYuan?: number;
}

interface StoredSession {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

type SessionResponse =
  | { ok: true; data: StoredSession }
  | { ok: false; code?: string; message?: string };

type ViewState =
  | { status: "loading" }
  | { status: "ready"; data: StoredSession }
  | { status: "notFound" }
  | { status: "error"; message: string };

const ROLE_LABEL: Record<StoredMessage["role"], string> = {
  system: "系统",
  user: "用户",
  assistant: "助手",
};

function formatNumber(n: number): string {
  return n.toLocaleString("zh-CN");
}

/** 毫秒时间戳按本地时区拼 MM-DD HH:mm，不解析日期字符串 */
function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

function LoadingView() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">正在加载会话详情</span>
      <div aria-hidden>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-3 h-3 w-72" />
        <div className="mt-6 space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-neutral-200 bg-white p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-700">会话加载失败</p>
      <p className="mt-1 text-xs leading-relaxed text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 transition hover:border-red-300"
      >
        重新加载
      </button>
    </div>
  );
}

function NotFoundView() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-10 text-center">
      <p className="text-sm text-neutral-700">
        会话不存在（内存版重启后会丢失，去 /chat 聊两句再回来）
      </p>
      <p className="mt-2 text-xs text-neutral-400">
        会话数据存在内存里，开发服务器重启后就会被清空。
      </p>
    </div>
  );
}

function hasMeta(msg: StoredMessage): boolean {
  return (
    msg.latencyMs !== undefined ||
    msg.ttftMs !== undefined ||
    msg.promptTokens !== undefined ||
    msg.completionTokens !== undefined
  );
}

function MessageItem({ msg }: { msg: StoredMessage }) {
  const isAssistant = msg.role === "assistant";

  return (
    <li
      className={
        isAssistant
          ? "rounded-lg border border-neutral-200 bg-white px-4 py-3"
          : "rounded-lg bg-neutral-100 px-4 py-3"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-neutral-600">
          {ROLE_LABEL[msg.role]}
        </span>
        <span className="text-[11px] tabular-nums text-neutral-400">
          {formatDateTime(msg.createdAt)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-neutral-800">
        {msg.content}
      </p>

      {isAssistant && hasMeta(msg) ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 text-[11px] tabular-nums text-neutral-400">
          {msg.latencyMs !== undefined ? <span>总耗时 {msg.latencyMs} ms</span> : null}
          {msg.ttftMs !== undefined ? <span>首字 {msg.ttftMs} ms</span> : null}
          {msg.promptTokens !== undefined ? (
            <span>输入 {formatNumber(msg.promptTokens)} tokens</span>
          ) : null}
          {msg.completionTokens !== undefined ? (
            <span>输出 {formatNumber(msg.completionTokens)} tokens</span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function SessionDetail({ id }: { id: string }) {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 404) {
          setState({ status: "notFound" });
          return;
        }
        if (!res.ok) throw new Error(`接口返回 ${res.status}`);
        const body = (await res.json()) as SessionResponse;
        if (!body.ok) {
          if (body.code === "NOT_FOUND") {
            setState({ status: "notFound" });
            return;
          }
          throw new Error(body.message ?? "接口返回失败");
        }
        setState({ status: "ready", data: body.data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "网络异常，请稍后重试",
        });
      });

    return () => controller.abort();
  }, [id, reloadKey]);

  // 重试先切回骨架态，再触发 effect，避免在 effect 内同步 setState
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <div>
      <Link
        href="/admin/sessions"
        className="text-xs text-neutral-500 transition hover:text-neutral-900"
      >
        ← 返回会话列表
      </Link>

      <div className="mt-3">
        {state.status === "loading" ? <LoadingView /> : null}
        {state.status === "notFound" ? <NotFoundView /> : null}
        {state.status === "error" ? (
          <ErrorView message={state.message} onRetry={reload} />
        ) : null}
        {state.status === "ready" ? (
          <ReadyView data={state.data} onReload={reload} />
        ) : null}
      </div>
    </div>
  );
}

function ReadyView({ data, onReload }: { data: StoredSession; onReload: () => void }) {
  const totalCost = data.messages.reduce((sum, msg) => sum + (msg.costYuan ?? 0), 0);

  return (
    <>
      <header className="border-b border-neutral-200 pb-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="break-words text-xl font-semibold text-neutral-900">
            {data.title}
          </h1>
          <button
            type="button"
            onClick={onReload}
            className="shrink-0 text-xs text-neutral-500 transition hover:text-neutral-900"
          >
            刷新
          </button>
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <div className="flex items-center gap-1.5">
            <dt className="text-neutral-400">模型</dt>
            <dd className="text-neutral-900">{data.model}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-neutral-400">创建时间</dt>
            <dd className="tabular-nums text-neutral-900">{formatDateTime(data.createdAt)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-neutral-400">消息数</dt>
            <dd className="tabular-nums text-neutral-900">{formatNumber(data.messages.length)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-neutral-400">累计成本</dt>
            <dd className="tabular-nums text-neutral-900">¥{totalCost.toFixed(6)}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="messages" className="mt-5">
        <h2 id="messages" className="mb-3 text-sm font-semibold text-neutral-900">
          消息
        </h2>

        {data.messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center">
            <p className="text-sm text-neutral-600">这条会话还没有消息</p>
            <p className="mt-1 text-xs text-neutral-400">
              去{" "}
              <Link href="/chat" className="text-neutral-600 underline underline-offset-2">
                /chat
              </Link>{" "}
              继续对话后，这里会显示完整记录。
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {data.messages.map((msg) => (
              <MessageItem key={msg.id} msg={msg} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
