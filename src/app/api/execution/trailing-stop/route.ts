import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { adjustTrailingStop } from "@/lib/trade-execution-engine"
import { updateDailyPerformance } from "@/lib/money-management"
import logger from "@/lib/trading-logger"

/**
 * POST /api/execution/trailing-stop
 * Manually trigger trailing stop evaluation for a specific trade.
 * Body: { tradeId: string, currentPrice: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, currentPrice } = body

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

    const result = adjustTrailingStop(trade, currentPrice)

    if (result.adjusted && result.newSl) {
      await db.trade.update({
        where: { id: tradeId },
        data: {
          sl: result.newSl,
          lastSlAdjust: new Date(),
          highestPrice: Math.max(trade.highestPrice ?? trade.currentPrice, currentPrice),
          lowestPrice: Math.min(trade.lowestPrice ?? trade.currentPrice, currentPrice),
        },
      })

      logger.info('TRADE_EXECUTION', `Trailing stop adjusted for ${trade.symbol}`, {
        tradeId,
        symbol: trade.symbol,
        metadata: { oldSl: trade.sl, newSl: result.newSl, reason: result.reason },
      })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Error adjusting trailing stop:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to adjust trailing stop' },
      { status: 500 },
    )
  }
}