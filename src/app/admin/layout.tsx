import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import AdminNav from "@/components/AdminNav";

export const metadata: Metadata = {
  title: {
    default: "概览",
    template: "%s ｜ AI 助手管理后台",
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <AdminNav />
      {/* md:pl-[220px] 给固定侧边栏让出宽度；移动端顶部标签是文档流内的 sticky，不需要偏移 */}
      <div className="md:pl-[220px]">
        <div className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-6">
          <div className="flex justify-start pb-4">
            <Link
              href="/"
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700"
            >
              ← 返回作品集首页
            </Link>
          </div>
        </div>
        <main className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6 lg:pb-12">
          {children}
        </main>
      </div>
    </div>
  );
}
