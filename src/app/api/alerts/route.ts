import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { log } from "@/lib/server-config";
import { PAIRS } from "@/lib/constants";
import type { AlertRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_ALERTS = 50;

// H3: Zod validation schemas
const validTypes = ["PRICE", "EMAIL", "NEWS"] as const;
const validConditions = ["ABOVE", "BELOW"] as const;
const validSymbols = PAIRS.map((p) => p.symbol);

const priceAlertSchema = z.object({
  type: z.literal("PRICE"),
  symbol: z.enum(validSymbols as [string, ...string[]]),
  condition: z.enum(validConditions),
  price: z.number().positive().finite(),
  email: z.string().email().optional().or(z.literal("")),
  message: z.string().optional(),
  active: z.boolean().optional(),
});

const emailAlertSchema = z.object({
  type: z.literal("EMAIL"),
  email: z.string().email(),
  message: z.string().optional(),
  symbol: z.string().optional(),
  active: z.boolean().optional(),
});

const newsAlertSchema = z.object({
  type: z.literal("NEWS"),
  symbol: z.enum(validSymbols as [string, ...string[]]),
  message: z.string().min(1, "Keyword diperlukan untuk NEWS alert"),
  email: z.string().email().optional().or(z.literal("")),
  active: z.boolean().optional(),
});

const alertSchema = z.discriminatedUnion("type", [priceAlertSchema, emailAlertSchema, newsAlertSchema]);

function mapAlert(a: any): AlertRow {
  return {
    id: a.id,
    type: a.type as AlertRow["type"],
    symbol: a.symbol,
    condition: a.condition as AlertRow["condition"],
    price: a.price,
    message: a.message,
    email: a.email,
    active: a.active,
    triggered: a.triggered,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function GET() {
  const items = await db.alert.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ alerts: items.map(mapAlert) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // H3: Validate with zod
  const parse = alertSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json(
      { error: "Validasi gagal", details: parse.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const data = parse.data;

  // L1: Max alerts cap
  const count = await db.alert.count();
  if (count >= MAX_ALERTS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_ALERTS} alert. Hapus alert lama untuk menambah baru.` },
      { status: 400 },
    );
  }

  const alert = await db.alert.create({
    data: {
      type: data.type,
      symbol: data.symbol ?? null,
      condition: "condition" in data ? data.condition : null,
      price: "price" in data ? data.price : null,
      message: data.message ?? null,
      email: data.email || null,
      active: data.active ?? true,
    },
  });

  await log("INFO", "ALERT", `Alert created: ${alert.type} ${alert.symbol ?? ""} ${alert.condition ?? ""} ${alert.price ?? ""} ${alert.message ?? ""}`);
  return NextResponse.json({ ok: true, id: alert.id, alert: mapAlert(alert) });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // M2: try/catch — return 404 on missing id instead of uncaught P2025
  try {
    await db.alert.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Alert tidak ditemukan" }, { status: 404 });
  }
}

// M1: Extended PATCH — toggle active OR edit fields OR reset triggered
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id: string;
    active?: boolean;
    triggered?: boolean;
    price?: number;
    condition?: string;
    email?: string;
    message?: string;
  };

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const data: any = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.triggered === "boolean") {
    data.triggered = body.triggered;
    data.lastTriggeredAt = body.triggered ? new Date() : null;
  }
  if (typeof body.price === "number" && body.price > 0) data.price = body.price;
  if (body.condition) data.condition = body.condition;
  if (typeof body.email === "string") data.email = body.email || null;
  if (typeof body.message === "string") data.message = body.message || null;

  try {
    const updated = await db.alert.update({ where: { id: body.id }, data });
    await log("INFO", "ALERT", `Alert ${updated.symbol ?? ""} updated`);
    return NextResponse.json({ ok: true, alert: mapAlert(updated) });
  } catch {
    return NextResponse.json({ error: "Alert tidak ditemukan" }, { status: 404 });
  }
}
