import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAutoTradingLoop } from '@/lib/auto-trading-loop'
import { apiErrorResponse } from '@/lib/api-errors'

/**
 * GET /api/auto-trading — Get auto-trading loop status
 * POST /api/auto-trading — Start/stop/configure the auto-trading loop
 */

/** Zod-validated subset of AutoTradingConfig that clients may update. */
const autoTradingConfigUpdateSchema = z
  .object({
    scanIntervalMs: z.number().int().min(1_000).max(3_600_000).optional(),
    mode: z.enum(['SINGLE_STRATEGY', 'MULTI_STRATEGY']).optional(),
    strategyId: z.string().min(1).optional(),
    timeframe: z.string().min(1).optional(),
    maxOpenPositions: z.number().int().min(1).max(50).optional(),
    watchlist: z.array(z.string().min(1)).min(1).optional(),
    enabledStrategies: z.array(z.string().min(1)).optional(),
    adaptiveLearning: z.boolean().optional(),
    positionSyncIntervalMs: z.number().int().min(1_000).max(3_600_000).optional(),
    reduceOnConsecutiveLosses: z.number().int().min(0).max(10).optional(),
    closeAllOnRiskScore: z.number().min(0).max(100).optional(),
  })
  .strict()

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
    return apiErrorResponse(err, { route: 'AUTO-TRADING' })
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
        const parsed = autoTradingConfigUpdateSchema.safeParse(configUpdates)
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ')
          return NextResponse.json(
            { success: false, error: `Invalid configuration update: ${issues}` },
            { status: 400 },
          )
        }

        const updates = parsed.data

        const newConfig = await loop.updateConfig(updates)
        return NextResponse.json({ success: true, data: { ...loop.getStatus(), config: newConfig } })
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}. Use 'start', 'stop', or 'configure'` },
          { status: 400 },
        )
    }
  } catch (err) {
    return apiErrorResponse(err, { route: 'AUTO-TRADING' })
  }
}
