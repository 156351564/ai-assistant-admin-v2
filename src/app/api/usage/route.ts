import { NextResponse } from "next/server";
import { usageSummary } from "@/lib/store";
import {
  PRICE_TABLE,
  SCENARIO_SAMPLES,
  costPerThousand,
  estimateCost,
  formatCny,
} from "@/lib/cost";

/**
 * GET /api/usage?days=7 —— 用量与成本
 *
 * 返回：
 *   - today / week：聚合（含缓存命中率）
 *   - series：每日序列（图表用）
 *   - scenarios：典型场景的千次成本（报价 / 配额参考）
 *   - prices：当前生效的单价表（前端展示「为什么是这个钱」）
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") ?? 7)));

  const summary = usageSummary(days);

  // 单价统一从 cost.ts 取，避免两处写死后数值对不上
  const scenarios = Object.entries(SCENARIO_SAMPLES).map(([name, tokens]) => ({
    name,
    perCall: formatCny(estimateCost(tokens)),
    thousandCost: costPerThousand(tokens),
  }));

  return NextResponse.json(
    {
      ok: true,
      data: {
        days,
        ...summary,
        scenarios,
        prices: PRICE_TABLE.standard,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
