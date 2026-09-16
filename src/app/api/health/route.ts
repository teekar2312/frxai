import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — health check PUBLIK (tanpa autentikasi) untuk
 * monitoring uptime (uptime-kuma / uptimerobot / docker healthcheck).
 *
 * Sengaja ringan: satu query DB + info proses. Tidak membocorkan
 * data trading apa pun.
 */
export async function GET() {
  const startedAt = Date.now()
  let dbOk = false
  try {
    await db.$queryRaw`SELECT 1`
    dbOk = true
  } catch {
    dbOk = false
  }

  const mode = (process.env.ENGINE_MODE ?? 'demo').toLowerCase()
  const body = {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'fail',
    mode,
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? '0.2.1',
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
  }

  return NextResponse.json(body, { status: dbOk ? 200 : 503 })
}
