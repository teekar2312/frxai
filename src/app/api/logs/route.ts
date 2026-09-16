import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { LogEntryView } from '@/lib/types'

export const dynamic = 'force-dynamic'

const LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG'] as const

function toView(row: {
  id: string
  level: string
  category: string
  message: string
  details: string | null
  createdAt: Date
}): LogEntryView {
  return {
    id: row.id,
    level: (LEVELS as readonly string[]).includes(row.level) ? (row.level as LogEntryView['level']) : 'INFO',
    category: row.category,
    message: row.message,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  }
}

/** GET /api/logs?level=&category=&q=&limit= → LogEntryView[] (newest first) */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const level = sp.get('level')
    const category = sp.get('category')
    const q = sp.get('q')
    const limitRaw = Number.parseInt(sp.get('limit') ?? '100', 10)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100

    const where: {
      level?: string
      category?: string
      message?: { contains: string }
    } = {}
    if (level && (LEVELS as readonly string[]).includes(level)) where.level = level
    if (category && category.trim()) where.category = category.trim()
    if (q && q.trim()) where.message = { contains: q.trim() }

    const rows = await db.logEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit })
    return NextResponse.json(rows.map(toView))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'engine error' }, { status: 500 })
  }
}

/** DELETE /api/logs — clear all but the latest 100 entries */
export async function DELETE() {
  try {
    const stale = await db.logEntry.findMany({ orderBy: { createdAt: 'desc' }, skip: 100, select: { id: true } })
    if (stale.length === 0) return NextResponse.json({ success: true, deleted: 0 })
    await db.logEntry.deleteMany({ where: { id: { in: stale.map((x) => x.id) } } })
    return NextResponse.json({ success: true, deleted: stale.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal menghapus logs' }, { status: 500 })
  }
}
