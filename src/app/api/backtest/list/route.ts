import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { BacktestRow, Pair, Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await db.backtest.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const rows: BacktestRow[] = items.map((b) => ({
    id: b.id,
    symbol: b.symbol as Pair,
    timeframe: b.timeframe as Timeframe,
    strategy: b.strategy,
    fromDate: b.fromDate,
    toDate: b.toDate,
    initialCapital: b.initialCapital,
    finalCapital: b.finalCapital,
    totalTrades: b.totalTrades,
    wins: b.wins,
    losses: b.losses,
    winRate: b.winRate,
    profitFactor: b.profitFactor,
    maxDrawdown: b.maxDrawdown,
    netProfit: b.netProfit,
    createdAt: b.createdAt.toISOString(),
  }));
  return NextResponse.json({ backtests: rows });
}
