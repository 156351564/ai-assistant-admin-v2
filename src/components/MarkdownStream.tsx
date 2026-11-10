"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitMarkdown } from "@/lib/markdown-split";

/**
 * 流式 Markdown 渲染器
 *
 * 核心两点：
 * 1. 按块渲染 + React.memo —— 已完成的块不会因为新 token 而重新渲染
 * 2. 未闭合代码块降级成纯文本 —— 避免流式途中反复解析半截代码导致闪烁/跳动
 */

/** 段落块：内容不变就不重新解析 Markdown */
const TextBlock = memo(function TextBlock({ content }: { content: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
});

/** 代码块：闭合前只当纯文本，闭合后才加语言标识（后续可接高亮） */
const CodeBlock = memo(function CodeBlock({
  content,
  lang,
  closed,
}: {
  content: string;
  lang: string;
  closed: boolean;
}) {
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5 text-[11px] text-neutral-500">
        <span className="font-mono">{lang || "text"}</span>
        {!closed && <span className="text-amber-600">生成中…</span>}
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="font-mono">{content}</code>
      </pre>
    </div>
  );
});

export default function MarkdownStream({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  // 每次 delta 都会重算切块（字符串扫描，很便宜），
  // 但真正的渲染成本被 memo 挡掉了
  const blocks = useMemo(() => splitMarkdown(text), [text]);

  if (!text) return null;

  return (
    <div>
      {blocks.map((b) =>
        b.kind === "text" ? (
          <TextBlock key={b.key} content={b.content} />
        ) : (
          <CodeBlock key={b.key} content={b.content} lang={b.lang} closed={b.closed} />
        ),
      )}
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-neutral-800 align-middle" />
      )}
    </div>
  );
}
