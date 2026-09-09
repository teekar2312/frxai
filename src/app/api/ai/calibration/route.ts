import { NextResponse } from "next/server";
import { getCalibration } from "@/lib/ai-calibration";
import { PAIRS } from "@/lib/constants";
import type { Pair } from "@/lib/types";

export const dynamic = "force-dynamic";

// Returns AI signal calibration stats per pair (win rate, net pips, etc.)
// Used by the UI to display "45% win rate over last 50 signals".
export async function GET() {
  const stats = await Promise.all(
    PAIRS.map((p) => getCalibration(p.symbol as Pair, 50)),
  );
  return NextResponse.json({
    calibration: PAIRS.map((p, i) => ({
      symbol: p.symbol,
      ...stats[i],
    })),
  });
}
