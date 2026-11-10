/**
 * 【教学用】最小流式接口 —— 不接模型，只演示「流」本身
 *
 * 这个接口做的事：
 *   每 300ms 往前端推一个字，推 10 个字，然后结束。
 *
 * 目的：把「模型调用」「SSE 协议」「Markdown 渲染」全部剥离，
 * 只留下一个东西：**响应体可以分多次写、分多次读**。
 *
 * 打开 http://localhost:3000/demo 看效果，同时打开浏览器 Network 面板
 * 看这个请求的 Response —— 你会亲眼看到内容是「一点点长出来」的。
 */
export async function GET() {
  const encoder = new TextEncoder();
  const words = "流式输出就是把一次响应拆成很多小块慢慢发".split("");

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 关键点 1：controller.enqueue() 就是「现在先发这一小块」
      // 它不会等整个函数跑完，发出去前端立刻就能收到
      for (const w of words) {
        controller.enqueue(encoder.encode(w));
        // 关键点 2：await 暂停 300ms，模拟模型「一个字一个字想」的过程
        await new Promise((r) => setTimeout(r, 300));
      }
      // 关键点 3：不开 close，浏览器会一直等下去（旋转的加载图标不会停）
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
