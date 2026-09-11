import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/server-config";

export const dynamic = "force-dynamic";

// L6: Reset triggered alerts (re-arm)
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };

  if (id) {
    // Reset specific alert
    const updated = await db.alert.update({
      where: { id },
      data: { triggered: false, lastTriggeredAt: null },
    });
    await log("INFO", "ALERT", `Alert ${updated.symbol ?? ""} re-armed (triggered reset)`);
    return NextResponse.json({ ok: true, id: updated.id });
  }

  // Reset all triggered alerts
  const result = await db.alert.updateMany({
    where: { triggered: true },
    data: { triggered: false, lastTriggeredAt: null },
  });
  await log("INFO", "ALERT", `Reset ${result.count} triggered alerts`);
  return NextResponse.json({ ok: true, count: result.count });
}
