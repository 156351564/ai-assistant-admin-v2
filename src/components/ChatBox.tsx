"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MarkdownStream from "@/components/MarkdownStream";
import { useChatStream } from "@/lib/useChatStream";

const STATE_LABEL: Record<string, string> = {
  streaming: "生成中",
  done: "",
  aborted: "已停止",
  error: "出错了",
};

export default function ChatBox() {
  const [input, setInput] = useState("");
  const { turns, status, error, metrics, send, stop, reset } = useChatStream();

  const listRef = useRef<HTMLDivElement>(null);
  /** 是否贴着底部：用户上滑后自动置 false，停止自动跟随 */
  const stickRef = useRef(true);

  // 内容变化时，只在「用户本来就在底部」的情况下跟着滚
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    // 距离底部 40px 以内就算「贴底」
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const streaming = status === "streaming";
  const last = turns[turns.length - 1];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
      <nav className="flex items-center gap-3 text-xs text-neutral-500">
        <Link href="/" className="hover:text-neutral-900">
          ← 返回首页
        </Link>
        <span className="text-neutral-300">/</span>
        <Link href="/admin" className="hover:text-neutral-900">
          管理后台
        </Link>
      </nav>

      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">流式对话</h1>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>
            状态：
            <b
              className={
                status === "error" ? "text-red-600" : "text-neutral-700"
              }
            >
              {status}
            </b>
          </span>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100"
            >
              新对话
            </button>
          )}
        </div>
      </div>

      {/* 消息列表：唯一可滚动区域 */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="min-h-[380px] max-h-[60vh] space-y-4 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 text-sm"
      >
        {turns.length === 0 && (
          <p className="text-neutral-400">
            问点什么，比如：用一句话解释 SSE / 写个防抖函数
          </p>
        )}

        {turns.map((t) => (
          <div key={t.id}>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-neutral-400">
              <span className="font-medium text-neutral-500">
                {t.role === "user" ? "我" : "AI"}
              </span>
              {t.role === "assistant" && STATE_LABEL[t.state] && (
                <span
                  className={
                    t.state === "error"
                      ? "text-red-500"
                      : t.state === "aborted"
                        ? "text-amber-600"
                        : "text-neutral-400"
                  }
                >
                  {STATE_LABEL[t.state]}
                </span>
              )}
            </div>

            {t.role === "user" ? (
              <p className="whitespace-pre-wrap rounded-lg bg-neutral-100 px-3 py-2 leading-relaxed text-neutral-800">
                {t.content}
              </p>
            ) : (
              <div className="leading-relaxed text-neutral-800">
                <MarkdownStream
                  text={t.content}
                  streaming={t.state === "streaming"}
                />
              </div>
            )}
          </div>
        ))}

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = input.trim();
          if (!q) return;
          setInput("");
          stickRef.current = true; // 新问题一定回到底部
          void send(q);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="继续追问…"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        {streaming ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white"
          >
            停止
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white"
          >
            发送
          </button>
        )}
      </form>

      {/* 指标条：只显示最后一条回答的数据 */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-600 sm:grid-cols-5">
        <div>
          <dt className="text-neutral-400">轮次</dt>
          <dd className="font-mono">
            {Math.ceil(turns.filter((t) => t.role === "user").length)}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-400">本轮字数</dt>
          <dd className="font-mono">{last?.content.length ?? 0}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">首字 TTFT</dt>
          <dd className="font-mono">{metrics.ttftMs ?? "-"} ms</dd>
        </div>
        <div>
          <dt className="text-neutral-400">总耗时</dt>
          <dd className="font-mono">{metrics.totalMs ?? "-"} ms</dd>
        </div>
        <div>
          <dt className="text-neutral-400">traceId</dt>
          <dd className="truncate font-mono">{metrics.traceId ?? "-"}</dd>
        </div>
      </dl>
    </div>
  );
}
