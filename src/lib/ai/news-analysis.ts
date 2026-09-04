import logger from '@/lib/trading-logger'
import { fetchNews, detectBreakingNews } from '@/lib/news-api'
import { scoreArticle } from '@/lib/sentiment-filter'
import { BREAKING_NEWS_CACHE_TTL_MS, NEWS_FETCH_CACHE_MS, NEWS_FETCH_CACHE_MAX_ENTRIES, type NewsFactors } from './types'
import { defaultNewsFactors } from './helpers'

// Breaking news cache (shared across symbols within the same minute)
let breakingNewsCache: { items: Awaited<ReturnType<typeof detectBreakingNews>>; cachedAt: number } | null = null
// Fix 4 (Task 2-b): Time-based cache for per-symbol news fetches (avoids redundant API calls)
const lastNewsFetchTime: Record<string, number> = {}

// ============================================================================
// SECTION 5: NEWS IMPACT ANALYSIS
// ============================================================================

/**
 * Analyze news impact for a symbol.
 *
 * Fix #14/#18: Now reuses sentiment-filter's scoreArticle() instead of
 * maintaining a separate hardcoded keyword list. This ensures consistency
 * between news scoring and sentiment analysis.
 */
export async function analyzeNewsFactors(symbol: string): Promise<NewsFactors> {
  try {
    const nowMs = Date.now()
    const lastFetch = lastNewsFetchTime[symbol] ?? 0
    const shouldRefresh = (nowMs - lastFetch) > NEWS_FETCH_CACHE_MS
    const result = await fetchNews({ symbols: [symbol], maxArticles: 20, forceRefresh: shouldRefresh })
    if (result.newArticles > 0 || shouldRefresh) {
      lastNewsFetchTime[symbol] = nowMs
      // Fix 4: LRU eviction — evict oldest 20% when cache exceeds max entries
      const cacheKeys = Object.keys(lastNewsFetchTime)
      if (cacheKeys.length > NEWS_FETCH_CACHE_MAX_ENTRIES) {
        const sortedKeys = cacheKeys.sort((a, b) => lastNewsFetchTime[a] - lastNewsFetchTime[b])
        const evictCount = Math.ceil(sortedKeys.length * 0.2)
        for (let i = 0; i < evictCount; i++) {
          delete lastNewsFetchTime[sortedKeys[i]]
        }
      }
    }
    const articles = result.articles

    const factors = defaultNewsFactors()
    factors.recentNewsCount = articles.length

    let positiveCount = 0
    let negativeCount = 0
    let relevantCount = 0
    const headlines: string[] = []

    for (const article of articles) {
      // Check if article directly mentions the symbol
      const titleMention = article.title.toUpperCase().includes(symbol.toUpperCase())
      const contentMention = article.content
        ? article.content.toUpperCase().includes(symbol.toUpperCase())
        : false
      const isRelevant = titleMention || contentMention
      if (isRelevant) relevantCount++

      // Fix #14/#18: Use sentiment-filter's scoreArticle for consistency
      const scored = scoreArticle({ title: article.title, content: article.content })
      if (scored.label === 'POSITIVE') positiveCount++
      else if (scored.label === 'NEGATIVE') negativeCount++

      // Collect headlines (up to 3)
      if (headlines.length < 3 && article.title) {
        headlines.push(article.title)
      }
    }

    factors.positiveNews = positiveCount
    factors.negativeNews = negativeCount
    factors.topHeadlines = headlines

    // Calculate news impact score
    const total = positiveCount + negativeCount
    factors.newsImpactScore = total > 0
      ? Math.round(((positiveCount - negativeCount) / total) * 100)
      : 0

    // Relevance score: ratio of symbol-mentioning articles
    factors.relevanceScore = articles.length > 0
      ? Math.round((relevantCount / articles.length) * 100)
      : 0

    // Count breaking news (cached for 1 minute across symbols)
    try {
      if (!breakingNewsCache || (Date.now() - breakingNewsCache.cachedAt) > BREAKING_NEWS_CACHE_TTL_MS) {
        breakingNewsCache = { items: await detectBreakingNews(), cachedAt: Date.now() }
      }
      factors.breakingNewsCount = breakingNewsCache.items.filter(
        item => item.article.symbols.includes(symbol),
      ).length
    } catch {
      factors.breakingNewsCount = 0
    }

    return factors
  } catch (err) {
    logger.error('AI_ENGINE', `News analysis failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
    return defaultNewsFactors()
  }
}
