"use client";

import { useState } from "react";

/**
 * 【教学用】最小的「读流」页面
 *
 * 只有三步，没有任何抽象：
 *   1. fetch 拿到响应（注意：这时还没有内容！）
 *   2. response.body 是一个「管子」，用 getReader() 一段段读
 *   3. 读到的 Uint8Array 用 TextDecoder 转成文字，拼到状态里
 *
 * 页面上同时显示「拼好的结果」和「每次读到的原始块」——
 * 后者是关键：你会看到每次读到的**不是完整的字**，而是一小段。
 */
export default function DemoPage() {
  const [text, setText] = useState("");
  const [chunks, setChunks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function run() {
    setText("");
    setChunks([]);
    setLoading(true);

    try {
      // ① 发请求。注意：await 回来的 res 里**还没有内容**
      const res = await fetch("/api/demo/tick");
      if (!res.body) throw new Error("没有响应体");

      // ② body 是 ReadableStream，拿到「读卡器」
      const reader = res.body.getReader();

      // ③ 解码器：把字节转成字符串
      const decoder = new TextDecoder("utf-8");

      for (;;) {
        // ④ read() 是异步的，每次等到下一块数据才返回
        //    返回的 value 是 Uint8Array（字节），done 表示「没有更多了」
        const { done, value } = await reader.read();
        if (done) break;

        const piece = decoder.decode(value, { stream: true });

        // ⑤ 把这一块记下来（用来观察），并追加到总结果
        setChunks((prev) => [...prev, piece]);
        setText((prev) => prev + piece);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">最小流式 Demo</h1>
      <p className="text-sm text-neutral-600">
        这个接口不接模型，每 300ms 吐一个字。重点看下面两块：
        <b>上面是拼起来的完整结果</b>，<b>下面是每次 read() 实际拿到的内容</b>。
      </p>

      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "接收中…" : "开始接收"}
      </button>

      <section>
        <h2 className="mb-1 text-xs font-semibold text-neutral-500">
          ① 拼起来的完整结果
        </h2>
        <div className="min-h-[60px] rounded-lg border border-neutral-200 bg-white p-3 text-sm">
          {text || <span className="text-neutral-400">（空）</span>}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-xs font-semibold text-neutral-500">
          ② 每次 read() 实际拿到的块（共 {chunks.length} 次）
        </h2>
        <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          {chunks.length === 0 && (
            <span className="text-xs text-neutral-400">（空）</span>
          )}
          {chunks.map((c, i) => (
            <span
              key={i}
              className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 font-mono text-xs"
            >
              {c}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          观察：如果网络把两个字粘在一起发过来，这里就会看到一个块里有多个字符——
          这就是「一次 read 不等于一帧」的由来。
        </p>
      </section>
    </main>
  );
}
