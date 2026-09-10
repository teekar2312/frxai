import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/server-config";
import type { AlertRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await db.alert.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const rows: AlertRow[] = items.map((a) => ({
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
  }));
  return NextResponse.json({ alerts: rows });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<AlertRow>;
  const alert = await db.alert.create({
    data: {
      type: body.type ?? "PRICE",
      symbol: body.symbol ?? null,
      condition: (body.condition as any) ?? null,
      price: body.price ?? null,
      message: body.message ?? null,
      email: body.email ?? null,
      active: body.active ?? true,
    },
  });
  await log("INFO", "ALERT", `Alert created: ${alert.type} ${alert.symbol ?? ""} ${alert.condition ?? ""} ${alert.price ?? ""}`);
  return NextResponse.json({ ok: true, id: alert.id });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json()) as { id: string };
  await db.alert.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// H2: PATCH — toggle alert active state (persisted)
export async function PATCH(req: Request) {
  const { id, active } = (await req.json()) as { id: string; active: boolean };
  const updated = await db.alert.update({
    where: { id },
    data: { active },
  });
  await log("INFO", "ALERT", `Alert ${updated.symbol ?? ""} ${active ? "diaktifkan" : "dinonaktifkan"}`);
  return NextResponse.json({ ok: true, alert: { id: updated.id, active: updated.active } });
}
