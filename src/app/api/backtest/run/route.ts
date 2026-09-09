import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateCandles } from "@/lib/market";
import { PAIRS } from "@/lib/constants";
import { log } from "@/lib/server-config";
import type { BacktestRow, Pair, Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RunBody {
  symbol: Pair;
  timeframe: Timeframe;
  strategy: string;
  fromDate: string;
  toDate: string;
  initialCapital: number;
  riskPerTrade: number;
  rrRatio: number;
}

export async function POST(req: Request) {
  const body = (await req.json()) as RunBody;
  const meta = PAIRS.find((p) => p.symbol === body.symbol)!;
  const tf = body.timeframe;
  const tfMinutes = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 }[tf] ?? 5;

  // Generate ~600 candles for the period
  const candles = generateCandles(body.symbol, 600, tfMinutes);
  const closes = candles.map((c) => c.close);

  // Simple strategy emulators
  let equity = body.initialCapital;
  let peak = equity;
  let maxDD = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const equityCurve: { i: number; v: number }[] = [{ i: 0, v: equity }];

  const fast = 9;
  const slow = 21;
  const positions: { side: "BUY" | "SELL"; entry: number; sl: number; tp: number; size: number }[] = [];

  for (let i = slow; i < closes.length; i++) {
    const emaFast = ema(closes.slice(0, i + 1), fast);
    const emaSlow = ema(closes.slice(0, i + 1), slow);
    const prevEmaFast = ema(closes.slice(0, i), fast);
    const prevEmaSlow = ema(closes.slice(0, i), slow);

    // Check exits on open positions
    for (let j = positions.length - 1; j >= 0; j--) {
      const p = positions[j];
      const price = closes[i];
      let exit: number | null = null;
      if (p.side === "BUY") {
        if (price <= p.sl) exit = p.sl;
        else if (price >= p.tp) exit = p.tp;
      } else {
        if (price >= p.sl) exit = p.sl;
        else if (price <= p.tp) exit = p.tp;
      }
      if (exit !== null) {
        const pips =
          p.side === "BUY"
            ? (exit - p.entry) / meta.pipSize
            : (p.entry - exit) / meta.pipSize;
        const pipValue = body.symbol === "XAUUSD" ? 1 : 10;
        const pnl = pips * pipValue * p.size;
        equity += pnl;
        if (pnl >= 0) {
          wins++;
          grossProfit += pnl;
        } else {
          losses++;
          grossLoss += Math.abs(pnl);
        }
        positions.splice(j, 1);
      }
    }

    // Entry signal based on strategy
    const crossedUp = prevEmaFast <= prevEmaSlow && emaFast > emaSlow;
    const crossedDown = prevEmaFast >= prevEmaSlow && emaFast < emaSlow;

    let side: "BUY" | "SELL" | null = null;
    if (body.strategy === "EMA Crossover") {
      if (crossedUp) side = "BUY";
      else if (crossedDown) side = "SELL";
    } else if (body.strategy === "Momentum Breakout") {
      const window = closes.slice(i - 20, i);
      const hi = Math.max(...window);
      const lo = Math.min(...window);
      if (closes[i] > hi * 1.0005) side = "BUY";
      else if (closes[i] < lo * 0.9995) side = "SELL";
    } else if (body.strategy === "Mean Reversion") {
      const window = closes.slice(i - 20, i);
      const avg = window.reduce((a, b) => a + b, 0) / window.length;
      if (closes[i] < avg * 0.998) side = "BUY";
      else if (closes[i] > avg * 1.002) side = "SELL";
    } else {
      // AI Hybrid — pseudo blend
      if (crossedUp) side = "BUY";
      else if (crossedDown) side = "SELL";
    }

    if (side && positions.length < 3) {
      const slPips = 8;
      const tpPips = slPips * body.rrRatio;
      const riskAmt = (equity * body.riskPerTrade) / 100;
      const size = Math.max(0.01, +(riskAmt / (slPips * (body.symbol === "XAUUSD" ? 1 : 10))).toFixed(2));
      positions.push({
        side,
        entry: closes[i],
        sl: side === "BUY" ? closes[i] - slPips * meta.pipSize : closes[i] + slPips * meta.pipSize,
        tp: side === "BUY" ? closes[i] + tpPips * meta.pipSize : closes[i] - tpPips * meta.pipSize,
        size,
      });
    }

    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
    equityCurve.push({ i, v: +equity.toFixed(2) });
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const netProfit = equity - body.initialCapital;

  const bt = await db.backtest.create({
    data: {
      symbol: body.symbol,
      timeframe: body.timeframe,
      strategy: body.strategy,
      fromDate: body.fromDate,
      toDate: body.toDate,
      initialCapital: body.initialCapital,
      finalCapital: +equity.toFixed(2),
      totalTrades,
      wins,
      losses,
      winRate: +winRate.toFixed(2),
      profitFactor: +profitFactor.toFixed(2),
      maxDrawdown: +maxDD.toFixed(2),
      netProfit: +netProfit.toFixed(2),
      result: JSON.stringify({ equityCurve }),
    },
  });
  await log("INFO", "BACKTEST", `Backtest ${body.symbol} ${body.timeframe} ${body.strategy}: ${totalTrades} trades, win ${winRate.toFixed(1)}%, PF ${profitFactor.toFixed(2)}, net ${netProfit.toFixed(2)}`);

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
  return NextResponse.json({ backtest: row, equityCurve });
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
