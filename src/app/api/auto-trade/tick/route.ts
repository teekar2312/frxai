import { NextResponse } from "next/server";
import {
  runAutoTradeCycle,
  runTrailingStopPass,
  autoSelectIndicators,
  autoAdjustRisk,
} from "@/lib/auto-trade";
import { runAlertChecks } from "@/lib/alert-checker";
import { log } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One auto-trade cycle. Called by the browser scheduler (every ~90s) when
// autoMode is ON, and/or by the MT5 bridge. Processes ONE pair per call
// (round-robin) to keep latency bounded (~10-20s per LLM call).
// Also runs: trailing-stop pass, indicator auto-select, risk auto-adjust,
// signal expiry cleanup, and alert checks (C1/C3 fix).
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
    // C1+C3: Check price + news alerts against live data
    const alerts = await runAlertChecks();
    return NextResponse.json({
      ok: true,
      result,
      trailing,
      indicators,
      risk,
      alerts,
      ts: Date.now(),
    });
  } catch (e: any) {
    await log("ERROR", "AUTO-TRADE", `Auto-trade tick error: ${e?.message ?? e}`);
    return NextResponse.json({ ok: false, error: e?.message ?? "tick error" }, { status: 500 });
  }
}
