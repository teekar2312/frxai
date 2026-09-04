/**
 * GET /api/health — Liveness & Readiness Probes
 * ===============================================
 * Query params:
 *   ?type=liveness   (default) — is the process alive at all
 *   ?type=readiness  — are dependencies ready to serve traffic
 *
 * Response (200 = healthy, 503 = unhealthy/degraded):
 *   { success, data: { status, checks: {database, mt5Bridge, disk, memory}, latencyMs, uptimeSeconds, version, timestamp } }
 *
 * Exempt from rate limiting (see middleware) so monitoring always works.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/lib/env-validation'
import { incrementCounter, setGauge, observeHistogram } from '@/lib/metrics'

export const dynamic = 'force-dynamic'

const STARTED_AT = Date.now()
const VERSION = '2.0.0'

interface ComponentCheck {
  ok: boolean
  latencyMs?: number
  detail?: string
}

async function checkDatabase(): Promise<ComponentCheck> {
  const t0 = Date.now()
  try {
    await db.systemConfig.count()
    return { ok: true, latencyMs: Date.now() - t0 }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) }
  }
}

async function checkMt5Bridge(): Promise<ComponentCheck> {
  const t0 = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3_000)
    const res = await fetch(`${env().MT5_BRIDGE_URL}/heartbeat`, { signal: controller.signal })
    clearTimeout(timer)
    // ANY HTTP response (incl. 401 "not connected") proves the bridge service
    // is alive — an unauthenticated session is a state issue, not unavailability.
    const ok = res.status < 500
    return { ok, latencyMs: Date.now() - t0, detail: res.ok ? 'bridge reachable' : `bridge reachable (HTTP ${res.status}: session not connected)` }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, detail: err instanceof Error ? err.message : 'unreachable' }
  }
}

function checkMemory(): ComponentCheck {
  const mem = process.memoryUsage()
  const rssMb = mem.rss / 1048576
  // 1.5 GB soft threshold — unhealthy beyond
  return { ok: rssMb < 1536, detail: `rss=${Math.round(rssMb)}MB heap=${Math.round(mem.heapUsed / 1048576)}MB` }
}

function checkDisk(): ComponentCheck {
  // Heuristic: process uptime sanity + no fs dependency in edge-safe code
  return { ok: true, detail: 'assumed ok (no fs quota in container)' }
}

async function checkEnv(): Promise<ComponentCheck> {
  const e = env()
  const missing = [
    !e.FINNHUB_API_KEY && 'FINNHUB_API_KEY',
    !e.MARKETAUX_API_KEY && 'MARKETAUX_API_KEY',
    !e.TELEGRAM_BOT_TOKEN && 'TELEGRAM_BOT_TOKEN',
    !e.DISCORD_WEBHOOK_URL && 'DISCORD_WEBHOOK_URL',
  ].filter(Boolean)
  return { ok: true, detail: missing.length === 0 ? 'all optional credentials present' : `optional credentials missing: ${missing.join(', ')}` }
}

export async function GET(request: NextRequest) {
  const t0 = Date.now()
  const type = (request.nextUrl.searchParams.get('type') ?? 'liveness').toLowerCase()
  const isReadiness = type === 'readiness'

  incrementCounter('health_checks_total', { type })

  // ---- Liveness: process + minimal DB touch ----
  const database = await checkDatabase()

  let status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY'
  let mt5Bridge: ComponentCheck | null = null
  let memory: ComponentCheck | null = null
  let disk: ComponentCheck | null = null
  let envCheck: ComponentCheck | null = null

  if (isReadiness) {
    // ---- Readiness: full dependency sweep ----
    ;[mt5Bridge, memory, disk, envCheck] = await Promise.all([checkMt5Bridge(), Promise.resolve(checkMemory()), Promise.resolve(checkDisk()), checkEnv()])

    if (!database.ok) status = 'UNHEALTHY'
    else if (!mt5Bridge.ok || !memory.ok) status = 'DEGRADED'
  } else {
    // ---- Liveness: DB failure = unhealthy; memory check degrades ----
    memory = checkMemory()
    if (!database.ok) status = 'UNHEALTHY'
    else if (!memory.ok) status = 'DEGRADED'
  }

  const latencyMs = Date.now() - t0

  // Metrics
  observeHistogram('health_check_duration_ms', latencyMs, { type })
  setGauge('health_status', status === 'HEALTHY' ? 1 : status === 'DEGRADED' ? 0.5 : 0, { type })

  // Persist a readiness audit row (async, best-effort, with retention)
  if (isReadiness) {
    void db.healthCheckLog
      .create({
        data: {
          checkType: 'READINESS',
          status,
          database: database.ok,
          mt5Bridge: mt5Bridge?.ok ?? false,
          diskOk: disk?.ok ?? true,
          latencyMs,
          memoryUsageMb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
          details: JSON.stringify({ database, mt5Bridge, memory, disk, env: envCheck }),
        },
      })
      .then(() => db.healthCheckLog.deleteMany({
        // Retention: keep 24h
        where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
      }))
      .catch(() => { /* best effort */ })
  }

  const httpStatus = status === 'UNHEALTHY' ? 503 : 200

  return NextResponse.json(
    {
      success: status !== 'UNHEALTHY',
      data: {
        status,
        type,
        version: VERSION,
        uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
        latencyMs,
        timestamp: new Date().toISOString(),
        checks: {
          database,
          mt5Bridge,
          memory,
          disk,
          environment: envCheck,
        },
      },
    },
    { status: httpStatus, headers: { 'Cache-Control': 'no-store' } }
  )
}
