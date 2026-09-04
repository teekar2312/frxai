import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { adjustTrailingStop, type TrailingStopResult } from "@/lib/trade-execution-engine"
import { getTradingPhase } from "@/lib/mt5-connection"
import logger from "@/lib/trading-logger"
import { apiErrorResponse } from '@/lib/api-errors'

/**
 * POST /api/execution/trailing-stop
 * Manually trigger trailing stop evaluation for a specific trade.
 *
 * Body:
 *   tradeId: string       - Required. The trade to evaluate.
 *   currentPrice: number  - Required. The current market price.
 *   trailingSteps?: TrailingStep[] - Optional. Tiered trailing steps to apply.
 *   trailingCooldownSec?: number - Optional. Cooldown between adjustments.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, currentPrice, trailingSteps, trailingCooldownSec } = body

    if (!tradeId || currentPrice == null) {
      return NextResponse.json(
        { success: false, error: 'Missing tradeId or currentPrice' },
        { status: 400 },
      )
    }

    const trade = await db.trade.findUnique({ where: { id: tradeId } })
    if (!trade) {
      return NextResponse.json(
        { success: false, error: 'Trade not found' },
        { status: 404 },
      )
    }

    // Get current trading phase for phase-aware trailing (Fix 4)
    const currentPhase = getTradingPhase()
    const now = new Date()

    // Allow the API caller to set/override trailing steps and cooldown
    const effectiveTrailingSteps = trailingSteps
      ? JSON.stringify(trailingSteps)
      : trade.trailingSteps
    const effectiveCooldownSec = trailingCooldownSec ?? trade.trailingCooldownSec

    const result: TrailingStopResult = adjustTrailingStop(
      {
        id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        currentPrice: trade.currentPrice,
        trailingStop: trade.trailingStop,
        trailingDist: trade.trailingDist,
        sl: trade.sl,
        highestPrice: trade.highestPrice,
        lowestPrice: trade.lowestPrice,
        lastSlAdjust: trade.lastSlAdjust,
        trailingSteps: effectiveTrailingSteps,
        trailingAdjustments: trade.trailingAdjustments,
        trailingCooldownSec: effectiveCooldownSec,
        commission: trade.commission,
        lotSize: trade.lotSize,
      },
      currentPrice,
      { currentPhase, now },
    )

    if (result.adjusted && result.newSl) {
      // Update peak prices (always, for consistency with pipeline behavior)
      const newHighestPrice = trade.direction === 'BUY'
        ? Math.max(trade.highestPrice ?? trade.currentPrice, currentPrice)
        : trade.highestPrice
      const newLowestPrice = trade.direction === 'SELL'
        ? Math.min(trade.lowestPrice ?? trade.currentPrice, currentPrice)
        : trade.lowestPrice

      // Atomic update: only apply if trade is still open
      const updateResult = await db.trade.updateMany({
        where: { id: tradeId, status: { in: ['OPEN', 'PARTIAL_FILLED'] } },
        data: {
          sl: result.newSl,
          highestPrice: newHighestPrice,
          lowestPrice: newLowestPrice,
          lastSlAdjust: now,
          trailingAdjustments: (trade.trailingAdjustments ?? 0) + 1,
          trailingActivatedAt: trade.trailingActivatedAt ?? now,
          breakEvenApplied: result.breakEvenApplied ? true : trade.breakEvenApplied,
        },
      })

      if (updateResult.count === 0) {
        return NextResponse.json(
          { success: false, error: `Trade ${tradeId} was closed during trailing evaluation` },
          { status: 409 },
        )
      }

      logger.info('TRADE_EXECUTION', `Trailing stop adjusted for ${trade.symbol}`, {
        tradeId,
        symbol: trade.symbol,
        metadata: {
          oldSl: trade.sl,
          newSl: result.newSl,
          reason: result.reason,
          activeStep: result.activeStep,
          effectiveTrailDist: result.effectiveTrailDist,
          breakEvenApplied: result.breakEvenApplied,
          phase: currentPhase,
        },
      })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    logger.error('API', 'Error adjusting trailing stop', { details: String(error) })
    return apiErrorResponse(error, { route: 'POST /api/execution/trailing-stop' })
  }
}
