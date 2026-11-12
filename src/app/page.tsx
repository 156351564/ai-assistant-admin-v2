import Link from "next/link";

/** 首页：作品集的入口页。所有入口都指向真实可访问的页面，不链 API 端点 */
const modules = [
  {
    href: "/chat",
    title: "流式对话",
    desc: "SSE 打字机效果、随时中断、首字延迟打点",
    state: "已完成",
    tone: "done" as const,
    external: false,
  },
  {
    href: "https://github.com/156351564/rag-kb-qa",
    title: "知识库问答",
    desc: "独立 Python 服务：切分策略对比、召回兜底、异步入库、流式引用",
    state: "独立服务",
    tone: "done" as const,
    external: true,
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

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/admin"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white transition hover:bg-neutral-700"
          >
            进入管理后台 →
          </Link>
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
                  <span className="text-xs text-neutral-500">
                    {m.external ? "查看仓库 →" : "进入 →"}
                  </span>
                )}
              </div>
            );

            // 外链用原生 a：Next 的 Link 适合站内路由，外链交给浏览器更直接
            const inner = m.external ? (
              <a href={m.href} target="_blank" rel="noreferrer" className="block h-full">
                {body}
              </a>
            ) : (
              <Link href={m.href} className="block h-full">
                {body}
              </Link>
            );

            return <li key={m.title}>{clickable ? inner : body}</li>;
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
