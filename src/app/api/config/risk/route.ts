import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/server-config";
import { BROKER_SPEC } from "@/lib/constants";
import type { RiskConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT: RiskConfig = {
  riskPerTrade: 1,
  stopLossPipsMin: 5,
  stopLossPipsMax: 15,
  rrRatio: 1.5,
  maxOpenPositions: 3,
  dailyLossLimit: 3,
  avoidHighImpactNews: true,
  dailyTarget: 2,
  autoMode: false,
  aiConfidenceThreshold: 55,
};

// H2: Server-side validation clamps
function clampRiskConfig(body: Partial<RiskConfig>, current: RiskConfig): RiskConfig {
  const next = { ...current, ...body };
  // Clamp numeric fields to safe bounds
  if (typeof body.riskPerTrade === "number") {
    next.riskPerTrade = Math.min(Math.max(body.riskPerTrade, 0.1), 5);
    // H3: When user manually changes riskPerTrade, save baseline
    // (auto-adjust will never exceed this)
    if (body.riskPerTrade !== current.riskPerTrade) {
      next.riskPerTradeBaseline = next.riskPerTrade;
    }
  }
  if (typeof body.stopLossPipsMin === "number") {
    next.stopLossPipsMin = Math.min(Math.max(body.stopLossPipsMin, 1), 50);
  }
  if (typeof body.stopLossPipsMax === "number") {
    next.stopLossPipsMax = Math.min(Math.max(body.stopLossPipsMax, 1), 50);
  }
  // Ensure min <= max
  if (next.stopLossPipsMin > next.stopLossPipsMax) {
    next.stopLossPipsMax = next.stopLossPipsMin;
  }
  if (typeof body.rrRatio === "number") {
    next.rrRatio = Math.min(Math.max(body.rrRatio, 0.5), 5);
  }
  if (typeof body.maxOpenPositions === "number") {
    // L4: enforce broker hard limit
    next.maxOpenPositions = Math.min(
      Math.max(body.maxOpenPositions, 1),
      BROKER_SPEC.maxOpenPositions,
    );
  }
  if (typeof body.dailyLossLimit === "number") {
    next.dailyLossLimit = Math.min(Math.max(body.dailyLossLimit, 0.5), 10);
  }
  if (typeof body.dailyTarget === "number") {
    next.dailyTarget = Math.min(Math.max(body.dailyTarget, 0.5), 10);
  }
  if (typeof body.avoidHighImpactNews === "boolean") {
    next.avoidHighImpactNews = body.avoidHighImpactNews;
  }
  if (typeof body.autoMode === "boolean") {
    next.autoMode = body.autoMode;
  }
  if (typeof body.aiConfidenceThreshold === "number") {
    next.aiConfidenceThreshold = Math.min(Math.max(body.aiConfidenceThreshold, 0), 100);
  }
  return next;
}

export async function GET() {
  const config = await getConfig<RiskConfig>("risk", DEFAULT);
  return NextResponse.json({ config });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<RiskConfig>;
  const current = await getConfig<RiskConfig>("risk", DEFAULT);
  const next = clampRiskConfig(body, current);
  await setConfig("risk", next);
  return NextResponse.json({ config: next });
}
