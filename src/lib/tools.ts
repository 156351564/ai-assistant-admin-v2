import { z } from "zod";

/**
 * D3 · 工具定义与执行器
 *
 * 这里有两个东西，别混：
 *   1. toolDefinitions —— 给「模型」看的说明书（JSON Schema）
 *   2. executeTool     —— 给「你的程序」执行的实现
 *
 * 模型只负责「说出想调哪个工具、参数是什么」，它永远碰不到你的数据库。
 * 真正执行的是 executeTool。这是 FC 最重要的边界。
 */

/** ① 给模型看的工具说明书 —— 必须是 OpenAI 的 tools 格式 */
export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "getOrderStatus",
      description: "根据订单号查询订单当前状态。用户问「我的订单到哪了/发货了吗」时使用。",
      parameters: {
        type: "object",
        properties: {
          orderId: {
            type: "string",
            description: "订单号，形如 A123 或 B456",
          },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getShippingEta",
      description: "查询订单的预计送达时间。仅当订单已发货时才调用。",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "订单号" },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getCurrentTime",
      description: "获取当前时间。用户问「现在几点/今天几号」时使用。",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "时区，默认 Asia/Shanghai",
          },
        },
        required: [],
      },
    },
  },
];

/** ② 参数的 zod 校验 —— 模型给的参数同样不可信 */
const OrderArgs = z.object({ orderId: z.string().min(1) });
const TimeArgs = z.object({ timezone: z.string().optional() });

/** 假的订单库 */
const ORDERS: Record<string, { status: string; eta: string; items: number }> = {
  A123: { status: "已发货", eta: "11月12日", items: 2 },
  B456: { status: "待发货", eta: "预计 11月15日发出", items: 1 },
};

export interface ToolResult {
  ok: boolean;
  /** 回填给模型的内容（字符串，通常是 JSON） */
  content: string;
}

/**
 * ③ 执行器
 *
 * 三条纪律：
 *   - 参数必须校验（模型可能给错字段、错类型）
 *   - 任何异常都要变成「可读的错误文本」返回给模型，不要直接抛
 *     （抛了整条链路就断了；返回错误文本，模型有机会自己修正或换个说法）
 *   - 永远不返回敏感信息
 */
export async function executeTool(
  name: string,
  rawArgs: string,
): Promise<ToolResult> {
  let args: unknown;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { ok: false, content: `参数不是合法 JSON：${rawArgs.slice(0, 100)}` };
  }

  try {
    switch (name) {
      case "getOrderStatus": {
        const { orderId } = OrderArgs.parse(args);
        const order = ORDERS[orderId];
        if (!order) {
          return { ok: false, content: `未找到订单 ${orderId}，请让用户确认订单号。` };
        }
        return {
          ok: true,
          content: JSON.stringify({
            orderId,
            status: order.status,
            items: order.items,
          }),
        };
      }

      case "getShippingEta": {
        const { orderId } = OrderArgs.parse(args);
        const order = ORDERS[orderId];
        if (!order) {
          return { ok: false, content: `未找到订单 ${orderId}。` };
        }
        if (order.status !== "已发货") {
          return {
            ok: false,
            content: `订单 ${orderId} 当前状态是「${order.status}」，尚未发货，没有预计送达时间。`,
          };
        }
        return { ok: true, content: JSON.stringify({ orderId, eta: order.eta }) };
      }

      case "getCurrentTime": {
        const { timezone } = TimeArgs.parse(args);
        const tz = timezone ?? "Asia/Shanghai";
        return {
          ok: true,
          content: JSON.stringify({
            timezone: tz,
            now: new Date().toLocaleString("zh-CN", { timeZone: tz }),
          }),
        };
      }

      default:
        return { ok: false, content: `不存在的工具：${name}` };
    }
  } catch (err) {
    // zod 校验失败也走这里：把「哪个字段错了」告诉模型，它通常能自己改
    const msg = err instanceof Error ? err.message.slice(0, 150) : "参数校验失败";
    return { ok: false, content: `工具参数有误：${msg}` };
  }
}

/** 给前端展示用的工具名 → 中文标签 */
export const TOOL_LABELS: Record<string, string> = {
  getOrderStatus: "查询订单状态",
  getShippingEta: "查询预计送达",
  getCurrentTime: "获取当前时间",
};
