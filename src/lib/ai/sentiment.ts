import logger from '@/lib/trading-logger'
import { filterTrade, getSentimentTrend } from '@/lib/sentiment-filter'
import type { SentimentTrend } from '@/lib/sentiment-filter'
import { type SentimentFactors } from './types'
import { defaultSentimentFactors } from './helpers'

// ============================================================================
// SECTION 6: SENTIMENT ANALYSIS INTEGRATION
// ============================================================================

/**
 * Analyze sentiment factors for a symbol.
 *
 * Fix #19: Eliminated redundant computeSymbolSentiment call — filterTrade
 * already triggers computation if snapshot is stale. Now only fetches the
 * sentiment trend separately, which is lightweight.
 *
 * Fix #24: Now returns the trend object so the decision engine can factor
 * sentiment direction (IMPROVING/DECLINING) into confidence.
 */
export async function analyzeSentimentFactors(symbol: string): Promise<SentimentFactors & { trendDirection?: string; trendChangeRate?: number }> {
  const factors = defaultSentimentFactors()

  try {
    // Check BOTH directions to avoid directional bias
    const [buyFilter, sellFilter] = await Promise.all([
      filterTrade(symbol, 'BUY'),
      filterTrade(symbol, 'SELL'),
    ])

    // Use the less restrictive result for isBlocked (block only if BOTH are blocked)
    factors.isBlocked = buyFilter.shouldBlock && sellFilter.shouldBlock
    factors.regime = buyFilter.regime // Same for both directions
    factors.symbolScore = buyFilter.symbolScore
    factors.marketScore = buyFilter.marketScore
    factors.confidence = buyFilter.confidence
    // Use the more conservative (lower) size adjustment
    factors.sizeAdjustment = Math.min(buyFilter.sizeAdjustment, sellFilter.sizeAdjustment)

    // Store which direction is blocked for reasoning
    if (buyFilter.shouldBlock && !sellFilter.shouldBlock) {
      factors.isBlocked = false // Only BUY blocked, SELL still allowed
    }
  } catch (err) {
    logger.error('AI_ENGINE', `Sentiment filter failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
  }

  // Get sentiment trend (lightweight, no article re-fetch needed)
  try {
    const trend: SentimentTrend = await getSentimentTrend(symbol)
    factors.trend = trend.direction
    // Expose trend details for composite score adjustment
    return {
      ...factors,
      trendDirection: trend.direction,
      trendChangeRate: trend.changeRate,
    }
  } catch (err) {
    logger.error('AI_ENGINE', `Sentiment trend failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
  }

  return factors
}
