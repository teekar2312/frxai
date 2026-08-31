import { NextResponse } from 'next/server'
import { fetchNews, getNewsStats, detectBreakingNews, seedNewsSourceConfigs } from '@/lib/news-api'
import logger from '@/lib/trading-logger'

/**
 * POST /api/news/fetch — Fetch news from Finnhub/MARKETAUX
 * GET  /api/news/fetch — Get news stats + breaking news
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { symbols, maxArticles, provider, forceRefresh } = body

    await seedNewsSourceConfigs()

    const result = await fetchNews({
      symbols: symbols ?? undefined,
      maxArticles: maxArticles ?? undefined,
      provider: provider ?? undefined,
      forceRefresh: forceRefresh ?? false,
    })

    logger.info('API_RATE_LIMIT', `News fetch completed: ${result.newArticles} new, ${result.deduped} deduped from ${result.provider}`, {
      metadata: {
        provider: result.provider,
        totalFetched: result.totalFetched,
        newArticles: result.newArticles,
        deduped: result.deduped,
        responseTimeMs: result.responseTimeMs,
        cached: result.cached,
      },
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('API_RATE_LIMIT', `News fetch failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function GET() {
  try {
    const stats = await getNewsStats()
    const breaking = await detectBreakingNews()
    return NextResponse.json({
      success: true,
      data: { stats, breakingNews: breaking },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('API_RATE_LIMIT', `News stats fetch failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
