import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/server-config";
import type { TradingConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

// Auto-trade status: is autoMode on? last tick? recent AI trades? signal counts?
export async function GET() {
  const cfg = await getConfig<TradingConfig>("trading", {
    pairs: [],
    timeframes: [],
    sessions: [],
    avoidWeekends: true,
    autoMode: false,
    trailingAuto: false,
    indicatorAuto: false,
    riskAuto: false,
  });

  const now = new Date();
  const isWeekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;
  const h = now.getUTCHours();
  const inRange = (a: number, b: number) => (a < b ? h >= a && h < b : h >= a || h < b);
  const sessionMap: Record<string, [number, number]> = {
    Sydney: [21, 6], Tokyo: [0, 9], London: [7, 16],
    NewYork: [12, 21], LondonNewYork: [12, 16], NewYorkTokyo: [21, 0],
  };
  const inConfiguredSession = cfg.sessions.some((s) => {
    const r = sessionMap[s];
    return r ? inRange(r[0], r[1]) : false;
  });

  // Recent AI trades (last 24h)
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const recentAiTrades = await db.trade.count({
    where: { source: "AI", openedAt: { gte: since } },
  });

  // Signal counts by status
  const signalsPending = await db.signal.count({ where: { status: "PENDING" } });
  const signalsExecuted = await db.signal.count({ where: { status: "EXECUTED" } });
  const signalsSkipped = await db.signal.count({ where: { status: "SKIPPED" } });
  const signalsExpired = await db.signal.count({ where: { status: "EXPIRED" } });

  // Last AiAnalysis timestamp
  const lastAnalysis = await db.aiAnalysis.findFirst({ orderBy: { createdAt: "desc" } });

  return NextResponse.json({
    autoMode: cfg.autoMode,
    trailingAuto: cfg.trailingAuto,
    indicatorAuto: cfg.indicatorAuto,
    riskAuto: cfg.riskAuto,
    isWeekend,
    inConfiguredSession,
    canTrade: cfg.autoMode && !(cfg.avoidWeekends && isWeekend) && (cfg.sessions.length === 0 || inConfiguredSession),
    recentAiTrades,
    signals: { pending: signalsPending, executed: signalsExecuted, skipped: signalsSkipped, expired: signalsExpired },
    lastAnalysisAt: lastAnalysis?.createdAt.toISOString() ?? null,
    pairs: cfg.pairs,
    sessions: cfg.sessions,
  });
}
