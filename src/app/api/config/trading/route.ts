import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/server-config";
import type { TradingConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT: TradingConfig = {
  pairs: ["EURUSD", "GBPUSD"],
  timeframes: ["M5", "M15"],
  sessions: ["London", "LondonNewYork"],
  avoidWeekends: true,
  autoMode: false,
  trailingAuto: false,
  indicatorAuto: false,
  riskAuto: false,
};

export async function GET() {
  const config = await getConfig<TradingConfig>("trading", DEFAULT);
  return NextResponse.json({ config });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<TradingConfig>;
  const current = await getConfig<TradingConfig>("trading", DEFAULT);
  const next = { ...current, ...body };
  await setConfig("trading", next);
  return NextResponse.json({ config: next });
}
