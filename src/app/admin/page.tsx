"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCny } from "@/lib/cost";

/**
 * 概览页数据来自 GET /api/usage?days=7。
 * 这里只声明用到的字段，形状与 route 返回值一一对应（含 D4 修复后的缓存拆分与延迟）。
 */
interface UsageBucket {
  date: string;
  requests: number;
  promptTokens: number;
  promptMissTokens: number;
  promptHitTokens: number;
  completionTokens: number;
  costYuan: number;
  avgLatencyMs: number;
}

interface WeekBucket extends UsageBucket {
  cacheHitRate: number;
}

interface UsageData {
  days: number;
  today: UsageBucket;
  week: WeekBucket;
  series: UsageBucket[];
  scenarios: Array<{ name: string; perCall: string; thousandCost: string }>;
  prices: { inputMiss: number; inputHit: number; output: number };
}

type UsageResponse =
  | { ok: true; data: UsageData }
  | { ok: false; code?: string; message?: string };

type ViewState =
  | { status: "loading" }
  | { status: "ready"; data: UsageData }
  | { status: "error"; message: string };

const num = (n: number): string => n.toLocaleString("zh-CN");

/** 接口返回 YYYY-MM-DD，只展示 MM-DD，避免任何时区/本地化差异 */
const shortDate = (date: string): string => date.slice(5);

function hitRate(hit: number, total: number): number {
  return total > 0 ? hit / total : 0;
}

function StatCard({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
        {value}
        {unit ? (
          <span className="ml-1 text-sm font-normal text-neutral-400">{unit}</span>
        ) : null}
      </p>
      <p className="mt-1 min-h-4 text-[11px] text-neutral-400">{note ?? ""}</p>
    </div>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

function LoadingView() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">正在加载用量数据</span>
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-neutral-200 bg-white p-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4" aria-hidden>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    </div>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-700">用量数据加载失败</p>
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
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center">
      <p className="text-sm text-neutral-600">近 7 日还没有调用记录</p>
      <p className="mt-1 text-xs text-neutral-400">
        去对话页发一条消息，这里就会出现真实的用量与成本。
      </p>
    </div>
  );
}

export default function AdminOverviewPage() {
  const [state, setState] = useState<ViewState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/usage?days=7", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`接口返回 ${res.status}`);
        const body = (await res.json()) as UsageResponse;
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
  }, [reloadKey]);

  // 重试时先切回骨架态，再触发一次 effect；首次加载由 useState 的初始值承担，避免 effect 内同步 setState
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">概览</h1>
        <p className="mt-1 text-sm text-neutral-500">
          今日用量与近 7 日成本，数据每次进入页面时从 GET /api/usage 拉取。
        </p>
      </header>

      {state.status === "loading" ? <LoadingView /> : null}
      {state.status === "error" ? (
        <ErrorView message={state.message} onRetry={reload} />
      ) : null}

      {state.status === "ready" ? (
        <ReadyView data={state.data} onReload={reload} />
      ) : null}
    </div>
  );
}

/** 坐标轴刻度：金额太小时 toFixed(2) 会全变 0，按量级减少小数位 */
function axisCost(value: number): string {
  if (value === 0) return "0";
  if (value < 0.01) return value.toFixed(4);
  return value.toFixed(2);
}

function ReadyView({ data, onReload }: { data: UsageData; onReload: () => void }) {
  const { today, week, series } = data;
  const todayTokens = today.promptTokens + today.completionTokens;
  const todayHitRate = hitRate(today.promptHitTokens, today.promptTokens);
  const empty = week.requests === 0;
  const chartData = series.map((row) => ({
    date: shortDate(row.date),
    cost: row.costYuan,
  }));

  return (
    <>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">今日</h2>
        <button
          type="button"
          onClick={onReload}
          className="text-xs text-neutral-500 transition hover:text-neutral-900"
        >
          刷新
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="今日请求数"
          value={num(today.requests)}
          unit="次"
          note={today.requests === 0 ? "今日暂无请求" : `近 7 日共 ${num(week.requests)} 次`}
        />
        <StatCard
          label="今日 token"
          value={num(todayTokens)}
          unit="tokens"
          note={
            todayTokens === 0
              ? "输入与输出合计"
              : `输入 ${num(today.promptTokens)} / 输出 ${num(today.completionTokens)}`
          }
        />
        <StatCard
          label="今日成本"
          value={formatCny(today.costYuan)}
          note={
            today.promptTokens === 0
              ? "按 standard 档单价估算"
              : `缓存命中率 ${(todayHitRate * 100).toFixed(1)}%`
          }
        />
      </div>

      <section aria-labelledby="cost-trend" className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="cost-trend" className="text-sm font-semibold text-neutral-900">
            近 7 日成本
          </h2>
          <p className="text-xs text-neutral-400">单位：元</p>
        </div>

        {empty ? (
          <EmptyView />
        ) : (
          <figure className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="#e5e5e5" />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={{ stroke: "#e5e5e5" }}
                    tick={{ fill: "#737373", fontSize: 11 }}
                    dy={4}
                  />
                  <YAxis
                    width={56}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#737373", fontSize: 11 }}
                    tickFormatter={(value) => axisCost(Number(value))}
                  />
                  <Tooltip
                    formatter={(value) => [formatCny(Number(value)), "成本"]}
                    labelFormatter={(label) => `${label} 成本`}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e5e5e5",
                      boxShadow: "none",
                      fontSize: 12,
                      padding: "8px 10px",
                    }}
                    labelStyle={{ color: "#737373", fontSize: 11 }}
                    itemStyle={{ color: "#171717" }}
                    cursor={{ stroke: "#d4d4d4", strokeDasharray: "3 3" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    name="成本"
                    stroke="#171717"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#171717", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#171717", strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="sr-only">
              近 7 日每日成本折线图，横轴为日期，纵轴单位为元。
            </figcaption>
          </figure>
        )}
      </section>
    </>
  );
}
