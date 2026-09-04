import { HIGH_RISK_SCORE, MAX_BREAKING_NEWS, type DecisionType, type TechnicalFactors, type NewsFactors, type SentimentFactors, type RiskFactors } from './types'

// ============================================================================
// SECTION 9: REASONING GENERATOR
// ============================================================================

/**
 * Generate a human-readable reasoning string explaining the decision.
 *
 * @param decision - The decision type
 * @param compositeScore - The weighted composite score
 * @param confidence - The confidence level
 * @param tech - Technical factors
 * @param news - News factors
 * @param sentiment - Sentiment factors
 * @param risk - Risk factors
 * @returns 2-3 sentence reasoning string
 */
export function generateReasoning(
  decision: DecisionType,
  compositeScore: number,
  confidence: number,
  tech: TechnicalFactors,
  news: NewsFactors,
  sentiment: SentimentFactors,
  risk: RiskFactors,
): string {
  const parts: string[] = []

  // Primary driver
  if (decision === 'BUY') {
    parts.push(
      `Composite score of ${compositeScore.toFixed(1)} with ${confidence}% confidence indicates bullish conditions.`,
    )
  } else if (decision === 'SELL') {
    parts.push(
      `Composite score of ${compositeScore.toFixed(1)} with ${confidence}% confidence indicates bearish conditions.`,
    )
  } else if (decision === 'SKIP') {
    if (sentiment.isBlocked) {
      parts.push('Trade skipped due to extreme sentiment filter block.')
    } else if (risk.riskScore > HIGH_RISK_SCORE) {
      parts.push(`Trade skipped due to elevated risk score of ${risk.riskScore}/10.`)
    } else if (news.breakingNewsCount > MAX_BREAKING_NEWS) {
      parts.push(`Trade skipped due to ${news.breakingNewsCount} breaking news items causing uncertainty.`)
    } else {
      parts.push('Insufficient signal strength to generate actionable decision.')
    }
  } else if (decision === 'REDUCE') {
    const reductionPct = risk.consecutiveLosses >= 4 ? 50 : 30
    parts.push(
      `REDUCE signal: risk score ${risk.riskScore}/10 with ${risk.openPositions} open positions and ${risk.consecutiveLosses} consecutive losses. Recommended: reduce position sizes by ~${reductionPct}% or close weakest positions.`,
    )
  } else if (decision === 'CLOSE_ALL') {
    // Fix 4 (Task 7): CLOSE_ALL reasoning
    parts.push(
      `CLOSE_ALL signal: extreme risk score of ${risk.riskScore}/10. All positions should be closed immediately.`,
    )
  } else {
    parts.push(
      `HOLD signal with composite score ${compositeScore.toFixed(1)} — no decisive directional bias detected.`,
    )
  }

  // Contributing factors
  const factorParts: string[] = []
  if (tech.trendDirection !== 'SIDEWAYS') {
    factorParts.push(`${tech.trendDirection.toLowerCase()} trend (strength ${tech.trendStrength}%)`)
  }
  if (tech.rsiSignal !== 'NEUTRAL') {
    factorParts.push(`RSI ${tech.rsiSignal.toLowerCase()} (${tech.rsiValue})`)
  }
  if (news.newsImpactScore > 20 || news.newsImpactScore < -20) {
    factorParts.push(
      `news impact ${news.newsImpactScore > 0 ? 'positive' : 'negative'} (${Math.abs(news.newsImpactScore)})`,
    )
  }
  if (Math.abs(sentiment.symbolScore) > 15) {
    factorParts.push(
      `sentiment ${sentiment.symbolScore > 0 ? 'bullish' : 'bearish'} (${sentiment.symbolScore})`,
    )
  }

  if (factorParts.length > 0) {
    parts.push(`Key factors: ${factorParts.join(', ')}.`)
  }

  // Risk context
  if (risk.riskScore >= 5) {
    parts.push(`Risk score elevated at ${risk.riskScore}/10 (${risk.volatilityRegime}).`)
  }

  return parts.join(' ')
}
