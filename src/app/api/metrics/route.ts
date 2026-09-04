/**
 * GET /api/metrics — Observability Endpoint
 * ===========================================
 * Two formats:
 *   ?format=json       (default) — full snapshot (counters, gauges, histograms)
 *   ?format=prometheus — Prometheus text exposition format
 *
 * Optional actions:
 *   ?snapshot=true — force persist current snapshot to MetricsSnapshot table
 *
 * Exempt from rate limiting (monitoring must always work).
 */

import { NextRequest, NextResponse } from 'next/server'
import { captureSnapshot, renderPrometheus, persistMetricsSnapshot } from '@/lib/metrics'
import { checkRateLimit, recordRateLimitMetrics, getRateLimitStats } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const format = (params.get('format') ?? 'json').toLowerCase()
  const wantsSnapshot = params.get('snapshot') === 'true'

  // Health-of-monitoring: count this access (self-observation, no tier cost)
  const decision = checkRateLimit(request, 'EXEMPT')
  recordRateLimitMetrics(decision)

  if (wantsSnapshot) {
    const rows = await persistMetricsSnapshot()
    return NextResponse.json({ success: true, data: { snapshotRows: rows } })
  }

  if (format === 'prometheus' || format === 'prom') {
    const body = renderPrometheus()
    return new NextResponse(body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  const snapshot = captureSnapshot()
  const rateStats = getRateLimitStats()

  return NextResponse.json(
    {
      success: true,
      data: {
        ...snapshot,
        rateLimit: rateStats,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
