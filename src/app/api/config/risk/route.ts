import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/server-config";
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
};

export async function GET() {
  const config = await getConfig<RiskConfig>("risk", DEFAULT);
  return NextResponse.json({ config });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<RiskConfig>;
  const current = await getConfig<RiskConfig>("risk", DEFAULT);
  const next = { ...current, ...body };
  await setConfig("risk", next);
  return NextResponse.json({ config: next });
}
