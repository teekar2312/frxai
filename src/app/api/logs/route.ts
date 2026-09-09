import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { LogRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const level = url.searchParams.get("level");
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 200));
  const items = await db.log.findMany({
    where: level && level !== "ALL" ? { level } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const rows: LogRow[] = items.map((l) => ({
    id: l.id,
    level: l.level as LogRow["level"],
    source: l.source,
    message: l.message,
    meta: l.meta,
    createdAt: l.createdAt.toISOString(),
  }));
  return NextResponse.json({ logs: rows });
}
