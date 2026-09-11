import { NextResponse } from "next/server";
import { runTrailingStopPass, runStopCheck } from "@/lib/auto-trade";

export const dynamic = "force-dynamic";

// Trailing stop pass + SL/TP hit detection.
// Called by the browser every 5 seconds when there are open trades.
// 1. runStopCheck: auto-close trades where SL/TP has been breached
// 2. runTrailingStopPass: move SL toward current price for trailing trades
export async function POST() {
  const stopCheck = await runStopCheck();
  const trailing = await runTrailingStopPass();
  return NextResponse.json({ ok: true, stopCheck, trailing, ts: Date.now() });
}
