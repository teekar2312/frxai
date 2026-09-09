import { NextResponse } from "next/server";
import {
  runAutoTradeCycle,
  runTrailingStopPass,
  autoSelectIndicators,
  autoAdjustRisk,
} from "@/lib/auto-trade";
import { log } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One auto-trade cycle. Called by the browser scheduler (every ~90s) when
// autoMode is ON, and/or by the MT5 bridge. Processes ONE pair per call
// (round-robin) to keep latency bounded (~10-20s per LLM call).
// Also runs: trailing-stop pass, indicator auto-select, risk auto-adjust,
// and signal expiry cleanup.
export async function POST() {
  try {
    // Run the AI analysis + trade execution cycle (one pair)
    const result = await runAutoTradeCycle();
    // Trailing stop pass (cheap, no LLM)
    const trailing = await runTrailingStopPass();
    // Indicator auto-select (only acts if indicatorAuto is ON)
    const indicators = await autoSelectIndicators();
    // Risk auto-adjust (only acts if riskAuto is ON)
    const risk = await autoAdjustRisk();
    return NextResponse.json({
      ok: true,
      result,
      trailing,
      indicators,
      risk,
      ts: Date.now(),
    });
  } catch (e: any) {
    await log("ERROR", "AUTO-TRADE", `Auto-trade tick error: ${e?.message ?? e}`);
    return NextResponse.json({ ok: false, error: e?.message ?? "tick error" }, { status: 500 });
  }
}
