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

const formatNumber = (n: number): string => n.toLocaleString("zh-CN");

/** 成本展示口径：< 0.01 元保留 4 位，否则 2 位 */
function formatCost(yuan: number): string {
  return `¥${yuan < 0.01 ? yuan.toFixed(4) : yuan.toFixed(2)}`;
}

/** 坐标轴刻度，金额太小时避免整列都变成 0.00 */
function axisCost(value: number): string {
  if (value === 0) return "0";
  if (value < 0.01) return value.toFixed(4);
  return value.toFixed(2);
}

/** 接口给的是元/token，换算成元/百万 token；先 toFixed 再转数字，消掉浮点尾巴 */
function perMillion(value: number): string {
  return `¥${Number((value * 1_000_000).toFixed(4))}`;
}

const shortDate = (date: string): string => date.slice(5);

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

function LoadingView() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">正在加载用量数据</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-neutral-200 bg-white p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-3 lg:grid-cols-2" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg border border-neutral-200 bg-white p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-52 w-full" />
          </div>
        ))}
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

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
        {value}
      </p>
      <p className="mt-1 min-h-4 text-[11px] leading-relaxed text-neutral-400">
        {note}
      </p>
    </div>
  );
}

function TrendChart({
  title,
  subtitle,
  data,
  yTickFormatter,
  allowDecimals,
  tooltipFormatter,
}: {
  title: string;
  subtitle: string;
  data: Array<{ date: string; value: number }>;
  yTickFormatter?: (value: number) => string;
  allowDecimals: boolean;
  tooltipFormatter: (value: number) => string;
}) {
  return (
    <figure className="rounded-lg border border-neutral-200 bg-white p-4">
      <figcaption className="mb-3">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        <p className="mt-0.5 text-[11px] text-neutral-400">{subtitle}</p>
      </figcaption>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              allowDecimals={allowDecimals}
              tick={{ fill: "#737373", fontSize: 11 }}
              tickFormatter={yTickFormatter}
            />
            <Tooltip
              formatter={(value) => [tooltipFormatter(Number(value)), title]}
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
              dataKey="value"
              name={title}
              stroke="#171717"
              strokeWidth={2}
              dot={{ r: 3, fill: "#171717", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#171717", strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export default function AdminUsagePage() {
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

  // 重试先切回骨架态，再触发 effect，避免在 effect 内同步 setState
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">用量</h1>
        <p className="mt-1 text-sm text-neutral-500">
          近 7 日请求、token 与成本，含缓存命中情况与典型场景报价。
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

function ReadyView({ data, onReload }: { data: UsageData; onReload: () => void }) {
  const { today, week, series, scenarios, prices } = data;

  const todayTokens = today.promptTokens + today.completionTokens;
  const todayHitRate =
    today.promptTokens > 0 ? today.promptHitTokens / today.promptTokens : null;
  const empty = week.requests === 0;

  const costData = series.map((row) => ({
    date: shortDate(row.date),
    value: row.costYuan,
  }));
  const requestData = series.map((row) => ({
    date: shortDate(row.date),
    value: row.requests,
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="今日请求数"
          value={formatNumber(today.requests)}
          note={
            today.requests === 0
              ? "今日暂无请求"
              : `近 7 日共 ${formatNumber(week.requests)} 次`
          }
        />
        <StatCard
          label="今日 token"
          value={formatNumber(todayTokens)}
          note={`输入 miss ${formatNumber(today.promptMissTokens)} / hit ${formatNumber(
            today.promptHitTokens,
          )} · 输出 ${formatNumber(today.completionTokens)}`}
        />
        <StatCard
          label="今日成本"
          value={formatCost(today.costYuan)}
          note="按 standard 档单价估算"
        />
        <StatCard
          label="缓存命中率"
          value={todayHitRate === null ? "—" : `${(todayHitRate * 100).toFixed(1)}%`}
          note={
            todayHitRate === null
              ? `近 7 日 ${(week.cacheHitRate * 100).toFixed(1)}%`
              : `今日 ${formatNumber(today.promptHitTokens)} / ${formatNumber(
                  today.promptTokens,
                )} 输入 token 命中`
          }
        />
      </div>

      <section aria-labelledby="trend" className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="trend" className="text-sm font-semibold text-neutral-900">
            近 7 日趋势
          </h2>
          <p className="text-xs text-neutral-400">成本与请求数分开两张图</p>
        </div>

        {empty ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center">
            <p className="text-sm text-neutral-600">近 7 日还没有调用记录</p>
            <p className="mt-1 text-xs text-neutral-400">
              去 /chat 发一条消息，这里的曲线就会动起来。
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <TrendChart
              title="成本（元）"
              subtitle="按 standard 档单价估算"
              data={costData}
              yTickFormatter={axisCost}
              allowDecimals
              tooltipFormatter={formatCost}
            />
            <TrendChart
              title="请求数（次）"
              subtitle="每日成功记录的模型调用次数"
              data={requestData}
              allowDecimals={false}
              tooltipFormatter={(value) => `${formatNumber(value)} 次`}
            />
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <section aria-labelledby="scenarios">
          <h2 id="scenarios" className="mb-3 text-sm font-semibold text-neutral-900">
            场景成本
          </h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">
                    场景
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    单次成本
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    千次成本
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => (
                  <tr
                    key={scenario.name}
                    className="border-b border-neutral-100 last:border-b-0"
                  >
                    <td className="px-4 py-2.5 text-neutral-700">{scenario.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">
                      {scenario.perCall}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-900">
                      {scenario.thousandCost}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="prices">
          <h2 id="prices" className="mb-3 text-sm font-semibold text-neutral-900">
            单价
          </h2>
          <div className="rounded-lg border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-4 py-2.5 text-xs text-neutral-500">
              当前生效价格 · 每百万 token
            </div>
            <dl className="divide-y divide-neutral-100">
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <dt className="text-neutral-600">输入 · 缓存未命中</dt>
                <dd className="tabular-nums text-neutral-900">
                  {perMillion(prices.inputMiss)}
                </dd>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <dt className="text-neutral-600">输入 · 缓存命中</dt>
                <dd className="tabular-nums text-neutral-900">
                  {perMillion(prices.inputHit)}
                </dd>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <dt className="text-neutral-600">输出</dt>
                <dd className="tabular-nums text-neutral-900">
                  {perMillion(prices.output)}
                </dd>
              </div>
            </dl>
            <p className="border-t border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-400">
              {perMillion(prices.inputMiss)} / {perMillion(prices.inputHit)} /{" "}
              {perMillion(prices.output)} 每百万 token
            </p>
          </div>
        </section>
      </div>

      <section aria-labelledby="quota" className="mt-6">
        <h2 id="quota" className="mb-3 text-sm font-semibold text-neutral-900">
          配额
        </h2>
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-8 text-center">
          <p className="text-sm text-neutral-600">未接入，计划 D5 实现</p>
          <p className="mt-1 text-xs text-neutral-400">
            额度上限、超额拦截与告警暂时没有数据来源，这里不展示假进度。
          </p>
        </div>
      </section>
    </>
  );
}
