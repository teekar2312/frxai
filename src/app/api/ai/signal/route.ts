import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeMarket } from "@/lib/ai";
import { getConfig, log } from "@/lib/server-config";
import { executeSignalAsTrade } from "@/lib/auto-trade";
import type { Pair, RiskConfig, Side } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SignalBody {
  symbol: Pair;
  autoExecute?: boolean;
}

export async function POST(req: Request) {
  const { symbol, autoExecute = true } = (await req.json()) as SignalBody;
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  // Read configurable confidence threshold from risk config
  const risk = await getConfig<RiskConfig>("risk", {
    riskPerTrade: 1, stopLossPipsMin: 5, stopLossPipsMax: 15,
    rrRatio: 1.5, maxOpenPositions: 3, dailyLossLimit: 3,
    avoidHighImpactNews: true, dailyTarget: 2, autoMode: false,
    aiConfidenceThreshold: 55,
  });
  const threshold = risk.aiConfidenceThreshold ?? 55;

  const analysis = await analyzeMarket(symbol);

  // Weak / neutral signal -> skip
  if (analysis.signal === "NEUTRAL" || analysis.confidence < threshold) {
    await db.signal.create({
      data: {
        symbol,
        side: analysis.signal === "NEUTRAL" ? "BUY" : analysis.signal,
        entry: analysis.suggestedEntry ?? 0,
        stopLoss: analysis.suggestedStopLoss ?? 0,
        takeProfit: analysis.suggestedTakeProfit ?? 0,
        confidence: analysis.confidence,
        reason: analysis.summary,
        source: "AI",
        status: "SKIPPED",
      },
    });
    await log("AI", "SIGNAL", `AI signal ${symbol} skipped: ${analysis.signal} @ ${analysis.confidence}% (below threshold ${threshold}%)`);
    return NextResponse.json({
      signal: null,
      reason: `Confidence ${analysis.confidence}% di bawah threshold ${threshold}% atau sinyal NEUTRAL. Tidak ada eksekusi.`,
      analysis,
    });
  }

  // Strong signal -> create Signal row (PENDING initially)
  const signal = await db.signal.create({
    data: {
      symbol,
      side: analysis.signal,
      entry: analysis.suggestedEntry ?? 0,
      stopLoss: analysis.suggestedStopLoss ?? 0,
      takeProfit: analysis.suggestedTakeProfit ?? 0,
      confidence: analysis.confidence,
      reason: analysis.summary,
      source: "AI",
      status: "PENDING",
    },
  });
  await log("AI", "SIGNAL", `AI signal ${symbol} → ${analysis.signal} @ ${analysis.confidence}% | entry ${analysis.suggestedEntry} SL ${analysis.suggestedStopLoss} TP ${analysis.suggestedTakeProfit}`);

  const signalOut = {
    id: signal.id,
    symbol,
    side: analysis.signal,
    entry: analysis.suggestedEntry,
    stopLoss: analysis.suggestedStopLoss,
    takeProfit: analysis.suggestedTakeProfit,
    confidence: analysis.confidence,
    reason: analysis.summary,
  };

  if (autoExecute) {
    const { trade, reason } = await executeSignalAsTrade(
      symbol,
      analysis.signal as Side,
      analysis.confidence,
      analysis.suggestedEntry,
      analysis.suggestedStopLoss,
      analysis.suggestedTakeProfit,
      analysis.summary,
      signal.id,
    );
    return NextResponse.json({
      signal: signalOut,
      trade,
      reason: trade ? `Sinyal dieksekusi otomatis: ${analysis.signal} ${symbol} ${trade.lotSize} lot @ ${trade.openPrice}` : reason,
      analysis,
    });
  }

  return NextResponse.json({ signal: signalOut, trade: null, analysis });
}
