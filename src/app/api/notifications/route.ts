/**
 * /api/notifications — Notification log & status
 * =================================================
 * GET   — list recent notifications (filters: channel, status, eventType, limit)
 * Stats — counts by status/channel over last 24h
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rateLimitGuard } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const guard = rateLimitGuard('READ')

export async function GET(request: NextRequest) {
  const limited = guard(request)
  if (limited) return limited

  try {
    const params = request.nextUrl.searchParams
    const channel = params.get('channel') ?? undefined
    const status = params.get('status') ?? undefined
    const eventType = params.get('eventType') ?? undefined
    const limit = Math.min(200, Math.max(1, Number(params.get('limit') ?? 50)))

    const where: Record<string, unknown> = {}
    if (channel) where.channel = channel.toUpperCase()
    if (status) where.status = status.toUpperCase()
    if (eventType) where.eventType = eventType.toUpperCase()

    const [logs, total, sent, failed, pending] = await Promise.all([
      db.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true, channel: true, eventType: true, title: true, body: true, severity: true,
          status: true, attempts: true, lastError: true, sentAt: true, createdAt: true,
        },
      }),
      db.notificationLog.count({ where }),
      db.notificationLog.count({ where: { status: 'SENT' } }),
      db.notificationLog.count({ where: { status: 'FAILED' } }),
      db.notificationLog.count({ where: { status: 'PENDING' } }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        notifications: logs,
        stats: { total, sent, failed, pending },
      },
    })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : 'Failed to load notifications' } },
      { status: 500 }
    )
  }
}
