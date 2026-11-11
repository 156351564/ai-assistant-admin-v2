"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const PAGE_SIZE = 20;

interface SessionItem {
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

interface SessionPage {
  total: number;
  page: number;
  size: number;
  items: SessionItem[];
}

type SessionsResponse =
  | { ok: true; data: SessionPage }
  | { ok: false; code?: string; message?: string };

type ViewState =
  | { status: "loading" }
  | { status: "ready"; data: SessionPage }
  | { status: "error"; message: string };

function formatNumber(n: number): string {
  return n.toLocaleString("zh-CN");
}

/** 时间戳是毫秒数，用本地 getter 拼 MM-DD HH:mm；不解析日期字符串，避免时区歧义 */
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
    <div
      role="status"
      aria-live="polite"
      className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
    >
      <span className="sr-only">正在加载会话列表</span>
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2.5" aria-hidden>
        <Skeleton className="h-3 w-40" />
      </div>
      <div aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ml-auto h-4 w-10" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-700">会话列表加载失败</p>
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

function EmptyView() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-12 text-center">
      <p className="text-sm text-neutral-600">还没有会话记录</p>
      <p className="mt-1 text-xs text-neutral-400">
        去{" "}
        <Link href="/chat" className="text-neutral-600 underline underline-offset-2">
          /chat
        </Link>{" "}
        发起一次对话，会话会出现在这里。
      </p>
    </div>
  );
}

function Pagination({
  page,
  total,
  size,
  onPrev,
  onNext,
}: {
  page: number;
  total: number;
  size: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const buttonClass =
    "rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-200 disabled:hover:text-neutral-600";

  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onPrev}
        disabled={page <= 1}
        className={buttonClass}
      >
        上一页
      </button>
      <p className="text-xs tabular-nums text-neutral-500">
        第 {page} / {totalPages} 页，共 {formatNumber(total)} 条
      </p>
      <button
        type="button"
        onClick={onNext}
        disabled={page >= totalPages || total === 0}
        className={buttonClass}
      >
        下一页
      </button>
    </div>
  );
}

export default function AdminSessionsPage() {
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<ViewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/sessions?page=${page}&size=${PAGE_SIZE}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`接口返回 ${res.status}`);
        const body = (await res.json()) as SessionsResponse;
        if (!body.ok) throw new Error(body.message ?? "接口返回失败");
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
  }, [page, reloadKey]);

  // 翻页/重试先切回骨架态，再触发 effect，避免在 effect 内同步 setState
  const goToPage = useCallback((next: number) => {
    setState({ status: "loading" });
    setPage(next);
  }, []);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">会话</h1>
        <p className="mt-1 text-sm text-neutral-500">
          按更新时间倒序，展示每条会话的消息数、token 与累计成本。
        </p>
      </header>

      {state.status === "loading" ? <LoadingView /> : null}
      {state.status === "error" ? (
        <ErrorView message={state.message} onRetry={reload} />
      ) : null}

      {state.status === "ready" ? (
        <ReadyView data={state.data} onPageChange={goToPage} onReload={reload} />
      ) : null}
    </div>
  );
}

function ReadyView({
  data,
  onPageChange,
  onReload,
}: {
  data: SessionPage;
  onPageChange: (page: number) => void;
  onReload: () => void;
}) {
  const { items, total, page, size } = data;
  const empty = items.length === 0;

  return (
    <>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">全部会话</h2>
        <button
          type="button"
          onClick={onReload}
          className="text-xs text-neutral-500 transition hover:text-neutral-900"
        >
          刷新
        </button>
      </div>

      {empty ? (
        <EmptyView />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  标题
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  模型
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  消息数
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  总 token
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  成本（元）
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">
                  更新时间
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const href = `/admin/sessions/${encodeURIComponent(item.id)}`;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-neutral-100 transition last:border-b-0 hover:bg-neutral-50"
                  >
                    <td className="max-w-[240px] truncate px-4 py-2.5">
                      <Link
                        href={href}
                        className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                        title={item.title}
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-500">{item.model}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">
                      {formatNumber(item.messageCount)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">
                      {formatNumber(item.totalTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">
                      {item.costYuan.toFixed(6)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-neutral-500">
                      {formatDateTime(item.updatedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={href}
                        className="whitespace-nowrap text-xs text-neutral-500 transition hover:text-neutral-900"
                      >
                        查看
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        total={total}
        size={size}
        onPrev={() => onPageChange(page - 1)}
        onNext={() => onPageChange(page + 1)}
      />
    </>
  );
}
