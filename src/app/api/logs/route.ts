import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/server-config";
import type { LogRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_LEVELS = ["INFO", "WARN", "ERROR", "TRADE", "AI"];
const MAX_ROWS = 10000;
const RETENTION_DAYS = 30;

// C1: Auto-cleanup old logs on every GET (lightweight, runs ~once per request)
async function cleanupOldLogs() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
    await db.log.deleteMany({ where: { createdAt: { lt: cutoff } } });
    // Also cap total rows
    const count = await db.log.count();
    if (count > MAX_ROWS) {
      const excess = count - MAX_ROWS;
      // Delete oldest excess rows
      const oldest = await db.log.findMany({
        orderBy: { createdAt: "asc" },
        take: excess,
        select: { id: true },
      });
      if (oldest.length > 0) {
        await db.log.deleteMany({ where: { id: { in: oldest.map((l) => l.id) } } });
      }
    }
  } catch {
    // ignore cleanup errors — don't block the GET
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const level = url.searchParams.get("level");
  const source = url.searchParams.get("source");
  const search = url.searchParams.get("q");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200)));
  const cursor = url.searchParams.get("cursor"); // L7: pagination cursor (createdAt)
  const format = url.searchParams.get("format"); // H5: export

  // L7: validate level
  const validLevel = level && level !== "ALL" && VALID_LEVELS.includes(level) ? level : undefined;

  // Run cleanup (C1) — non-blocking
  cleanupOldLogs().catch(() => {});

  const where: any = {};
  if (validLevel) where.level = validLevel;
  if (source) where.source = { contains: source, mode: "insensitive" };
  if (search) {
    where.OR = [
      { message: { contains: search, mode: "insensitive" } },
      { source: { contains: search, mode: "insensitive" } },
      { meta: { contains: search, mode: "insensitive" } },
    ];
  }
  if (cursor) {
    where.createdAt = { lt: new Date(cursor) };
  }

  const items = await db.log.findMany({
    where,
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

  // H5: Export as CSV
  if (format === "csv") {
    const header = "timestamp,level,source,message,meta\n";
    const csv = header + rows.map((r) =>
      `"${r.createdAt}","${r.level}","${r.source}","${r.message.replace(/"/g, '""')}","${(r.meta ?? "").replace(/"/g, '""')}"`,
    ).join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="logs-${Date.now()}.csv"`,
      },
    });
  }

  // H5: Export as JSON
  if (format === "json") {
    return new NextResponse(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="logs-${Date.now()}.json"`,
      },
    });
  }

  // L2: include true DB total
  const total = await db.log.count();

  return NextResponse.json({
    logs: rows,
    total,
    hasMore: rows.length === limit,
    nextCursor: rows.length > 0 ? rows[rows.length - 1].createdAt : null,
  });
}

// H4: Clear logs (with optional level/before filter)
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const level = url.searchParams.get("level");
  const before = url.searchParams.get("before");

  const where: any = {};
  if (level && VALID_LEVELS.includes(level)) where.level = level;
  if (before) where.createdAt = { lt: new Date(before) };

  const result = await db.log.deleteMany({ where });
  await log("INFO", "SYSTEM", `Logs cleared: ${result.count} entries deleted${level ? ` (level=${level})` : ""}`);
  return NextResponse.json({ ok: true, deleted: result.count });
}
