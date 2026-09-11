import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeMarket } from "@/lib/ai";
import { log } from "@/lib/server-config";
import { FACTOR_LIST } from "@/lib/constants";
import type { AiAnalysisResult, FactorScore, Pair, SignalDirection } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { symbol } = (await req.json()) as { symbol: Pair };
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const result = await analyzeMarket(symbol);

  await db.aiAnalysis.create({
    data: {
      symbol,
      factors: JSON.stringify(result.factors),
      summary: result.summary,
      signal: result.signal,
      confidence: result.confidence,
      provider: "zai",
    },
  });
  await log("AI", "ANALYSIS", `AI analysis ${symbol} → ${result.signal} (${result.confidence}% confidence)`);

  return NextResponse.json({ analysis: result });
}

// GET: load latest analysis per pair from DB (so results survive refresh)
export async function GET() {
  const recent = await db.aiAnalysis.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Build a map of latest analysis per pair
  const byPair: Record<string, AiAnalysisResult> = {};
  for (const a of recent) {
    if (byPair[a.symbol]) continue; // already have the latest for this pair

    let factors: FactorScore[] = [];
    try {
      const parsed = JSON.parse(a.factors);
      if (Array.isArray(parsed) && parsed.length > 0) {
        factors = parsed.slice(0, 7);
      }
    } catch {
      factors = FACTOR_LIST.map((f) => ({
        factor: f,
        direction: "NEUTRAL" as SignalDirection,
        score: 0,
        detail: "Data tidak tersedia.",
      }));
    }

    byPair[a.symbol] = {
      symbol: a.symbol as Pair,
      signal: a.signal as SignalDirection,
      confidence: a.confidence,
      summary: a.summary,
      factors,
    };
  }

  return NextResponse.json({
    history: recent,
    latestByPair: byPair,
  });
}
