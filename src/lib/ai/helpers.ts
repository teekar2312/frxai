import type { TechnicalFactors, NewsFactors, SentimentFactors, RiskFactors, LlmEnhancement } from './types'
import type { LlmAnalysisResult } from '@/lib/ai-providers'

// ============================================================================
// SECTION 3: HELPERS
// ============================================================================

/**
 * Deterministic pseudo-random number generator seeded by string + date.
 * Returns a value in [0, 1) that is consistent for the same symbol on the same day.
 */
export function seededRandom(symbol: string, index: number): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const seed = `${symbol}:${today}:${index}`
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  // Convert to positive 32-bit, then normalize to [0, 1)
  const positive = (hash >>> 0) % 10000
  return positive / 10000
}

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Safe JSON parse with fallback */
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Safe JSON stringify */
export function toJsonString(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

/** Map a value from one range to another */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const clamped = clamp(value, inMin, inMax)
  const ratio = (clamped - inMin) / (inMax - inMin || 1)
  return outMin + ratio * (outMax - outMin)
}

/** Generate default TechnicalFactors (also used as safe fallbacks by callers) */
export function defaultTechnicalFactors(): TechnicalFactors {
  return {
    trendDirection: 'SIDEWAYS',
    trendStrength: 0,
    rsiValue: 50,
    rsiSignal: 'NEUTRAL',
    macdSignal: 'NEUTRAL',
    macdHistogram: 0,
    bollingerPosition: 'MIDDLE',
    supportLevel: 0,
    resistanceLevel: 0,
    volumeTrend: 'NORMAL',
    adxValue: 0,
    stochasticSignal: 'NEUTRAL',
    overallScore: 0,
    signals: [],
    atrValue: null, // Fix 3 (Task 7): default to null
  }
}

/** Generate default NewsFactors (also used as safe fallbacks by callers) */
export function defaultNewsFactors(): NewsFactors {
  return {
    recentNewsCount: 0,
    positiveNews: 0,
    negativeNews: 0,
    breakingNewsCount: 0,
    newsImpactScore: 0,
    topHeadlines: [],
    relevanceScore: 0,
  }
}

/** Generate default SentimentFactors (also used as safe fallbacks by callers) */
export function defaultSentimentFactors(): SentimentFactors {
  return {
    symbolScore: 0,
    marketScore: 0,
    regime: 'NEUTRAL',
    trend: 'STABLE',
    confidence: 0,
    isBlocked: false,
    sizeAdjustment: 1.0,
  }
}

/** Generate default RiskFactors (also used as safe fallbacks by callers) */
export function defaultRiskFactors(): RiskFactors {
  return {
    riskScore: 0,
    volatilityRegime: 'NORMAL',
    maxDrawdownPct: 0,
    dailyLossPct: 0,
    consecutiveLosses: 0,
    marginUsagePct: 0,
    openPositions: 0,
    portfolioRiskPct: 0,
  }
}

/** Default LLM enhancement (no LLM used) */
export function noLlmEnhancement(): LlmEnhancement {
  return {
    used: false,
    provider: null,
    model: null,
    latencyMs: null,
    llmMarketCondition: null,
    llmTrendDirection: null,
    llmConfidence: null,
    llmAction: null,
    llmReasoning: null,
    llmKeyFactors: null,
    llmRiskAssessment: null,
    llmSentimentBias: null,
    rawResponse: null,
    error: null,
    usage: null,
  }
}

/** Convert LlmAnalysisResult to LlmEnhancement for AiDecision */
export function toLlmEnhancement(result: LlmAnalysisResult): LlmEnhancement {
  return {
    used: result.used,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    llmMarketCondition: result.marketAnalysis?.marketCondition ?? null,
    llmTrendDirection: result.marketAnalysis?.trendDirection ?? null,
    llmConfidence: result.marketAnalysis?.confidence ?? null,
    llmAction: result.marketAnalysis?.action ?? null,
    llmReasoning: result.marketAnalysis?.reasoning ?? null,
    llmKeyFactors: result.marketAnalysis?.keyFactors ?? null,
    llmRiskAssessment: result.marketAnalysis?.riskAssessment ?? null,
    llmSentimentBias: result.marketAnalysis?.sentimentBias ?? null,
    rawResponse: result.rawResponse,
    error: result.error,
    usage: result.usage,
  }
}
