/**
 * SSE 帧解析器（纯函数，不依赖 React / 浏览器 API）
 *
 * 为什么单独抽出来：
 * 1. 它是流式的前端核心，逻辑独立，可以单测（喂半帧、喂乱序、喂 CRLF）
 * 2. 解析协议和渲染 UI 混在一起，后面想做「多会话并发流」会寸步难行
 *
 * SSE 协议（服务端发给我们的样子）：
 *   event: delta\n
 *   data: {"text":"你"}\n
 *   \n
 *   event: delta\n
 *   data: {"text":"好"}\n
 *   \n
 *
 * 关键点：**一次 read() 拿到的不是一帧**，可能是「半帧」「一帧半」「三帧」。
 * 所以必须自己维护 buffer，按 \n\n 切，切不开的部分留着等下一块。
 */

export interface SseEvent {
  /** 事件名，服务端用 event: xxx 指定；没写就是 "message" */
  event: string;
  /** data 字段的原始字符串（多行 data 会用 \n 拼接） */
  data: string;
}

export interface SseParser {
  push(chunk: string): void;
  /** 连接结束时调用：把残留的不完整帧处理掉（通常直接丢弃） */
  flush(): void;
  /** 当前还留在 buffer 里没凑成完整帧的字符数（调试用） */
  pending(): number;
}

export function createSseParser(onEvent: (e: SseEvent) => void): SseParser {
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  function reset() {
    eventName = "message";
    dataLines = [];
  }

  function dispatch() {
    if (dataLines.length === 0) {
      reset();
      return;
    }
    const payload = dataLines.join("\n");
    const name = eventName;
    reset();
    onEvent({ event: name, data: payload });
  }

  return {
    push(chunk: string) {
      // ① 统一换行：有些代理会把 \n 改写成 \r\n，不归一化就永远找不到 \n\n
      buffer += chunk.replace(/\r\n/g, "\n");

      // ② 循环切帧：一次可能拿到多帧
      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx === -1) break; // 剩下的半帧留到下一次
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        // ③ 逐行解析这一帧
        for (const line of block.split("\n")) {
          if (!line) continue;
          if (line.startsWith(":")) continue; // 冒号开头是注释（心跳常用）

          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1); // 规范：冒号后可跟一个空格

          if (field === "event") eventName = value;
          else if (field === "data") dataLines.push(value);
          // id / retry 字段暂不处理（断线重连时才用得上）
        }

        dispatch();
      }
    },

    flush() {
      // 连接关闭时 buffer 里若还有内容，说明服务端最后一帧没写完
      // 这种情况按丢弃处理，不要硬解析——半截 JSON 只会让 UI 崩
      buffer = "";
      reset();
    },

    pending() {
      return buffer.length;
    },
  };
}
