# AI 助手管理后台

把「运营侧」和「模型侧」接起来的 LLM 应用实践项目。前端 Next.js，模型接入层统一封装、供应商可切换，覆盖流式对话、工具调用、结构化输出与成本核算。

> 面向 AI 应用开发岗位的练手项目：每个模块都做了「能讲清原理」的取舍，而不是只把接口调通。

**在线 Demo**：<https://ai-assistant-admin-v2.vercel.app>
> ⚠️ 部署在 Vercel 海外节点，**中国大陆访问需要科学上网**。
> 不想开代理的话，看下方 GIF 演示，或直接读代码。


---

## 功能进度

| 模块 | 状态 | 说明 |
|---|---|---|
| SSE 流式对话 | ✅ | 打字机效果、随时中断、首字延迟打点 |
| 多轮上下文 | ✅ | 20 条窗口截断，防止越聊越贵 |
| 增量 Markdown 渲染 | ✅ | 按块 memo，未闭合代码块降级不闪烁 |
| Function Calling | ✅ | 3 个工具、自动串行、防死循环 |
| 结构化输出 | ✅ | zod 校验 + 错误回传重试 |
| 成本核算 | ✅ | 真实账单反推单价、缓存命中分析 |
| 后台概览 | ✅ | 今日请求/token/成本 + 近 7 日趋势 |
| 会话列表与详情 | ✅ | 分页、消息序列、单条耗时与 token |
| 用量与成本看板 | ✅ | 缓存命中率、场景成本、单价表 |
| 参数设置 | ✅ | **本地 localStorage，未接入后端** |
| 会话持久化 | 🚧 | 当前内存版：进程重启丢失、多实例不共享 |
| 配额拦截 | 🚧 | 计划中，按金额而非次数 |
| RAG 知识库问答 | 🚧 | 计划中（独立 Python 服务） |

> ⚠️ **当前实现的已知限制**：会话与用量存在进程内存里（`src/lib/store.ts`）。
> 本地开发重启即丢，部署到 Vercel 后多副本之间不共享。
> 接口已按存储层设计，接 Neon/Postgres 只需替换 `store.ts` 的实现。
> 参数设置页是纯前端 localStorage，不会影响实际请求——页面上有醒目提示。

---

## 技术栈

- **前端**：Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS
- **模型**：DeepSeek 官方 API（OpenAI 兼容），支持主备供应商切换
- **校验**：zod（请求参数 + 模型结构化输出双重校验）
- **部署**：Vercel

---

## 快速开始

```bash
pnpm install
cp .env.example .env.local   # 填入自己的 key，见下方说明
pnpm dev
```

打开 <http://localhost:3000>，各模块入口见首页。

### 环境变量

| 变量 | 说明 |
|---|---|
| `OPENAI_BASE_URL` | 模型网关地址，如 `https://api.deepseek.com` |
| `OPENAI_API_KEY` | 密钥（**仅在服务端使用，不会下发到前端**） |
| `OPENAI_MODEL` | 模型名，如 `deepseek-chat` |
| `FALLBACK_*` | 备用供应商，主供应商失败时降级 |
| `DASHSCOPE_API_KEY` | 通义 Embedding（RAG 用） |
| `LLM_MAX_TOKENS` / `LLM_TIMEOUT_MS` | 生成上限与超时 |

> `.env*` 已在 `.gitignore` 中，密钥不会进仓库。

---

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts              # 非流式对话
│   │   ├── chat/stream/route.ts       # SSE 流式对话（含会话落库）
│   │   ├── agent/route.ts             # Function Calling
│   │   ├── extract/route.ts           # 结构化输出（信息抽取）
│   │   ├── sessions/route.ts          # 会话列表（分页）
│   │   ├── sessions/[id]/route.ts     # 会话详情（动态路由，params 是 Promise）
│   │   ├── usage/route.ts             # 用量与成本聚合
│   │   └── demo/tick/route.ts         # 教学用最小流式接口
│   ├── chat/page.tsx                  # 对话界面
│   ├── demo/page.tsx                  # 流式原理演示页
│   └── admin/
│       ├── layout.tsx                 # 后台壳（固定侧边栏 + 内容区）
│       ├── page.tsx                   # 概览：今日指标 + 近 7 日趋势
│       ├── sessions/page.tsx          # 会话列表（分页）
│       ├── sessions/[id]/page.tsx     # 会话详情（服务端壳 + 客户端数据区）
│       ├── usage/page.tsx             # 用量与成本看板
│       └── settings/page.tsx          # 参数设置（本地 localStorage）
├── components/
│   ├── AdminNav.tsx                   # 后台导航（usePathname 需 Suspense）
│   ├── ChatBox.tsx                    # 会话界面
│   ├── SessionDetail.tsx              # 会话详情数据区
│   └── MarkdownStream.tsx             # 增量 Markdown 渲染
└── lib/
    ├── llm.ts                         # 模型客户端与统一错误映射
    ├── sse.ts                         # SSE 帧解析器（纯函数）
    ├── useChatStream.ts               # 流式状态机
    ├── markdown-split.ts              # Markdown 分块
    ├── schema.ts                      # zod schema
    ├── structured.ts                  # 结构化调用 + 重试
    ├── tools.ts                       # 工具定义与执行器
    ├── cost.ts                        # 成本核算与单价表
    ├── store.ts                       # 会话/用量存储（当前内存版）
    └── types.ts                       # 共享类型
