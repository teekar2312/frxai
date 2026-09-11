import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { BacktestRow, Pair, Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";

// H3: Load a single backtest by ID, including the full equity curve
// (the `result` JSON column that /api/backtest/list doesn't return)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bt = await db.backtest.findUnique({ where: { id } });
  if (!bt) return NextResponse.json({ error: "Backtest tidak ditemukan" }, { status: 404 });

  const row: BacktestRow = {
    id: bt.id,
    symbol: bt.symbol as Pair,
    timeframe: bt.timeframe as Timeframe,
    strategy: bt.strategy,
    fromDate: bt.fromDate,
    toDate: bt.toDate,
    initialCapital: bt.initialCapital,
    finalCapital: bt.finalCapital,
    totalTrades: bt.totalTrades,
    wins: bt.wins,
    losses: bt.losses,
    winRate: bt.winRate,
    profitFactor: bt.profitFactor,
    maxDrawdown: bt.maxDrawdown,
    netProfit: bt.netProfit,
    createdAt: bt.createdAt.toISOString(),
  };

  // Parse the stored equity curve
  let equityCurve: { i: number; v: number }[] = [];
  try {
    const parsed = JSON.parse(bt.result);
    if (Array.isArray(parsed.equityCurve)) {
      equityCurve = parsed.equityCurve;
    }
  } catch {
    // result column may be malformed
  }

  return NextResponse.json({ backtest: row, equityCurve });
}
