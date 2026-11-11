import type { Metadata } from "next";
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
        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
