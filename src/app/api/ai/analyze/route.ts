import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeMarket } from "@/lib/ai";
import { log } from "@/lib/server-config";
import type { Pair } from "@/lib/types";

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

export async function GET() {
  const recent = await db.aiAnalysis.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return NextResponse.json({ history: recent });
}
