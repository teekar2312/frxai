/**
 * FINEX Trading System - AI Decision Engine (Phase 6)
 * ==================================================
 * Synthesizes technical analysis, news impact, and sentiment data
 * into actionable trading decisions with confidence scoring,
 * risk-aware overrides, and accuracy tracking.
 *
 * Components:
 *  1. Type definitions for all factor interfaces
 *  2. Technical Analysis Synthesizer (deterministic mock)
 *  3. News Impact Analysis (via news-api module)
 *  4. Sentiment Analysis Integration (via sentiment-filter module)
 *  5. Risk Context Analyzer (via Trade/DailyPerformance/RiskConfig)
 *  6. Core Decision Engine with weighted scoring
 *  7. Batch Decision Processing
 *  8. Decision Accuracy Tracker with calibration
 *  9. Decision History & Override System
 * 10. Configuration Management
 */

import { db } from './db'
import logger from './trading-logger'
import { fetchNews, detectBreakingNews } from './news-api'
import {
  filterTrade,
  computeSymbolSentiment,
  getSentimentTrend,
} from './sentiment-filter'
import type { SentimentFilterResult, SentimentTrend } from './sentiment-filter'

// ============================================================================
// SECTION 1: TYPES & INTERFACES
// ============================================================================

/** Possible trading decision outputs */
export type DecisionType = 'BUY' | 'SELL' | 'HOLD' | 'SKIP' | 'REDUCE' | 'CLOSE_ALL'

/** Strength of an individual signal */
export type SignalStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE'

/** Individual indicator signal within technical analysis */
export interface IndicatorSignal {
  name: string
  signal: string
  weight: number
  score: number
}

/** Technical analysis factors for a symbol */
export interface TechnicalFactors {
  trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS'
  trendStrength: number
  rsiValue: number
  rsiSignal: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL'
  macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  macdHistogram: number
  bollingerPosition: 'ABOVE_UPPER' | 'BELOW_LOWER' | 'MIDDLE' | 'NEAR_UPPER' | 'NEAR_LOWER'
  supportLevel: number
  resistanceLevel: number
  volumeTrend: 'INCREASING' | 'DECREASING' | 'NORMAL'
  adxValue: number
  stochasticSignal: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL'
  overallScore: number
  signals: IndicatorSignal[]
}

/** News impact factors for a symbol */
export interface NewsFactors {
  recentNewsCount: number
  positiveNews: number
  negativeNews: number
  breakingNewsCount: number
  newsImpactScore: number
  topHeadlines: string[]
  relevanceScore: number
}

/** Sentiment analysis factors for a symbol */
export interface SentimentFactors {
  symbolScore: number
  marketScore: number
  regime: string
  trend: string
  confidence: number
  isBlocked: boolean
  sizeAdjustment: number
}

/** Risk context factors for the portfolio */
export interface RiskFactors {
  riskScore: number
  volatilityRegime: string
  maxDrawdownPct: number
  dailyLossPct: number
  consecutiveLosses: number
  marginUsagePct: number
  openPositions: number
  portfolioRiskPct: number
}

/** Complete AI decision output */
export interface AiDecision {
  symbol: string
  decision: DecisionType
  confidence: number
  reasoning: string
  technicalFactors: TechnicalFactors
  newsFactors: NewsFactors
  sentimentFactors: SentimentFactors
  riskFactors: RiskFactors
  suggestedLotSize: number
  suggestedSl: number
  suggestedTp: number
  strategyUsed: string
  timeframe: string
  signalSources: string[]
  volatilityMultiplier: number
  createdAt: Date
}

/** Accuracy breakdown by confidence tier */
export interface ConfidenceCalibration {
  low: { count: number; winRate: number }
  medium: { count: number; winRate: number }
  high: { count: number; winRate: number }
}

/** Per-decision-type accuracy stats */
export interface DecisionTypeStats {
  count: number
  correct: number
  avgPnl: number
}

/** Overall decision accuracy tracker output */
export interface DecisionAccuracy {
  totalDecisions: number
  correctDecisions: number
  winRate: number
  avgConfidence: number
  avgPnlImpact: number
  byDecision: Record<DecisionType, DecisionTypeStats>
  confidenceCalibration: ConfidenceCalibration
}

// ============================================================================
// SECTION 2: CONSTANTS
// ============================================================================

const DEFAULT_TIMEFRAME = 'H1'
const BUY_THRESHOLD = 30
const SELL_THRESHOLD = -30
const HIGH_RISK_SCORE = 7
const MAX_BREAKING_NEWS = 2
const SL_MULTIPLIER = 1.0
const TP_MULTIPLIER = 1.5
const DEFAULT_ATR_PCT = 0.015 // 1.5% estimated ATR for SL/TP calc
const MATCHING_WINDOW_MS = 5 * 60 * 1000 // 5 minutes to match decision to trade

// ============================================================================
// SECTION 3: HELPERS
// ============================================================================

/**
 * Deterministic pseudo-random number generator seeded by string + date.
 * Returns a value in [0, 1) that is consistent for the same symbol on the same day.
 */
