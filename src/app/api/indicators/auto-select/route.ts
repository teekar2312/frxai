import { NextResponse } from "next/server";
import { autoSelectIndicators } from "@/lib/auto-trade";
import { db } from "@/lib/db";
import type { IndicatorState } from "@/lib/types";

export const dynamic = "force-dynamic";

// C1: Trigger AI auto-select immediately when toggled in Indicators Lab
// (decouples from the 90s auto-trade tick). Returns the updated indicator states.
export async function POST() {
  const result = await autoSelectIndicators();

  // Return fresh indicator states so the UI can update without refetch
  const rows = await db.indicatorConfig.findMany({ orderBy: { name: "asc" } });
  const states: IndicatorState[] = rows.map((i) => ({
    name: i.name,
    enabled: i.enabled,
    autoMode: i.autoMode,
    params: safeParse(i.params),
    category: i.category,
  }));

  return NextResponse.json({ ok: true, ...result, indicators: states });
}

function safeParse(s: string): Record<string, number> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
