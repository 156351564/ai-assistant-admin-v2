import Link from "next/link";

/** 首页：作品集的入口页。后面 D4/D6 加后台模块时，这里会变成导航壳 */
const modules = [
  {
    href: "/chat",
    title: "流式对话",
    desc: "SSE 打字机效果、随时中断、首字延迟打点",
    state: "已完成",
    tone: "done" as const,
  },
  {
    href: "/api/chat",
    title: "非流式接口",
    desc: "统一 ChatResult 结构、错误码映射、超时中断",
    state: "已完成",
    tone: "done" as const,
  },
  {
    href: "/api/chat/stream",
    title: "流式接口",
    desc: "text/event-stream，事件类型 start / delta / done / error",
    state: "已完成",
    tone: "done" as const,
  },
  {
    href: "#",
    title: "会话与日志",
    desc: "会话列表、消息详情、异常标记",
    state: "D3-D4 待做",
    tone: "todo" as const,
  },
  {
    href: "#",
    title: "用量与配额",
    desc: "按日 token 用量、成本核算、超额拦截",
    state: "D4 待做",
    tone: "todo" as const,
  },
  {
    href: "#",
    title: "知识库问答",
    desc: "文档入库、向量检索、引用溯源",
    state: "D5 待做",
    tone: "todo" as const,
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="mb-2 text-xs tracking-widest text-neutral-400">
          2 年前端 · 转 AI 应用开发
        </p>
        <h1 className="text-2xl font-semibold text-neutral-900">
          AI 助手管理后台
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-600">
          把「运营侧」和「模型侧」接起来的实践项目：前端用 Next.js，
          模型接入层统一封装，供应商可切换（官方 / 中转互为降级）。
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-neutral-500">
          {["Next.js 16", "TypeScript", "DeepSeek", "SSE", "Tailwind CSS"].map(
            (t) => (
              <span
                key={t}
                className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1"
              >
                {t}
              </span>
            ),
          )}
        </div>
      </header>

      <section aria-labelledby="modules">
        <h2
          id="modules"
          className="mb-4 text-sm font-semibold tracking-wide text-neutral-500"
        >
          功能模块
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {modules.map((m) => {
            const clickable = m.href !== "#";
            const body = (
              <div className="flex h-full flex-col justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-400">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-neutral-900">
                      {m.title}
                    </h3>
                    <span
                      className={
                        m.tone === "done"
                          ? "shrink-0 rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700"
                          : "shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500"
                      }
                    >
                      {m.state}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-600">
                    {m.desc}
                  </p>
                </div>
                {clickable && (
                  <span className="text-xs text-neutral-500">进入 →</span>
                )}
              </div>
            );

            return (
              <li key={m.title}>
                {clickable ? (
                  <Link href={m.href} className="block h-full">
                    {body}
                  </Link>
                ) : (
                  <div className="h-full cursor-not-allowed opacity-60">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
        本地开发：<code className="font-mono">pnpm dev</code> ｜
        模型调用全部走服务端，密钥不出现在前端。
      </footer>
    </main>
  );
}
