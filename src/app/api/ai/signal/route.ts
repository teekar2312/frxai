import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeMarket } from "@/lib/ai";
import { log } from "@/lib/server-config";
import type { Pair } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Generate a concrete trading signal from the AI analysis
export async function POST(req: Request) {
  const { symbol } = (await req.json()) as { symbol: Pair };
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const analysis = await analyzeMarket(symbol);
  if (analysis.signal === "NEUTRAL" || analysis.confidence < 55) {
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
    await log("AI", "SIGNAL", `AI signal ${symbol} skipped: ${analysis.signal} @ ${analysis.confidence}% (below threshold)`);
    return NextResponse.json({
      signal: null,
      reason: `Confidence ${analysis.confidence}% di bawah threshold 55% atau sinyal NEUTRAL. Tidak ada eksekusi.`,
      analysis,
    });
  }

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

  return NextResponse.json({
    signal: {
      id: signal.id,
      symbol,
      side: analysis.signal,
      entry: analysis.suggestedEntry,
      stopLoss: analysis.suggestedStopLoss,
      takeProfit: analysis.suggestedTakeProfit,
      confidence: analysis.confidence,
      reason: analysis.summary,
    },
    analysis,
  });
}
