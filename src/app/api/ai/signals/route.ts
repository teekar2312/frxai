import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// List signals with optional status filter. Used by the UI to show pending /
// recent signals.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // PENDING | EXECUTED | SKIPPED | EXPIRED
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));
  const items = await db.signal.findMany({
    where: status && status !== "ALL" ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({
    signals: items.map((s) => ({
      id: s.id,
      symbol: s.symbol,
      side: s.side,
      entry: s.entry,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit,
      confidence: s.confidence,
      reason: s.reason,
      source: s.source,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    })),
  });
}
