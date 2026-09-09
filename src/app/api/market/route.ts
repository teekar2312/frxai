import { NextResponse } from "next/server";
import { getAllQuotes } from "@/lib/market";
import { getAllRealQuotes, hasRealTicks, lastTickAt } from "@/lib/market-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  // Prefer real MT5 ticks (published by the bridge) when available.
  // Fall back to the simulator for sandbox / when bridge is offline.
  const realQuotes = getAllRealQuotes();
  if (realQuotes.length > 0) {
    return NextResponse.json({
      quotes: realQuotes,
      source: "mt5",
      ts: Date.now(),
      lastTickAt: lastTickAt(),
    });
  }
  return NextResponse.json({
    quotes: getAllQuotes(),
    source: "simulator",
    ts: Date.now(),
    hasRealTicks: hasRealTicks(),
  });
}
