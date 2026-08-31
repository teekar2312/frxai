import { NextResponse } from 'next/server'
import { computeSymbolSentiment, computeMarketSentiment, getSentimentTrend, getSentimentStats, seedSentimentKeywords } from '@/lib/sentiment-filter'
import logger from '@/lib/trading-logger'

/**
 * GET /api/sentiment/snapshot — Get sentiment snapshot
 * Query: ?symbol=XXX | ?market=true | ?trend=XXX&hours=24 | ?stats=true
 */
export async function GET(request: Request) {
  try {
    await seedSentimentKeywords()
    const url = new URL(request.url)
    const symbol = url.searchParams.get('symbol')
    const market = url.searchParams.get('market') === 'true'
    const trendSymbol = url.searchParams.get('trend')
    const hours = parseInt(url.searchParams.get('hours') ?? '24', 10)
    const stats = url.searchParams.get('stats') === 'true'

    if (stats) {
      const sentimentStats = await getSentimentStats()
      return NextResponse.json({ success: true, data: sentimentStats })
    }

    if (trendSymbol) {
      const trend = await getSentimentTrend(trendSymbol, hours)
      return NextResponse.json({ success: true, data: trend })
    }

    if (market) {
      const snapshot = await computeMarketSentiment()
      return NextResponse.json({ success: true, data: snapshot })
    }

    if (symbol) {
      const snapshot = await computeSymbolSentiment(symbol)
      return NextResponse.json({ success: true, data: snapshot })
    }

    return NextResponse.json({ success: false, error: 'Specify ?symbol=, ?market=true, ?trend=, or ?stats=true' }, { status: 400 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('AI_ENGINE', `Sentiment snapshot failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
