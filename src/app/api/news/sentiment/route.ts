import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreArticle } from '@/lib/sentiment-filter'
import { seedNewsSourceConfigs } from '@/lib/news-api'
import logger from '@/lib/trading-logger'

/**
 * POST /api/news/sentiment — Re-score articles' sentiment
 * Query param ?unscored=true to only score unscored articles
 */
export async function POST(request: Request) {
  try {
    await seedNewsSourceConfigs()

    const body = await request.json().catch(() => ({}))
    const { unscoredOnly = true } = body

    const where = unscoredOnly
      ? { sentimentScore: 0 }
      : {}

    const articles = await db.newsArticle.findMany({
      where,
      orderBy: { fetchedAt: 'desc' },
      take: 50,
    })

    let updated = 0
    for (const article of articles) {
      const result = scoreArticle({ title: article.title, content: article.content })
      await db.newsArticle.update({
        where: { id: article.id },
        data: {
          sentiment: result.label,
          sentimentScore: result.score,
        },
      })
      updated++
    }

    logger.info('AI_ENGINE', `Re-scored ${updated} articles (unscoredOnly: ${unscoredOnly})`)

    return NextResponse.json({ success: true, data: { scored: updated, total: articles.length } })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('AI_ENGINE', `Sentiment scoring failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
