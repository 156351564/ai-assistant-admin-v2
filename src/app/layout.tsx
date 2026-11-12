import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "AI 助手管理后台",
    template: "%s ｜ AI 助手管理后台",
  },
  description:
    "基于 Next.js + DeepSeek 的 AI 助手管理后台：SSE 流式对话、Function Calling、配额与用量统计。RAG 知识库问答为配套的独立 Python 服务。",
  applicationName: "AI 助手管理后台",
  keywords: ["AI 应用", "大模型", "SSE", "流式输出", "Function Calling", "SSE 解析"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
