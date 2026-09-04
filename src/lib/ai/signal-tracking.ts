import { type TechnicalFactors, type NewsFactors, type SentimentFactors } from './types'

// ============================================================================
// SECTION 8: SIGNAL SOURCE TRACKING
// ============================================================================

/**
 * Build a list of active signal sources that contributed to the decision.
 * Only includes sources with meaningful (non-neutral) signals.
 *
 * @param tech - Technical factors
 * @param news - News factors
 * @param sentiment - Sentiment factors
 * @returns Array of signal source strings like 'RSI_OVERSOLD', 'MACD_BULLISH'
 */
export function buildSignalSources(
  tech: TechnicalFactors,
  news: NewsFactors,
  sentiment: SentimentFactors,
): string[] {
  const sources: string[] = []

  // Technical signals
  for (const sig of tech.signals) {
    if (sig.signal === 'NEUTRAL' || sig.signal === 'SIDEWAYS' || sig.signal === 'MIDDLE' || sig.signal === 'RANGING') {
      continue
    }
    sources.push(`${sig.name}_${sig.signal}`)
  }

  // News signals
  if (news.newsImpactScore > 30) {
    sources.push('NEWS_POSITIVE')
  } else if (news.newsImpactScore < -30) {
    sources.push('NEWS_NEGATIVE')
  }
  if (news.breakingNewsCount > 0) {
    sources.push(`BREAKING_NEWS_${news.breakingNewsCount}`)
  }

  // Sentiment signals
  if (sentiment.symbolScore > 20) {
    sources.push('SENTIMENT_BULLISH')
  } else if (sentiment.symbolScore < -20) {
    sources.push('SENTIMENT_BEARISH')
  }
  if (sentiment.trend === 'IMPROVING') {
    sources.push('SENTIMENT_IMPROVING')
  } else if (sentiment.trend === 'DECLINING') {
    sources.push('SENTIMENT_DECLINING')
  }

  return sources
}
