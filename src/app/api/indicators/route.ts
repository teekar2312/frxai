import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { INDICATOR_POOL } from "@/lib/constants";
import type { IndicatorState } from "@/lib/types";

export const dynamic = "force-dynamic";

async function ensureIndicators() {
  const existing = await db.indicatorConfig.findMany();
  const existingNames = new Set(existing.map((i) => i.name));
  const toCreate = INDICATOR_POOL.filter((p) => !existingNames.has(p.name));
  if (toCreate.length > 0) {
    await db.indicatorConfig.createMany({
      data: toCreate.map((p) => ({
        name: p.name,
        enabled: ["EMA", "RSI", "ATR", "Supertrend"].includes(p.name),
        autoMode: false,
        params: JSON.stringify(p.defaultParams),
        category: p.category,
      })),
    });
  }
  return db.indicatorConfig.findMany({ orderBy: { name: "asc" } });
}

export async function GET() {
  const items = await ensureIndicators();
  const rows: IndicatorState[] = items.map((i) => ({
    name: i.name,
    enabled: i.enabled,
    autoMode: i.autoMode,
    params: safeParse(i.params),
    category: i.category,
  }));
  return NextResponse.json({ indicators: rows });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as IndicatorState;
  await db.indicatorConfig.upsert({
    where: { name: body.name },
    create: {
      name: body.name,
      enabled: body.enabled,
      autoMode: body.autoMode,
      params: JSON.stringify(body.params),
      category: body.category,
    },
    update: {
      enabled: body.enabled,
      autoMode: body.autoMode,
      params: JSON.stringify(body.params),
      category: body.category,
    },
  });
  return NextResponse.json({ ok: true });
}

function safeParse(s: string): Record<string, number> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
