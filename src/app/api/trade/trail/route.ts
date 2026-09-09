import { NextResponse } from "next/server";
import { runTrailingStopPass } from "@/lib/auto-trade";

export const dynamic = "force-dynamic";

// Trailing stop pass. Called by the browser every few seconds when there are
// open trades with trailingStop=true (or trailingAuto is ON). Moves SL toward
// current price. In production the MT5 bridge also sends SL-modify requests
// to MetaTrader5 via TRADE_ACTION_SLTP.
export async function POST() {
  const result = await runTrailingStopPass();
  return NextResponse.json({ ok: true, ...result, ts: Date.now() });
}
