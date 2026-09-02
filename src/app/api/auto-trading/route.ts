import { NextRequest, NextResponse } from 'next/server'
import { getAutoTradingLoop } from '@/lib/auto-trading-loop'

/**
 * GET /api/auto-trading — Get auto-trading loop status
 * POST /api/auto-trading — Start/stop/configure the auto-trading loop
 */

export async function GET() {
  try {
    const loop = getAutoTradingLoop()
    const status = loop.getStatus()
    const recentScans = loop.getRecentScans(20)

    return NextResponse.json({
      success: true,
      data: {
        ...status,
        recentScans,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...configUpdates } = body
    const loop = getAutoTradingLoop()

    switch (action) {
      case 'start': {
        const result = await loop.start()
        if (!result.success) {
          return NextResponse.json({ success: false, error: result.error }, { status: 400 })
        }
        return NextResponse.json({ success: true, data: loop.getStatus() })
      }

      case 'stop': {
        await loop.stop()
        return NextResponse.json({ success: true, data: loop.getStatus() })
      }

      case 'configure': {
        // Allowed config fields
        const allowedKeys = new Set([
          'scanIntervalMs', 'mode', 'strategyId', 'timeframe',
          'maxOpenPositions', 'watchlist', 'enabledStrategies',
          'adaptiveLearning', 'positionSyncIntervalMs',
          'reduceOnConsecutiveLosses', 'closeAllOnRiskScore',
        ])

        const updates: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(configUpdates)) {
          if (allowedKeys.has(key)) {
            updates[key] = value
          }
        }

        const newConfig = await loop.updateConfig(updates as any)
        return NextResponse.json({ success: true, data: { ...loop.getStatus(), config: newConfig } })
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}. Use 'start', 'stop', or 'configure'` },
          { status: 400 },
        )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
