import { NextResponse } from "next/server";
import { runAlertChecks } from "@/lib/alert-checker";

export const dynamic = "force-dynamic";

// C1+C3: Standalone alert check endpoint — can be called independently
// of autoMode. The trading-shell polls this every 10s when alerts exist.
export async function POST() {
  const result = await runAlertChecks();
  return NextResponse.json({ ok: true, ...result, ts: Date.now() });
}
