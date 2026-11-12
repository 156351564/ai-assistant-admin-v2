import Link from "next/link";

/**
 * 首页：作品集入口。
 *
 * 两个分组不能合并：上面是本仓库真实存在的页面（站内路由），
 * 下面是配套的独立项目（外链到另一个仓库）。混在一组里会让人以为
 * 「知识库问答」也是这个站点的功能，点开却跳到 GitHub，预期错位。
 */
interface CardItem {
  href: string;
  title: string;
  desc: string;
  state: string;
  /** true 表示外链，用原生 a + target=_blank */
  external?: boolean;
}

const features: CardItem[] = [
  {
    href: "/chat",
    title: "流式对话",
    desc: "SSE 打字机效果、随时中断、首字延迟打点",
    state: "已完成",
  },
];

const related: CardItem[] = [
  {
    href: "https://github.com/156351564/rag-kb-qa",
    title: "RAG 知识库问答",
    desc: "独立 Python 服务（FastAPI + Chroma）：切分策略对比、召回兜底、异步入库、流式引用",
    state: "独立项目",
    external: true,
  },
];

function Card({ item }: { item: CardItem }) {
  const body = (
    <div className="flex h-full flex-col justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-400">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-neutral-900">{item.title}</h3>
          <span className="shrink-0 rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700">
            {item.state}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">{item.desc}</p>
      </div>
      <span className="text-xs text-neutral-500">
        {item.external ? "查看仓库 →" : "进入 →"}
      </span>
    </div>
  );

  // 外链用原生 a：Next 的 Link 面向站内路由，外链交给浏览器更直接
  return item.external ? (
    <a href={item.href} target="_blank" rel="noreferrer" className="block h-full">
      {body}
    </a>
  ) : (
    <Link href={item.href} className="block h-full">
      {body}
    </Link>
  );
}

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

      <section aria-labelledby="features">
        <h2
          id="features"
          className="mb-4 text-sm font-semibold tracking-wide text-neutral-500"
        >
          本项目功能
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map((item) => (
            <li key={item.title}>
              <Card item={item} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-400">
          管理后台包含四页：
          <Link href="/admin" className="mx-1 underline hover:text-neutral-700">
            概览
          </Link>
          ·
          <Link href="/admin/sessions" className="mx-1 underline hover:text-neutral-700">
            会话
          </Link>
          ·
          <Link href="/admin/usage" className="mx-1 underline hover:text-neutral-700">
            用量
          </Link>
          ·
          <Link href="/admin/settings" className="mx-1 underline hover:text-neutral-700">
            设置
          </Link>
        </p>
      </section>

      <section aria-labelledby="related" className="mt-10">
        <h2
          id="related"
          className="mb-4 text-sm font-semibold tracking-wide text-neutral-500"
        >
          配套项目
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {related.map((item) => (
            <li key={item.title}>
              <Card item={item} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-400">
          部署形态不同，所以没合并：本仓库在 Vercel（serverless），
          RAG 需要常驻 Python 进程。强行合并会让线上出现「页面能开、接口 404」。
        </p>
      </section>

      <footer className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
        本地开发：<code className="font-mono">pnpm dev</code> ｜
        模型调用全部走服务端，密钥不出现在前端。
      </footer>
    </main>
  );
}
