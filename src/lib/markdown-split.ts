/**
 * 把流式累积的 Markdown 切成「块」
 *
 * 为什么不在每次 delta 时整段重新渲染：
 * 一段 5000 字的回答，流的途中每来一个 token 就整段重新解析 + 重新渲染，
 * 主线程会被占满，表现为「越流越卡、输入框打不出字」。
 *
 * 切成块之后，已完成的块内容不再变化 → React.memo 直接跳过，
 * 每次只有最后一个块（正在长的那个）重新渲染。渲染量从 O(全文) 降到 O(一段)。
 *
 * 块的划分依据：
 *   - 围栏代码块 ``` 单独成块（最重要的：代码块内部不能按段落切）
 *   - 空行分隔的段落各自成块
 */

export type MarkdownBlock =
  | { key: string; kind: "text"; content: string }
  | { key: string; kind: "code"; lang: string; content: string; closed: boolean };

export function splitMarkdown(src: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = src.split("\n");

  let textBuf: string[] = [];
  let codeBuf: string[] = [];
  let inCode = false;
  let lang = "";
  let seq = 0;

  const flushText = () => {
    const content = textBuf.join("\n").trim();
    if (content) {
      blocks.push({ key: `t${seq++}`, kind: "text", content });
    }
    textBuf = [];
  };

  const flushCode = (closed: boolean) => {
    blocks.push({
      key: `c${seq++}`,
      kind: "code",
      lang,
      content: codeBuf.join("\n"),
      closed,
    });
    codeBuf = [];
    lang = "";
  };

  for (const line of lines) {
    const fence = line.match(/^```([\w+-]*)\s*$/);

    if (fence) {
      if (inCode) {
        // 结束围栏：代码块「闭合」，可以安全高亮
        flushCode(true);
        inCode = false;
      } else {
        // 开始围栏：先把前面的文本吐出去
        flushText();
        inCode = true;
        lang = fence[1] || "";
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    // 空行 = 段落边界
    if (line.trim() === "") {
      flushText();
      continue;
    }

    textBuf.push(line);
  }

  // 收尾：流还没结束时，代码块是「未闭合」的，标记出来交给渲染层降级处理
  if (inCode) flushCode(false);
  flushText();

  return blocks;
}
