import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Pair, Side, TradeRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const trades = await db.trade.findMany({ orderBy: { openedAt: "desc" }, take: 200 });
  const rows: TradeRow[] = trades.map((t) => ({
    id: t.id,
    ticket: t.ticket,
    symbol: t.symbol as Pair,
    side: t.side as Side,
    lotSize: t.lotSize,
    openPrice: t.openPrice,
    closePrice: t.closePrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    trailingStop: t.trailingStop,
    trailingPips: t.trailingPips,
    slPips: t.slPips,
    tpPips: t.tpPips,
    pnl: t.pnl,
    pips: t.pips,
    status: t.status as "OPEN" | "CLOSED",
    source: t.source as "MANUAL" | "AI",
    strategy: t.strategy,
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
  }));
  return NextResponse.json({ trades: rows });
}
