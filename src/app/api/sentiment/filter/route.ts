import { NextResponse } from 'next/server'
import { filterTrade, seedSentimentKeywords } from '@/lib/sentiment-filter'
import logger from '@/lib/trading-logger'

/**
 * POST /api/sentiment/filter — Check if a trade should be blocked by sentiment
 * Body: { symbol: string, direction: 'BUY' | 'SELL' }
 */
export async function POST(request: Request) {
  try {
    await seedSentimentKeywords()
    const body = await request.json()
    const { symbol, direction } = body

    if (!symbol || !direction) {
      return NextResponse.json({ success: false, error: 'symbol and direction required' }, { status: 400 })
    }

    const result = await filterTrade(symbol, direction)
    logger.info('RISK_MANAGEMENT', `Sentiment filter for ${symbol} ${direction}: ${result.shouldBlock ? 'BLOCKED' : 'ALLOWED'}`, {
      symbol,
      metadata: {
        direction,
        blocked: result.shouldBlock,
        regime: result.regime,
        sizeAdjustment: result.sizeAdjustment,
        symbolScore: result.symbolScore,
      },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('RISK_MANAGEMENT', `Sentiment filter failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