```

---

## 关键设计

### 1. SSE 事件协议（不靠断连判断结束）

服务端自定义五种事件，每帧 `event: 名称` + `data: JSON` + 空行：

```
event: start   →  { traceId, model }
event: delta   →  { text }
event: usage   →  { promptTokens, completionTokens }
event: done    →  { ttftMs, totalMs }
event: error   →  { code, message }
```

**结束信号由协议层显式下发**，因为「连接断开」无法区分正常结束、网关超时、用户断网、服务端崩溃。

### 2. 中断三层透传

```
前端 AbortController → 服务端 request.signal → SDK abort → 模型停止生成
```

少最后一层会出现「用户点了停止，token 还在计费」。

### 3. 前端帧解析

TCP 不保证消息边界，一次 `read()` 可能拿到半帧或多帧，所以维护 buffer 按 `\n\n` 切分；`TextDecoder` 必须带 `{ stream: true }`，否则被切断的多字节中文会变成 `�` 且永久丢失。

### 4. 结构化输出三重防线

`Prompt 约束 → zod 校验 → 带错误信息的重试`。两次校验失败返回 422，不把脏数据写库。

### 5. 供应商可切换

baseURL / key / model 全部走环境变量，`createClient()` 参数化，主备互为降级，业务代码不关心供应商是谁。

---

## 实测数据

| 指标 | 数值 |
|---|---|
| 首字延迟 TTFT | **385 ms**（官方 deepseek-chat，88 字回答） |
| 总耗时 | 832 ms |
| FC 单工具 | 2 轮模型调用，1155 input tokens |
| FC 双工具（自动串行） | 3 轮，1833 input tokens |
| 无工具对话 | 1 轮，538 input tokens（system + 工具定义的固定开销） |
| 缓存命中率 | **50.7%**（FC 前缀每次命中约 341 token） |
| 单次成本 | 普通问答 ¥0.0010 ｜ FC 双工具 ¥0.0044 ｜ 命中缓存后 ¥0.0024 |
| 全天开发总消耗 | ¥0.0074（11 次请求） |

> 数据来自 DeepSeek 控制台导出的真实账单（`cost-*.csv` / `amount-*.csv`），单价从账单反推，未使用估算值。

---

## 踩坑记录

真实踩过的坑，写在这里是因为它们比功能更能说明问题：

1. **`Invalid state: Controller is already closed`** — 客户端断开后 ReadableStream 的 controller 失效，服务端仍在 `enqueue`。修法：`cancel()` 回调置标记 + 写前判空 + `close()` 兜异常。
2. **中文乱码的两种成因** — 一是响应头缺 `charset=utf-8` 被按 Latin-1 解码（解码方式错）；二是多字节字符被 chunk 切断、`TextDecoder` 未带 `stream: true`（解码时机错）。
3. **Next 16 的三个变化** — 启用 Cache Components 后不能导出 `runtime`；`middleware.ts` 改名 `proxy.ts`；`Response.json` 在该版本 TS 配置下无类型，需用 `NextResponse.json`。
4. **OpenAI SDK v7 的 `tool_calls` 是联合类型** — 不判 `type === "function"` 会 TS2339。
5. **FC 的消息回填** — 漏掉带 `tool_calls` 的 assistant 消息会直接 400（`tool must follow assistant with tool_calls`）。
6. **`Omit<T, K>` 不校验 key** — 拼错 key 是静默失效，需用 `satisfies readonly (keyof T)[]` 约束。

---

## 后续计划

- [ ] 会话列表与日志、异常标记
- [ ] 用量看板（按日 token、成本、缓存命中率）
- [ ] 按金额而非次数的配额
- [ ] RAG 知识库：Python + FastAPI + Chroma，异步入库 + 引用溯源
- [ ] MCP Server

---

## License

个人学习项目，MIT。