function seededRandom(symbol: string, index: number): number {
  const today = new Date().toISOString().slice(0, 10)
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
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Safe JSON parse with fallback */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Safe JSON stringify */
function toJsonString(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

/** Map a value from one range to another */
function mapRange(
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

/** Generate default TechnicalFactors */
function defaultTechnicalFactors(): TechnicalFactors {
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
  }
}

/** Generate default NewsFactors */
function defaultNewsFactors(): NewsFactors {
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

/** Generate default SentimentFactors */
function defaultSentimentFactors(): SentimentFactors {
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

/** Generate default RiskFactors */
function defaultRiskFactors(): RiskFactors {
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

// ============================================================================
// SECTION 4: TECHNICAL ANALYSIS SYNTHESIZER
// ============================================================================

/**
 * Analyze technical factors for a symbol using deterministic mock data.
 *
 * Since this module does not have a direct MT5 data connection, it generates
 * consistent pseudo-random technical indicators based on the symbol and
 * current date. This ensures the same symbol produces the same values
 * throughout the day, while varying across symbols and days.
 *
 * Weighting: Trend (30%), RSI (15%), MACD (20%), Bollinger (15%),
 *           ADX (10%), Volume (10%)
 *
 * @param symbol - Ticker symbol to analyze
 * @param timeframe - Chart timeframe (default 'H1')
 * @returns TechnicalFactors with composite overallScore in [-100, +100]
 */
export function analyzeTechnicalFactors(
  symbol: string,
  timeframe: string = DEFAULT_TIMEFRAME,
): TechnicalFactors {
  try {
    const factors = defaultTechnicalFactors()
    const signals: IndicatorSignal[] = []

    // --- Trend Direction & Strength ---
    const trendRaw = seededRandom(symbol, 0)
    factors.trendDirection = trendRaw > 0.6 ? 'UP' : trendRaw < 0.4 ? 'DOWN' : 'SIDEWAYS'
    factors.trendStrength = Math.round(seededRandom(symbol, 1) * 80 + 20)

    const trendScore = factors.trendDirection === 'UP'
      ? mapRange(factors.trendStrength, 0, 100, 20, 100)
      : factors.trendDirection === 'DOWN'
        ? mapRange(factors.trendStrength, 0, 100, -100, -20)
        : mapRange(factors.trendStrength, 0, 100, -15, 15)

    signals.push({
      name: 'TREND',
      signal: factors.trendDirection,
      weight: 30,
      score: Math.round(trendScore),
    })

    // --- RSI (0-100, typical range 30-70) ---
    const rsiRaw = seededRandom(symbol, 2)
    factors.rsiValue = Math.round(rsiRaw * 60 + 20) // 20-80
    if (factors.rsiValue >= 70) {
      factors.rsiSignal = 'OVERBOUGHT'
    } else if (factors.rsiValue <= 30) {
      factors.rsiSignal = 'OVERSOLD'
    } else {
      factors.rsiSignal = 'NEUTRAL'
    }

    const rsiScore = factors.rsiSignal === 'OVERSOLD'
      ? mapRange(factors.rsiValue, 0, 30, 80, 20)
      : factors.rsiSignal === 'OVERBOUGHT'
        ? mapRange(factors.rsiValue, 70, 100, -20, -80)
        : mapRange(factors.rsiValue, 30, 70, -10, 10)

    signals.push({
      name: 'RSI',
      signal: factors.rsiSignal,
      weight: 15,
      score: Math.round(rsiScore),
    })

    // --- MACD Histogram & Signal ---
    const macdRaw = seededRandom(symbol, 3)
    factors.macdHistogram = Math.round((macdRaw - 0.5) * 200) / 100 // -1.0 to +1.0
    if (factors.macdHistogram > 0.1) {
      factors.macdSignal = 'BULLISH'
    } else if (factors.macdHistogram < -0.1) {
      factors.macdSignal = 'BEARISH'
    } else {
      factors.macdSignal = 'NEUTRAL'
    }

    const macdScore = mapRange(factors.macdHistogram, -1, 1, -100, 100)
    signals.push({
      name: 'MACD',
      signal: factors.macdSignal,
      weight: 20,
      score: Math.round(macdScore),
    })

    // --- Bollinger Band Position ---
    const bollRaw = seededRandom(symbol, 4)
    if (bollRaw > 0.85) {
      factors.bollingerPosition = 'ABOVE_UPPER'
    } else if (bollRaw > 0.7) {
      factors.bollingerPosition = 'NEAR_UPPER'
    } else if (bollRaw < 0.15) {
      factors.bollingerPosition = 'BELOW_LOWER'
    } else if (bollRaw < 0.3) {
      factors.bollingerPosition = 'NEAR_LOWER'
    } else {
      factors.bollingerPosition = 'MIDDLE'
    }

    const bollScore = factors.bollingerPosition === 'BELOW_LOWER'
      ? mapRange(bollRaw, 0, 0.15, 80, 40)
      : factors.bollingerPosition === 'ABOVE_UPPER'
        ? mapRange(bollRaw, 0.85, 1, -40, -80)
        : factors.bollingerPosition === 'NEAR_LOWER'
          ? mapRange(bollRaw, 0.15, 0.3, 40, 10)
          : factors.bollingerPosition === 'NEAR_UPPER'
            ? mapRange(bollRaw, 0.7, 0.85, -10, -40)
            : 0

    signals.push({
      name: 'BOLLINGER',
      signal: factors.bollingerPosition,
      weight: 15,
      score: Math.round(bollScore),
    })

    // --- ADX (0-100, trend strength) ---
    factors.adxValue = Math.round(seededRandom(symbol, 5) * 60 + 10) // 10-70
    const adxScore = factors.trendDirection === 'SIDEWAYS'
      ? 0
      : factors.trendDirection === 'UP'
        ? mapRange(factors.adxValue, 0, 100, 0, 60)
        : mapRange(factors.adxValue, 0, 100, 0, -60)

    signals.push({
      name: 'ADX',
      signal: factors.adxValue > 25 ? 'TRENDING' : 'RANGING',
      weight: 10,
      score: Math.round(adxScore),
    })

    // --- Volume Trend ---
    const volRaw = seededRandom(symbol, 6)
    if (volRaw > 0.65) {
      factors.volumeTrend = 'INCREASING'
    } else if (volRaw < 0.35) {
      factors.volumeTrend = 'DECREASING'
    } else {
      factors.volumeTrend = 'NORMAL'
    }

    const volScore = factors.volumeTrend === 'INCREASING'
      ? 30
      : factors.volumeTrend === 'DECREASING'
        ? -20
        : 0
    // Volume direction aligned with trend gives bonus
    const volAligned = (factors.trendDirection === 'UP' && factors.volumeTrend === 'INCREASING') ||
      (factors.trendDirection === 'DOWN' && factors.volumeTrend === 'INCREASING')
    const finalVolScore = volAligned ? volScore * 1.5 : volScore

    signals.push({
      name: 'VOLUME',
      signal: factors.volumeTrend,
      weight: 10,
      score: Math.round(finalVolScore),
    })

    // --- Stochastic ---
    const stochRaw = seededRandom(symbol, 7)
    if (stochRaw > 0.8) {
      factors.stochasticSignal = 'OVERBOUGHT'
    } else if (stochRaw < 0.2) {
      factors.stochasticSignal = 'OVERSOLD'
    } else {
      factors.stochasticSignal = 'NEUTRAL'
    }

    // Stochastic is informational, already captured via RSI/bollinger
    // Not weighted in overallScore but included for completeness

    // --- Support / Resistance (mock levels) ---
    const basePrice = 1000 + seededRandom(symbol, 8) * 9000
    const spread = basePrice * 0.03
    factors.supportLevel = Math.round((basePrice - spread) * 100) / 100
    factors.resistanceLevel = Math.round((basePrice + spread) * 100) / 100

    // --- Compute overallScore (weighted composite) ---
    let totalWeight = 0
    let weightedSum = 0
    for (const sig of signals) {
      weightedSum += sig.score * sig.weight
      totalWeight += sig.weight
    }
    factors.overallScore = totalWeight > 0
      ? Math.round(clamp(weightedSum / totalWeight, -100, 100))
      : 0

    factors.signals = signals

    return factors
  } catch (err) {
    logger.error('AI_ENGINE', `Technical analysis failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
    return defaultTechnicalFactors()
  }
}

// ============================================================================
// SECTION 5: NEWS IMPACT ANALYSIS
// ============================================================================

/**
 * Analyze news impact for a symbol.
 *
 * Fetches recent news from the news-api module, counts positive/negative/
 * breaking articles, calculates an impact score, and extracts top headlines.
 *
 * @param symbol - Ticker symbol to analyze news for
 * @returns NewsFactors with impact score in [-100, +100]
 */
export async function analyzeNewsFactors(symbol: string): Promise<NewsFactors> {
  try {
    const result = await fetchNews({ symbols: [symbol], maxArticles: 20 })
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

      // Classify sentiment from title keywords (lightweight heuristic)
      const titleLower = article.title.toLowerCase()
      const positiveKeywords = ['surge', 'rally', 'profit', 'growth', 'gain', 'strong', 'upgrade', 'beat', 'recovery', 'dividend', 'buyback']
      const negativeKeywords = ['crash', 'drop', 'fall', 'decline', 'loss', 'weak', 'downgrade', 'miss', 'crisis', 'scandal', 'fraud', 'investigation']

      const isPositive = positiveKeywords.some(kw => titleLower.includes(kw))
      const isNegative = negativeKeywords.some(kw => titleLower.includes(kw))

      if (isPositive && !isNegative) positiveCount++
      else if (isNegative && !isPositive) negativeCount++

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

    // Count breaking news
    try {
      const breakingItems = await detectBreakingNews()
      factors.breakingNewsCount = breakingItems.filter(
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

// ============================================================================
// SECTION 6: SENTIMENT ANALYSIS INTEGRATION
// ============================================================================

/**
 * Analyze sentiment factors for a symbol.
 *
 * Integrates with the sentiment-filter module to get trade filtering results,
 * symbol sentiment snapshots, and sentiment trend direction.
 *
 * @param symbol - Ticker symbol to analyze sentiment for
 * @returns SentimentFactors with symbol/market scores and blocking status
 */
export async function analyzeSentimentFactors(symbol: string): Promise<SentimentFactors> {
  const factors = defaultSentimentFactors()

  try {
    // Get trade filter result (primary integration point)
    const filterResult: SentimentFilterResult = await filterTrade(symbol, 'BUY')
    factors.isBlocked = filterResult.shouldBlock
    factors.regime = filterResult.regime
    factors.symbolScore = filterResult.symbolScore
    factors.marketScore = filterResult.marketScore
    factors.confidence = filterResult.confidence
    factors.sizeAdjustment = filterResult.sizeAdjustment

    // If BUY is blocked, also check SELL direction to refine
    if (filterResult.shouldBlock) {
      try {
        const sellFilter = await filterTrade(symbol, 'SELL')
        // Use the less restrictive result for informational purposes
        if (!sellFilter.shouldBlock) {
          factors.sizeAdjustment = sellFilter.sizeAdjustment
        }
      } catch {
        // Keep original filter result
      }
    }
  } catch (err) {
    logger.error('AI_ENGINE', `Sentiment filter failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
  }

  // Get symbol sentiment snapshot
  try {
    const snapshot = await computeSymbolSentiment(symbol)
    if (snapshot) {
      factors.symbolScore = snapshot.overallScore as number
      factors.regime = snapshot.sentimentRegime as string
      factors.confidence = snapshot.confidence as number
    }
  } catch (err) {
    logger.error('AI_ENGINE', `Symbol sentiment computation failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
  }

  // Get sentiment trend
  try {
    const trend: SentimentTrend = await getSentimentTrend(symbol)
    factors.trend = trend.direction
  } catch (err) {
    logger.error('AI_ENGINE', `Sentiment trend failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
  }

  return factors
}

// ============================================================================
// SECTION 7: RISK CONTEXT ANALYZER
// ============================================================================

/**
 * Analyze current portfolio risk context.
 *
 * Queries open trades, daily performance, and risk configuration to build
 * a comprehensive risk profile for decision-making.
 *
 * @returns RiskFactors with portfolio-level risk metrics
 */
export async function analyzeRiskFactors(): Promise<RiskFactors> {
  const factors = defaultRiskFactors()

  try {
    // --- Open positions count & margin usage ---
    const openTrades = await db.trade.findMany({
      where: { status: 'OPEN' },
    })
    factors.openPositions = openTrades.length

    // Calculate total margin and portfolio risk
    let totalMargin = 0
    let totalRiskAmount = 0
    for (const trade of openTrades) {
      totalMargin += trade.margin
      if (trade.riskAmount) {
        totalRiskAmount += trade.riskAmount
      }
    }

    // Margin usage as percentage (assume 100M IDR base if no config found)
    let baseEquity = 100_000_000
    try {
      const riskConfig = await db.riskConfig.findFirst({ where: { name: 'default' } })
      if (riskConfig) {
        factors.maxDrawdownPct = riskConfig.maxDrawdown
        // Use max margin usage as reference
        const maxMarginPct = riskConfig.maxMarginUsage
        factors.marginUsagePct = maxMarginPct > 0
          ? Math.round((totalMargin / (baseEquity * maxMarginPct / 100)) * 100)
          : 0
      }
    } catch {
      // Use default estimates
    }

    if (factors.marginUsagePct === 0 && totalMargin > 0) {
      factors.marginUsagePct = Math.round((totalMargin / baseEquity) * 100)
    }

    // Portfolio risk as percentage of equity
    factors.portfolioRiskPct = baseEquity > 0
      ? Math.round((totalRiskAmount / baseEquity) * 100)
      : 0

    // --- Daily performance ---
    const today = new Date().toISOString().slice(0, 10)
    try {
      const dailyPerf = await db.dailyPerformance.findUnique({
        where: { date: today },
      })
      if (dailyPerf) {
        factors.dailyLossPct = Math.abs(dailyPerf.pnlPercent)
        factors.consecutiveLosses = dailyPerf.consecutiveLosses
      }
    } catch {
      // No daily perf record yet
    }

    // --- Determine volatility regime ---
    // Check recent closed trades for volatility clues
    try {
      const recentClosed = await db.trade.findMany({
        where: { status: 'CLOSED' },
        orderBy: { closeTime: 'desc' },
        take: 20,
      })

      if (recentClosed.length >= 5) {
        // Calculate average absolute PnL percent as volatility proxy
        const avgAbsPnl = recentClosed.reduce(
          (sum, t) => sum + Math.abs(t.pnlPercent),
          0,
        ) / recentClosed.length

        if (avgAbsPnl > 3.0) {
          factors.volatilityRegime = 'HIGH_VOLATILITY'
        } else if (avgAbsPnl < 0.5) {
          factors.volatilityRegime = 'LOW_VOLATILITY'
        } else {
          factors.volatilityRegime = 'NORMAL'
        }
      }
    } catch {
      // Keep default NORMAL
    }

    // --- Composite risk score (0-10) ---
    let riskScore = 0

    // Margin usage component (0-3)
    if (factors.marginUsagePct > 80) riskScore += 3
    else if (factors.marginUsagePct > 60) riskScore += 2
    else if (factors.marginUsagePct > 40) riskScore += 1

    // Daily loss component (0-2)
    if (factors.dailyLossPct > 3) riskScore += 2
    else if (factors.dailyLossPct > 1.5) riskScore += 1

    // Consecutive losses component (0-2)
    if (factors.consecutiveLosses >= 5) riskScore += 2
    else if (factors.consecutiveLosses >= 3) riskScore += 1

    // Portfolio risk component (0-2)
    if (factors.portfolioRiskPct > 8) riskScore += 2
    else if (factors.portfolioRiskPct > 4) riskScore += 1

    // Volatility regime component (0-1)
    if (factors.volatilityRegime === 'HIGH_VOLATILITY') riskScore += 1

    factors.riskScore = clamp(riskScore, 0, 10)

  } catch (err) {
    logger.error('AI_ENGINE', 'Risk factor analysis failed', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  return factors
}

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
function buildSignalSources(
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
function generateReasoning(
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

// ============================================================================
// SECTION 10: CORE DECISION ENGINE
// ============================================================================

/**
 * Make a trading decision for a single symbol.
 *
 * This is the primary entry point of the AI Decision Engine. It:
 *  1. Loads decision configuration from DB
 *  2. Checks cooldown period for the symbol
 *  3. Runs all four analyzers in parallel
 *  4. Computes weighted composite score
 *  5. Applies sentiment blocking, volatility scaling, and risk filters
 *  6. Determines final decision with confidence
 *  7. Calculates suggested SL/TP levels
 *  8. Logs the decision to the database
 *
 * @param symbol - Ticker symbol to decide on
 * @param timeframe - Chart timeframe (default 'H1')
 * @returns Complete AiDecision with all factors and recommendations
 */
export async function makeDecision(
  symbol: string,
  timeframe: string = DEFAULT_TIMEFRAME,
): Promise<AiDecision> {
  const now = new Date()

  // Default decision (safe fallback)
  const defaultDecision: AiDecision = {
    symbol,
    decision: 'HOLD',
    confidence: 0,
    reasoning: 'Failed to compute decision — defaulting to HOLD.',
    technicalFactors: defaultTechnicalFactors(),
    newsFactors: defaultNewsFactors(),
    sentimentFactors: defaultSentimentFactors(),
    riskFactors: defaultRiskFactors(),
    suggestedLotSize: 0,
    suggestedSl: 0,
    suggestedTp: 0,
    strategyUsed: 'AI_COMPOSITE',
    timeframe,
    signalSources: [],
    volatilityMultiplier: 1.0,
    createdAt: now,
  }

  try {
    // --- Step 1: Load configuration ---
    let config = await getDecisionConfig()

    // --- Step 2: Check cooldown ---
    try {
      const cooldownCutoff = new Date(now.getTime() - config.cooldownSeconds * 1000)
      const lastDecision = await db.decisionLog.findFirst({
        where: {
          symbol,
          createdAt: { gte: cooldownCutoff },
        },
        orderBy: { createdAt: 'desc' },
      })

      if (lastDecision) {
        const remainingSec = Math.ceil(
          (config.cooldownSeconds * 1000 - (now.getTime() - lastDecision.createdAt.getTime())) / 1000,
        )
        logger.info('AI_ENGINE', `Decision cooldown active for ${symbol}, ${remainingSec}s remaining`, {
          symbol,
          metadata: { remainingSeconds: remainingSec, lastDecisionId: lastDecision.id },
        })

        defaultDecision.reasoning = `Cooldown active — ${remainingSec}s remaining since last decision.`
        defaultDecision.confidence = lastDecision.confidence as number
        return defaultDecision
      }
    } catch (err) {
      logger.error('AI_ENGINE', `Cooldown check failed for ${symbol}`, {
        details: err instanceof Error ? err.message : String(err),
        symbol,
      })
      // Continue with decision if cooldown check fails
    }

    // --- Step 3: Run all analyzers in parallel ---
    const [technicalFactors, newsFactors, sentimentFactors, riskFactors] = await Promise.all([
      Promise.resolve(analyzeTechnicalFactors(symbol, timeframe)),
      analyzeNewsFactors(symbol),
      analyzeSentimentFactors(symbol),
      analyzeRiskFactors(),
    ])

    // --- Step 4: Weighted composite scoring ---
    const technicalScore = technicalFactors.overallScore * config.technicalWeight
    const newsScore = newsFactors.newsImpactScore * config.newsWeight
    const sentimentScore = sentimentFactors.symbolScore * config.sentimentWeight

    // Normalize: max possible is 100 * 1.0 = 100, min is -100 * 1.0 = -100
    const compositeScore = clamp(
      Math.round(technicalScore + newsScore + sentimentScore),
      -100,
      100,
    )

    // Confidence: distance from zero mapped to 0-100, adjusted by signal agreement
    const signalAgreement = technicalFactors.signals.filter(
      s => (compositeScore > 0 && s.score > 0) || (compositeScore < 0 && s.score < 0),
    ).length
    const totalSignals = technicalFactors.signals.length || 1
    const agreementRatio = signalAgreement / totalSignals
    let confidence = Math.round(mapRange(Math.abs(compositeScore), 0, 100, 20, 90) * (0.5 + agreementRatio * 0.5))

    // --- Step 5: Sentiment filter block ---
    if (sentimentFactors.isBlocked && config.extremeSentimentBlock) {
      const blockedDecision: AiDecision = {
        symbol,
        decision: 'SKIP',
        confidence,
        reasoning: generateReasoning('SKIP', compositeScore, confidence, technicalFactors, newsFactors, sentimentFactors, riskFactors),
        technicalFactors,
        newsFactors,
        sentimentFactors,
        riskFactors,
        suggestedLotSize: 0,
        suggestedSl: 0,
        suggestedTp: 0,
        strategyUsed: 'AI_COMPOSITE',
        timeframe,
        signalSources: buildSignalSources(technicalFactors, newsFactors, sentimentFactors),
        volatilityMultiplier: 1.0,
        createdAt: now,
      }
      await logDecisionToDb(blockedDecision, riskFactors, sentimentFactors)
      return blockedDecision
    }

    // --- Step 6: Volatility scaling ---
    let volatilityMultiplier = 1.0
    if (config.volatilityScalingEnabled) {
      if (riskFactors.volatilityRegime === 'HIGH_VOLATILITY') {
        volatilityMultiplier = 0.5 // Reduce confidence by 50%
      } else if (riskFactors.volatilityRegime === 'LOW_VOLATILITY') {
        volatilityMultiplier = 0.8 // Slight reduction in low vol
      }
      confidence = Math.round(confidence * volatilityMultiplier)
    }

    // --- Step 7: Determine decision ---
    let decision: DecisionType = 'HOLD'

    if (compositeScore > BUY_THRESHOLD && confidence > config.minConfidenceBuy) {
      decision = 'BUY'
    } else if (compositeScore < SELL_THRESHOLD && confidence > config.minConfidenceSell) {
      decision = 'SELL'
    }

    // Override: too many breaking news
    if (newsFactors.breakingNewsCount > MAX_BREAKING_NEWS) {
      decision = 'SKIP'
    }

    // Override: risk too high
    if (riskFactors.riskScore > HIGH_RISK_SCORE) {
      decision = 'SKIP'
    }

    // --- Step 8: Calculate suggested SL/TP ---
    const atrEstimate = DEFAULT_ATR_PCT // 1.5% estimated ATR
    let suggestedSl = 0
    let suggestedTp = 0
    let suggestedLotSize = 0.01

    if (decision === 'BUY' || decision === 'SELL') {
      // Estimate entry price from support/resistance midpoint
      const midPrice = (technicalFactors.supportLevel + technicalFactors.resistanceLevel) / 2
      const slDistance = midPrice * atrEstimate * SL_MULTIPLIER
      const tpDistance = midPrice * atrEstimate * TP_MULTIPLIER

      if (decision === 'BUY') {
        suggestedSl = Math.round((midPrice - slDistance) * 100) / 100
        suggestedTp = Math.round((midPrice + tpDistance) * 100) / 100
      } else {
        suggestedSl = Math.round((midPrice + slDistance) * 100) / 100
        suggestedTp = Math.round((midPrice - tpDistance) * 100) / 100
      }

      // Lot size based on confidence (higher confidence → larger size)
      suggestedLotSize = Math.round(confidence / 100 * 10) / 100 // 0.01 to 0.10
      suggestedLotSize = Math.max(0.01, suggestedLotSize)
    }

    // --- Step 9: Build signal sources ---
    const signalSources = buildSignalSources(technicalFactors, newsFactors, sentimentFactors)

    // --- Step 10: Generate reasoning ---
    const reasoning = generateReasoning(
      decision, compositeScore, confidence, technicalFactors, newsFactors, sentimentFactors, riskFactors,
    )

    const aiDecision: AiDecision = {
      symbol,
      decision,
      confidence,
      reasoning,
      technicalFactors,
      newsFactors,
      sentimentFactors,
      riskFactors,
      suggestedLotSize,
      suggestedSl,
      suggestedTp,
      strategyUsed: 'AI_COMPOSITE',
      timeframe,
      signalSources,
      volatilityMultiplier,
      createdAt: now,
    }

    // --- Step 11: Log decision to database ---
    await logDecisionToDb(aiDecision, riskFactors, sentimentFactors)

    logger.info('AI_ENGINE', `AI Decision: ${decision} ${symbol} (confidence=${confidence}%, composite=${compositeScore})`, {
      symbol,
      metadata: {
        decision,
        confidence,
        compositeScore,
        technicalScore: Math.round(technicalScore),
        newsScore: Math.round(newsScore),
        sentimentScore: Math.round(sentimentScore),
        riskScore: riskFactors.riskScore,
        signalSources,
        volatilityMultiplier,
      },
    })

    return aiDecision
  } catch (err) {
    logger.error('AI_ENGINE', `Decision engine failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
      stackTrace: err instanceof Error ? err.stack : undefined,
    })
    return defaultDecision
  }
}

/**
 * Persist an AiDecision to the DecisionLog table.
 */
async function logDecisionToDb(
  decision: AiDecision,
  riskFactors: RiskFactors,
  sentimentFactors: SentimentFactors,
): Promise<void> {
  try {
    const factorsJson = toJsonString({
      technical: {
        trendDirection: decision.technicalFactors.trendDirection,
        trendStrength: decision.technicalFactors.trendStrength,
        rsiValue: decision.technicalFactors.rsiValue,
        macdSignal: decision.technicalFactors.macdSignal,
        overallScore: decision.technicalFactors.overallScore,
      },
      news: {
        impactScore: decision.newsFactors.newsImpactScore,
        articleCount: decision.newsFactors.recentNewsCount,
        breakingCount: decision.newsFactors.breakingNewsCount,
      },
      sentiment: {
        symbolScore: sentimentFactors.symbolScore,
        marketScore: sentimentFactors.marketScore,
        regime: sentimentFactors.regime,
      },
      risk: {
        riskScore: riskFactors.riskScore,
        volatilityRegime: riskFactors.volatilityRegime,
        openPositions: riskFactors.openPositions,
      },
    })

    await db.decisionLog.create({
      data: {
        symbol: decision.symbol,
        decision: decision.decision,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        factors: factorsJson,
        signalSources: toJsonString(decision.signalSources),
        riskScore: riskFactors.riskScore,
        sentimentScore: sentimentFactors.symbolScore,
        volatilityRegime: riskFactors.volatilityRegime,
        strategyUsed: decision.strategyUsed,
        timeframe: decision.timeframe,
        finalAction: decision.decision,
        overridden: false,
      },
    })
  } catch (err) {
    logger.error('AI_ENGINE', `Failed to log decision for ${decision.symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol: decision.symbol,
    })
  }
}

// ============================================================================
// SECTION 11: BATCH DECISION PROCESSING
// ============================================================================

/**
 * Make decisions for multiple symbols simultaneously.
 *
 * Processes each symbol through the decision engine, sorts results by
 * confidence (descending), and respects the maxPositionsPerDecision
 * configuration limit — only returning the top N actionable decisions.
 *
 * @param symbols - Array of ticker symbols to analyze
 * @param timeframe - Chart timeframe (default 'H1')
 * @returns Array of AiDecision sorted by confidence descending
 */
export async function makeBatchDecision(
  symbols: string[],
  timeframe: string = DEFAULT_TIMEFRAME,
): Promise<AiDecision[]> {
  try {
    const config = await getDecisionConfig()

    // Process all symbols (sequentially to avoid DB contention)
    const decisions: AiDecision[] = []
    for (const symbol of symbols) {
      try {
        const decision = await makeDecision(symbol, timeframe)
        decisions.push(decision)
      } catch (err) {
        logger.error('AI_ENGINE', `Batch decision failed for ${symbol}`, {
          details: err instanceof Error ? err.message : String(err),
          symbol,
        })
      }
    }

    // Sort by confidence descending
    decisions.sort((a, b) => b.confidence - a.confidence)

    // Count actionable decisions (BUY or SELL)
    let actionableCount = 0
    const filtered: AiDecision[] = []

    for (const decision of decisions) {
      if (decision.decision === 'BUY' || decision.decision === 'SELL') {
        if (actionableCount < config.maxPositionsPerDecision) {
          actionableCount++
          filtered.push(decision)
        } else {
          // Downgrade excess actionable decisions to HOLD
          filtered.push({
            ...decision,
            decision: 'HOLD',
            reasoning: `${decision.reasoning} [Downgraded to HOLD: max positions (${config.maxPositionsPerDecision}) reached]`,
          })
        }
      } else {
        filtered.push(decision)
      }
    }

    logger.info('AI_ENGINE', `Batch decision completed for ${symbols.length} symbols`, {
      metadata: {
        totalSymbols: symbols.length,
        actionableDecisions: actionableCount,
        maxAllowed: config.maxPositionsPerDecision,
        topDecision: filtered[0]
          ? `${filtered[0].decision} ${filtered[0].symbol} (${filtered[0].confidence}%)`
          : 'none',
      },
    })

    return filtered
  } catch (err) {
    logger.error('AI_ENGINE', 'Batch decision engine failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

// ============================================================================
// SECTION 12: DECISION ACCURACY TRACKER
// ============================================================================

/**
 * Calculate decision accuracy over a time period.
 *
 * Queries historical DecisionLog entries, matches them to Trades opened
 * within 5 minutes of each decision, and evaluates profitability.
 * Also computes confidence calibration across low/medium/high tiers.
 *
 * @param days - Number of days to look back (default 30)
 * @returns DecisionAccuracy with win rates and calibration data
 */
export async function getDecisionAccuracy(days: number = 30): Promise<DecisionAccuracy> {
  const defaultAccuracy: DecisionAccuracy = {
    totalDecisions: 0,
    correctDecisions: 0,
    winRate: 0,
    avgConfidence: 0,
    avgPnlImpact: 0,
    byDecision: {
      BUY: { count: 0, correct: 0, avgPnl: 0 },
      SELL: { count: 0, correct: 0, avgPnl: 0 },
      HOLD: { count: 0, correct: 0, avgPnl: 0 },
      SKIP: { count: 0, correct: 0, avgPnl: 0 },
      REDUCE: { count: 0, correct: 0, avgPnl: 0 },
      CLOSE_ALL: { count: 0, correct: 0, avgPnl: 0 },
    },
    confidenceCalibration: {
      low: { count: 0, winRate: 0 },
      medium: { count: 0, winRate: 0 },
      high: { count: 0, winRate: 0 },
    },
  }

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const decisions = await db.decisionLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    })

    if (decisions.length === 0) {
      return defaultAccuracy
    }

    let totalConfidence = 0
    let totalPnl = 0
    let correctCount = 0
    let evaluatedCount = 0

    // Calibration buckets
    const calLow: { wins: number; total: number } = { wins: 0, total: 0 }
    const calMed: { wins: number; total: number } = { wins: 0, total: 0 }
    const calHigh: { wins: number; total: number } = { wins: 0, total: 0 }

    for (const d of decisions) {
      const dType = d.decision as DecisionType
      const confidence = d.confidence as number

      // Update byDecision counts
      if (defaultAccuracy.byDecision[dType]) {
        defaultAccuracy.byDecision[dType].count++
      }

      totalConfidence += confidence

      // Only evaluate BUY/SELL decisions for accuracy
      if (dType !== 'BUY' && dType !== 'SELL') continue

      // Check pnlImpact if already populated
      if (d.pnlImpact !== null && d.pnlImpact !== undefined) {
        const isProfitable = d.pnlImpact > 0
        const pnlVal = d.pnlImpact as number
        totalPnl += pnlVal
        evaluatedCount++

        if (isProfitable) correctCount++

        if (defaultAccuracy.byDecision[dType]) {
          defaultAccuracy.byDecision[dType].avgPnl += pnlVal
          if (isProfitable) defaultAccuracy.byDecision[dType].correct++
        }

        // Calibration bucketing
        if (confidence < 50) {
          calLow.total++
          if (isProfitable) calLow.wins++
        } else if (confidence < 70) {
          calMed.total++
          if (isProfitable) calMed.wins++
        } else {
          calHigh.total++
          if (isProfitable) calHigh.wins++
        }

        continue
      }

      // Try to match to a trade opened within 5 minutes of the decision
      try {
        const decisionTime = d.createdAt.getTime()
        const matchWindowStart = new Date(decisionTime)
        const matchWindowEnd = new Date(decisionTime + MATCHING_WINDOW_MS)

        const matchedTrade = await db.trade.findFirst({
          where: {
            symbol: d.symbol,
            direction: dType,
            status: 'CLOSED',
            openTime: {
              gte: matchWindowStart,
              lte: matchWindowEnd,
            },
          },
        })

        if (matchedTrade) {
          const pnl = matchedTrade.pnl
          const isProfitable = pnl > 0
          totalPnl += pnl
          evaluatedCount++

          if (isProfitable) correctCount++

          if (defaultAccuracy.byDecision[dType]) {
            defaultAccuracy.byDecision[dType].avgPnl += pnl
            if (isProfitable) defaultAccuracy.byDecision[dType].correct++
          }

          // Calibration
          if (confidence < 50) {
            calLow.total++
            if (isProfitable) calLow.wins++
          } else if (confidence < 70) {
            calMed.total++
            if (isProfitable) calMed.wins++
          } else {
            calHigh.total++
            if (isProfitable) calHigh.wins++
          }

          // Backfill pnlImpact on the decision log
          try {
            await db.decisionLog.update({
              where: { id: d.id },
              data: { pnlImpact: pnl },
            })
          } catch {
            // Non-critical
          }
        }
      } catch {
        // Trade matching failed for this decision, skip
      }
    }

    // Compute averages
    defaultAccuracy.totalDecisions = decisions.length
    defaultAccuracy.correctDecisions = correctCount
    defaultAccuracy.winRate = evaluatedCount > 0
      ? Math.round((correctCount / evaluatedCount) * 100) / 100
      : 0
    defaultAccuracy.avgConfidence = Math.round(totalConfidence / decisions.length)
    defaultAccuracy.avgPnlImpact = evaluatedCount > 0
      ? Math.round((totalPnl / evaluatedCount) * 100) / 100
      : 0

    // Per-decision-type avg PnL
    for (const dType of Object.keys(defaultAccuracy.byDecision) as DecisionType[]) {
      const stats = defaultAccuracy.byDecision[dType]
      if (stats.count > 0) {
        stats.avgPnl = Math.round((stats.avgPnl / stats.count) * 100) / 100
      }
    }

    // Calibration
    defaultAccuracy.confidenceCalibration = {
      low: {
        count: calLow.total,
        winRate: calLow.total > 0
          ? Math.round((calLow.wins / calLow.total) * 100) / 100
          : 0,
      },
      medium: {
        count: calMed.total,
        winRate: calMed.total > 0
          ? Math.round((calMed.wins / calMed.total) * 100) / 100
          : 0,
      },
      high: {
        count: calHigh.total,
        winRate: calHigh.total > 0
          ? Math.round((calHigh.wins / calHigh.total) * 100) / 100
          : 0,
      },
    }

    logger.info('AI_ENGINE', `Decision accuracy computed: ${defaultAccuracy.winRate}% win rate over ${days} days`, {
      metadata: {
        days,
        totalDecisions: defaultAccuracy.totalDecisions,
        evaluatedDecisions: evaluatedCount,
        winRate: defaultAccuracy.winRate,
        avgConfidence: defaultAccuracy.avgConfidence,
        avgPnl: defaultAccuracy.avgPnlImpact,
      },
    })

    return defaultAccuracy
  } catch (err) {
    logger.error('AI_ENGINE', 'Decision accuracy calculation failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return defaultAccuracy
  }
}

// ============================================================================
// SECTION 13: DECISION HISTORY
// ============================================================================

/**
 * Retrieve decision history from the database.
 *
 * @param symbol - Optional symbol filter
 * @param limit - Maximum number of records (default 50)
 * @returns Array of DecisionLog records ordered by createdAt descending
 */
export async function getDecisionHistory(
  symbol?: string,
  limit: number = 50,
) {
  try {
    return await db.decisionLog.findMany({
      where: symbol ? { symbol } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to fetch decision history', {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
    return []
  }
}

// ============================================================================
// SECTION 14: OVERRIDE SYSTEM
// ============================================================================

/**
 * Override a previously logged decision.
 *
 * Marks the decision as overridden, records the new decision and reason,
 * and logs the override event for audit purposes.
 *
 * @param decisionId - ID of the DecisionLog to override
 * @param newDecision - The replacement decision type
 * @param reason - Human-readable explanation for the override
 */
export async function overrideDecision(
  decisionId: string,
  newDecision: DecisionType,
  reason: string,
): Promise<void> {
  try {
    const existing = await db.decisionLog.findUnique({
      where: { id: decisionId },
    })

    if (!existing) {
      logger.error('AI_ENGINE', `Cannot override: decision ${decisionId} not found`, {
        metadata: { decisionId, newDecision, reason },
      })
      return
    }

    await db.decisionLog.update({
      where: { id: decisionId },
      data: {
        overridden: true,
        overrideReason: reason,
        finalAction: newDecision,
      },
    })

    logger.info('AI_ENGINE', `Decision overridden: ${existing.decision} → ${newDecision} for ${existing.symbol}`, {
      symbol: existing.symbol,
      tradeId: decisionId,
      metadata: {
        originalDecision: existing.decision,
        newDecision,
        reason,
        originalConfidence: existing.confidence,
      },
    })
  } catch (err) {
    logger.error('AI_ENGINE', `Failed to override decision ${decisionId}`, {
      details: err instanceof Error ? err.message : String(err),
      tradeId: decisionId,
    })
  }
}

// ============================================================================
// SECTION 15: CONFIGURATION MANAGEMENT
// ============================================================================

/**
 * Retrieve the AI decision configuration from the database.
 * Falls back to default values if no config exists.
 *
 * @returns AiDecisionConfig record
 */
export async function getDecisionConfig() {
  try {
    const config = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (config) {
      return config
    }

    // Seed default config if none exists
    return await seedDecisionConfig()
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to load decision config, using defaults', {
      details: err instanceof Error ? err.message : String(err),
    })
    // Return a synthetic default config object
    return {
      id: '',
      name: 'default',
      minConfidenceBuy: 65,
      minConfidenceSell: 65,
      sentimentWeight: 0.25,
      technicalWeight: 0.50,
      newsWeight: 0.25,
      maxPositionsPerDecision: 3,
      cooldownSeconds: 300,
      extremeSentimentBlock: true,
      volatilityScalingEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
}

/**
 * Update the AI decision configuration.
 *
 * Merges the provided updates with the existing config. Creates a default
 * config first if none exists.
 *
 * @param updates - Partial config fields to update
 * @returns Updated AiDecisionConfig record
 */
export async function updateDecisionConfig(
  updates: Partial<{
    minConfidenceBuy: number
    minConfidenceSell: number
    sentimentWeight: number
    technicalWeight: number
    newsWeight: number
    maxPositionsPerDecision: number
    cooldownSeconds: number
    extremeSentimentBlock: boolean
    volatilityScalingEnabled: boolean
  }>,
) {
  try {
    // Ensure config exists
    const existing = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (!existing) {
      await seedDecisionConfig()
    }

    // Validate weight sum doesn't exceed 1.0
    const current = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (!current) {
      logger.error('AI_ENGINE', 'Failed to find config after seeding')
      return await getDecisionConfig()
    }

    let newSentimentW = updates.sentimentWeight ?? (current.sentimentWeight as number)
    let newTechnicalW = updates.technicalWeight ?? (current.technicalWeight as number)
    let newNewsW = updates.newsWeight ?? (current.newsWeight as number)

    // Auto-normalize if sum > 1.0
    const weightSum = newSentimentW + newTechnicalW + newNewsW
    if (weightSum > 1.0) {
      const scale = 1.0 / weightSum
      newSentimentW = Math.round(newSentimentW * scale * 100) / 100
      newTechnicalW = Math.round(newTechnicalW * scale * 100) / 100
      newNewsW = Math.round(newNewsW * scale * 100) / 100

      logger.info('AI_ENGINE', 'Weights auto-normalized to sum to 1.0', {
        metadata: {
          originalSum: weightSum,
          normalized: { sentiment: newSentimentW, technical: newTechnicalW, news: newNewsW },
        },
      })
    }

    const updated = await db.aiDecisionConfig.update({
      where: { id: current.id },
      data: {
        ...updates,
        sentimentWeight: newSentimentW,
        technicalWeight: newTechnicalW,
        newsWeight: newNewsW,
      },
    })

    logger.info('AI_ENGINE', 'Decision config updated', {
      metadata: { updates: Object.keys(updates), newValues: updates },
    })

    return updated
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to update decision config', {
      details: err instanceof Error ? err.message : String(err),
    })
    return await getDecisionConfig()
  }
}

/**
 * Seed the default AI decision configuration if it doesn't exist.
 *
 * Uses upsert to ensure idempotency — safe to call multiple times.
 *
 * @returns The created or existing AiDecisionConfig record
 */
export async function seedDecisionConfig() {
  try {
    const existing = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (existing) {
      return existing
    }

    const config = await db.aiDecisionConfig.create({
      data: {
        name: 'default',
        minConfidenceBuy: 65,
        minConfidenceSell: 65,
        sentimentWeight: 0.25,
        technicalWeight: 0.50,
        newsWeight: 0.25,
        maxPositionsPerDecision: 3,
        cooldownSeconds: 300,
        extremeSentimentBlock: true,
        volatilityScalingEnabled: true,
      },
    })

    logger.info('AI_ENGINE', 'Default decision config seeded', {
      metadata: {
        id: config.id,
        minConfidenceBuy: config.minConfidenceBuy,
        minConfidenceSell: config.minConfidenceSell,
        weights: {
          technical: config.technicalWeight,
          news: config.newsWeight,
          sentiment: config.sentimentWeight,
        },
      },
    })

    return config
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to seed decision config', {
      details: err instanceof Error ? err.message : String(err),
    })
    // Return synthetic default
    return {
      id: '',
      name: 'default',
      minConfidenceBuy: 65,
      minConfidenceSell: 65,
      sentimentWeight: 0.25,
      technicalWeight: 0.50,
      newsWeight: 0.25,
      maxPositionsPerDecision: 3,
      cooldownSeconds: 300,
      extremeSentimentBlock: true,
      volatilityScalingEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
}
