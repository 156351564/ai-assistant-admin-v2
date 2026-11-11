"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const NAV_ITEMS = [
  { href: "/admin", label: "概览", hint: "今日指标与趋势" },
  { href: "/admin/sessions", label: "会话", hint: "列表与消息详情" },
  { href: "/admin/usage", label: "用量", hint: "成本、缓存与配额" },
  { href: "/admin/settings", label: "设置", hint: "模型与调用参数" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Next 16 Cache Components：usePathname() 必须在 Suspense 内，否则动态路由预渲染会被阻塞。
 * fallback 与正式导航结构一致、只是不显示高亮，避免布局跳动。
 */
export default function AdminNav() {
  return (
    <Suspense fallback={<NavBody pathname={null} />}>
      <NavWithPathname />
    </Suspense>
  );
}

function NavWithPathname() {
  return <NavBody pathname={usePathname()} />;
}

function NavBody({ pathname }: { pathname: string | null }) {
  return (
    <>
      {/* 桌面端：220px 固定侧边栏。用 md:fixed 而不是 flex 子项，内容区靠 md:pl-[220px] 让位 */}
      <aside className="hidden border-neutral-200 bg-white md:fixed md:inset-y-0 md:left-0 md:z-20 md:flex md:w-[220px] md:flex-col md:border-r">
        <div className="px-4 py-5">
          <Link href="/admin" className="block">
            <p className="text-sm font-semibold text-neutral-900">AI 助手后台</p>
            <p className="mt-0.5 text-[11px] text-neutral-400">运营侧与模型侧</p>
          </Link>
        </div>

        <nav aria-label="后台导航" className="flex-1 px-3">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname !== null && isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "block rounded-md bg-neutral-100 px-3 py-2 text-neutral-900"
                        : "block rounded-md px-3 py-2 text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900"
                    }
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    <span
                      className={
                        active
                          ? "mt-0.5 block text-[11px] text-neutral-500"
                          : "mt-0.5 block text-[11px] text-neutral-400"
                      }
                    >
                      {item.hint}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-neutral-200 px-4 py-3">
          <Link
            href="/"
            className="text-xs text-neutral-500 transition hover:text-neutral-900"
          >
            ← 返回作品集首页
          </Link>
        </div>
      </aside>

      {/* 移动端：侧边栏收起，变成顶部标题 + 横向标签 */}
      <div className="sticky top-0 z-20 border-b border-neutral-200 bg-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/admin" className="text-sm font-semibold text-neutral-900">
            AI 助手后台
          </Link>
          <Link href="/" className="text-xs text-neutral-500">
            首页
          </Link>
        </div>
        <nav aria-label="后台导航" className="overflow-x-auto px-2 pb-2">
          <ul className="flex gap-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname !== null && isActive(pathname, item.href);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "block rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900"
                        : "block rounded-full px-3 py-1.5 text-xs text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900"
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
