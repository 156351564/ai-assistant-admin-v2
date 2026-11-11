"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "admin.settings.v1";
/** localStorage 读取抛错时的哨兵值，JSON.parse 必然失败，走「读取异常」分支 */
const READ_ERROR = "\u0000unavailable";

interface Settings {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  tools: boolean;
  moderation: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  systemPrompt: "你是一个简洁的助手",
  temperature: 0.7,
  maxTokens: 1024,
  stream: true,
  tools: false,
  moderation: false,
};

type ParseResult =
  | { ok: true; settings: Settings; saved: boolean }
  | { ok: false };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 只接受完整合法的对象；缺字段的旧数据按默认值补齐 */
function parseSettings(raw: string): ParseResult {
  if (raw === "") return { ok: true, settings: DEFAULT_SETTINGS, saved: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }

  const record = parsed as Record<string, unknown>;
  const temperature =
    typeof record.temperature === "number" && Number.isFinite(record.temperature)
      ? Math.round(clamp(record.temperature, 0, 2) * 10) / 10
      : DEFAULT_SETTINGS.temperature;
  const maxTokens =
    typeof record.maxTokens === "number" && Number.isFinite(record.maxTokens)
      ? clamp(Math.round(record.maxTokens), 64, 4096)
      : DEFAULT_SETTINGS.maxTokens;

  return {
    ok: true,
    saved: true,
    settings: {
      systemPrompt:
        typeof record.systemPrompt === "string"
          ? record.systemPrompt
          : DEFAULT_SETTINGS.systemPrompt,
      temperature,
      maxTokens,
      stream:
        typeof record.stream === "boolean" ? record.stream : DEFAULT_SETTINGS.stream,
      tools: typeof record.tools === "boolean" ? record.tools : DEFAULT_SETTINGS.tools,
      moderation:
        typeof record.moderation === "boolean"
          ? record.moderation
          : DEFAULT_SETTINGS.moderation,
    },
  };
}

/* ---------- localStorage 外部存储：用 useSyncExternalStore 订阅，避免 effect 内同步 setState ---------- */

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return READ_ERROR;
  }
}

function getServerSnapshot(): string {
  return "";
}

function writeSettings(next: Settings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  listeners.forEach((listener) => listener());
  return true;
}

/** 水合完成标志：服务端 false、客户端 true，用于渲染读取中的骨架 */
const subscribeHydrated = () => () => {};
const getHydratedClient = () => true;
const getHydratedServer = () => false;

/* ---------- 展示组件 ---------- */

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

function LoadingView() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">正在读取本地配置</span>
      <div aria-hidden>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-3 h-3 w-72" />
        <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-20 w-full" />
        </div>
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-6 w-40" />
        </div>
      </div>
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-neutral-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-neutral-900" : "bg-neutral-200"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/** 数字输入用草稿字符串，允许中途清空；失焦时才收敛到 64-4096 */
function MaxTokensInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(`${value}`);

  return (
    <input
      id="max-tokens"
      type="number"
      min={64}
      max={4096}
      inputMode="numeric"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = Number(draft);
        if (!Number.isFinite(next)) {
          setDraft(`${value}`);
          return;
        }
        const clamped = clamp(Math.round(next), 64, 4096);
        setDraft(`${clamped}`);
        onCommit(clamped);
      }}
      className="w-28 rounded-md border border-neutral-200 bg-white px-2 py-1 text-right text-sm tabular-nums text-neutral-900 outline-none transition focus:border-neutral-400"
    />
  );
}

/* ---------- 页面 ---------- */

export default function AdminSettingsPage() {
  const hydrated = useSyncExternalStore(
    subscribeHydrated,
    getHydratedClient,
    getHydratedServer,
  );
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const parsed = useMemo(() => parseSettings(raw), [raw]);
  const settings = parsed.ok ? parsed.settings : DEFAULT_SETTINGS;
  const [saveFailed, setSaveFailed] = useState(false);

  if (!hydrated) return <LoadingView />;

  const update = (patch: Partial<Settings>) => {
    setSaveFailed(!writeSettings({ ...settings, ...patch }));
  };

  const reset = () => {
    setSaveFailed(!writeSettings(DEFAULT_SETTINGS));
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">设置</h1>
        <p className="mt-1 text-sm text-neutral-500">
          模型调用参数。修改会立即写入浏览器本地存储。
        </p>
      </header>

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-800">
          当前为本地配置，尚未接入后端，不影响实际请求
        </p>
      </div>

      {!parsed.ok ? (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs leading-relaxed text-red-700">
            本地配置读取失败或格式异常，已使用默认值；任意修改都会覆盖保存为合法配置。
          </p>
        </div>
      ) : null}

      {saveFailed ? (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs leading-relaxed text-red-700">
            本地配置保存失败（浏览器存储不可用或已满），本次修改不会保留。
          </p>
        </div>
      ) : null}

      {parsed.ok && !parsed.saved ? (
        <p className="mb-4 text-xs text-neutral-400">
          尚未保存过配置，当前显示默认值；修改后会自动保存在本机。
        </p>
      ) : null}

      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 p-4">
          <label
            htmlFor="system-prompt"
            className="text-sm font-medium text-neutral-900"
          >
            系统提示词
          </label>
          <textarea
            id="system-prompt"
            rows={4}
            value={settings.systemPrompt}
            onChange={(event) => update({ systemPrompt: event.target.value })}
            className="mt-2 w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900 outline-none transition focus:border-neutral-400"
          />
          <p className="mt-1 text-[11px] text-neutral-400">
            当前仅保存在本机，不会发给服务端。
          </p>
        </div>

        <div className="border-b border-neutral-100 p-4">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="temperature" className="text-sm font-medium text-neutral-900">
              temperature
            </label>
            <span className="text-sm tabular-nums text-neutral-900">
              {settings.temperature.toFixed(1)}
            </span>
          </div>
          <input
            id="temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onChange={(event) => update({ temperature: Number(event.target.value) })}
            className="mt-3 w-full accent-neutral-900"
          />
          <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
            <span>0.0 更确定</span>
            <span>2.0 更发散</span>
          </div>
        </div>

        <div className="border-b border-neutral-100 p-4">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="max-tokens" className="text-sm font-medium text-neutral-900">
              max_tokens
            </label>
            <MaxTokensInput
              key={settings.maxTokens}
              value={settings.maxTokens}
              onCommit={(value) => update({ maxTokens: value })}
            />
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            范围 64 – 4096，输入框失去焦点时保存。
          </p>
        </div>

        <div className="divide-y divide-neutral-100">
          <div className="p-4">
            <Switch
              label="流式输出"
              checked={settings.stream}
              onChange={(value) => update({ stream: value })}
            />
          </div>
          <div className="p-4">
            <Switch
              label="工具调用"
              checked={settings.tools}
              onChange={(value) => update({ tools: value })}
            />
          </div>
          <div className="p-4">
            <Switch
              label="内容审核"
              checked={settings.moderation}
              onChange={(value) => update({ moderation: value })}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-[11px] text-neutral-400">
          保存在 localStorage · {STORAGE_KEY}
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900"
        >
          恢复默认
        </button>
      </div>
    </div>
  );
}
