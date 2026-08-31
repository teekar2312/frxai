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
  getSentimentTrend,
  scoreArticle,
} from './sentiment-filter'
import type { SentimentFilterResult, SentimentTrend } from './sentiment-filter'
// Fix #17: Integrate with indicator-pool for real technical data
// Fix 1 (Task 7): Added missing OHLCVBar type import
import { fetchCandles, calculateRSI, calculateMACD, calculateBollingerBands, calculateADX, calculateATR, calculateStochastic, type OHLCVBar } from './indicator-pool'

// ============================================================================
// SECTION 1: TYPES & INTERFACES
// ============================================================================

/** Market condition labels used for self-learning classification */
type MarketCondition = 'TRENDING' | 'RANGE_BOUND' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'NORMAL'

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
  /** Fix 3 (Task 7): Real ATR value from indicator-pool, used for SL/TP calculation */
  atrValue: number | null
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
// Breaking news cache (shared across symbols within the same minute)
let breakingNewsCache: { items: Awaited<ReturnType<typeof detectBreakingNews>>; cachedAt: number } | null = null
const BREAKING_NEWS_CACHE_TTL_MS = 60_000 // 1 minute
const MATCHING_WINDOW_MS = 5 * 60 * 1000 // 5 minutes to match decision to trade
const ESTIMATED_ACCOUNT_VALUE = 100_000_000 // 100M IDR estimate
const RISK_PER_TRADE_PCT = 0.01 // 1% risk per trade

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
    atrValue: null, // Fix 3 (Task 7): default to null
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
 * Analyze technical factors for a symbol.
 *
 * Fix #17: Now attempts to use real candle data via indicator-pool.
 * Falls back to deterministic mock data when no candles are available.
 * This makes decisions meaningful when real data exists.
 */
export async function analyzeTechnicalFactorsAsync(
  symbol: string,
  timeframe: string = DEFAULT_TIMEFRAME,
): Promise<TechnicalFactors> {
  try {
    const bars = await fetchCandles(symbol, timeframe, 200)
    if (bars.length >= 50) {
      return analyzeTechnicalFromBars(symbol, bars, timeframe)
    }
  } catch (err) {
    logger.info('AI_ENGINE', `No candle data for ${symbol}, using mock technical analysis`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
  }
  // Fallback to mock
  return analyzeTechnicalFactorsMock(symbol, timeframe)
}

/**
 * Analyze technical factors from real OHLCV bars using indicator-pool.
 */
function analyzeTechnicalFromBars(symbol: string, bars: OHLCVBar[], timeframe: string): TechnicalFactors {
  const factors = defaultTechnicalFactors()
  const signals: IndicatorSignal[] = []
  const closes = bars.map(b => b.close)

  // --- RSI ---
  const rsi = calculateRSI(closes, 14)
  factors.rsiValue = rsi ?? 50
  factors.rsiSignal = factors.rsiValue >= 70 ? 'OVERBOUGHT' : factors.rsiValue <= 30 ? 'OVERSOLD' : 'NEUTRAL'
  const rsiScore = factors.rsiSignal === 'OVERSOLD'
    ? mapRange(factors.rsiValue, 0, 30, 80, 20)
    : factors.rsiSignal === 'OVERBOUGHT'
      ? mapRange(factors.rsiValue, 70, 100, -20, -80)
      : mapRange(factors.rsiValue, 30, 70, -10, 10)
  signals.push({ name: 'RSI', signal: factors.rsiSignal, weight: 15, score: Math.round(rsiScore) })

  // --- MACD ---
  const macd = calculateMACD(closes)
  if (macd) {
    factors.macdHistogram = Math.round((macd.histogram ?? 0) * 100) / 100
    factors.macdSignal = (macd.histogram ?? 0) > 0 ? 'BULLISH' : (macd.histogram ?? 0) < 0 ? 'BEARISH' : 'NEUTRAL'
    const macdScore = mapRange(factors.macdHistogram, -1, 1, -100, 100)
    signals.push({ name: 'MACD', signal: factors.macdSignal, weight: 20, score: Math.round(macdScore) })
  }

  // --- Bollinger Bands ---
  const boll = calculateBollingerBands(closes, 20, 2)
  if (boll && closes.length > 0) {
    const lastClose = closes[closes.length - 1]
    const upperB = boll.upper ?? lastClose * 1.05
    const lowerB = boll.lower ?? lastClose * 0.95
    const midB = boll.middle ?? lastClose
    const bollRange = upperB - lowerB
    if (bollRange > 0) {
      const pos = (lastClose - lowerB) / bollRange
      if (pos > 0.85) factors.bollingerPosition = 'ABOVE_UPPER'
      else if (pos > 0.7) factors.bollingerPosition = 'NEAR_UPPER'
      else if (pos < 0.15) factors.bollingerPosition = 'BELOW_LOWER'
      else if (pos < 0.3) factors.bollingerPosition = 'NEAR_LOWER'
      else factors.bollingerPosition = 'MIDDLE'
    }
    const bollScore = factors.bollingerPosition === 'BELOW_LOWER' ? 60
      : factors.bollingerPosition === 'ABOVE_UPPER' ? -60
      : factors.bollingerPosition === 'NEAR_LOWER' ? 30
      : factors.bollingerPosition === 'NEAR_UPPER' ? -30
      : 0
    signals.push({ name: 'BOLLINGER', signal: factors.bollingerPosition, weight: 15, score: bollScore })
    factors.supportLevel = Math.round(lowerB * 100) / 100
    factors.resistanceLevel = Math.round(upperB * 100) / 100
  }

  // --- ADX ---
  const adx = calculateADX(bars, 14)
  if (adx) {
    factors.adxValue = Math.round(adx.adx)
  }

  // --- ATR ---
  // Fix 3 (Task 7): Store real ATR value for SL/TP calculation
  const atr = calculateATR(bars, 14)
  if (atr !== null) {
    factors.atrValue = atr
  }

  // --- Stochastic ---
  const stoch = calculateStochastic(bars, 14, 3)
  if (stoch) {
    factors.stochasticSignal = (stoch.k ?? 50) > 80 ? 'OVERBOUGHT' : (stoch.k ?? 50) < 20 ? 'OVERSOLD' : 'NEUTRAL'
  }

  // --- Trend Direction from EMA crossover ---
  if (closes.length >= 50) {
    const ema20 = closes.slice(-20).reduce((s, c) => s + c, 0) / Math.min(20, closes.length)
    const ema50 = closes.slice(-50).reduce((s, c) => s + c, 0) / Math.min(50, closes.length)
    if (ema20 > ema50 * 1.002) {
      factors.trendDirection = 'UP'
      factors.trendStrength = Math.min(100, Math.round(((ema20 / ema50) - 1) * 10000))
    } else if (ema20 < ema50 * 0.998) {
      factors.trendDirection = 'DOWN'
      factors.trendStrength = Math.min(100, Math.round(((ema50 / ema20) - 1) * 10000))
    } else {
      factors.trendDirection = 'SIDEWAYS'
      factors.trendStrength = Math.round(Math.abs(ema20 / ema50 - 1) * 1000)
    }
  }
  const trendScore = factors.trendDirection === 'UP'
    ? mapRange(factors.trendStrength, 0, 100, 20, 100)
    : factors.trendDirection === 'DOWN'
      ? mapRange(factors.trendStrength, 0, 100, -100, -20)
      : mapRange(factors.trendStrength, 0, 100, -15, 15)
  signals.unshift({ name: 'TREND', signal: factors.trendDirection, weight: 30, score: Math.round(trendScore) })

  // --- Volume Trend ---
  if (bars.length >= 20) {
    const recentVol = bars.slice(-5).reduce((s, b) => s + b.volume, 0) / 5
    const olderVol = bars.slice(-20, -5).reduce((s, b) => s + b.volume, 0) / 15
    if (recentVol > olderVol * 1.2) factors.volumeTrend = 'INCREASING'
    else if (recentVol < olderVol * 0.8) factors.volumeTrend = 'DECREASING'
  }
  const volScore = factors.volumeTrend === 'INCREASING' ? 30 : factors.volumeTrend === 'DECREASING' ? -20 : 0
  signals.push({ name: 'VOLUME', signal: factors.volumeTrend, weight: 10, score: volScore })

  // --- Compute overallScore ---
  let totalWeight = 0
  let weightedSum = 0
  for (const sig of signals) { weightedSum += sig.score * sig.weight; totalWeight += sig.weight }
  factors.overallScore = totalWeight > 0 ? Math.round(clamp(weightedSum / totalWeight, -100, 100)) : 0
  factors.signals = signals
  return factors
}

/**
 * Analyze technical factors using deterministic mock data (fallback).
 * @deprecated Use analyzeTechnicalFactorsAsync for real data.
 */
function analyzeTechnicalFactorsMock(symbol: string, timeframe: string = DEFAULT_TIMEFRAME): TechnicalFactors {
  try {
    const factors = defaultTechnicalFactors()
    const signals: IndicatorSignal[] = []
    const trendRaw = seededRandom(symbol, 0)
    factors.trendDirection = trendRaw > 0.6 ? 'UP' : trendRaw < 0.4 ? 'DOWN' : 'SIDEWAYS'
    factors.trendStrength = Math.round(seededRandom(symbol, 1) * 80 + 20)
    const trendScore = factors.trendDirection === 'UP'
      ? mapRange(factors.trendStrength, 0, 100, 20, 100)
      : factors.trendDirection === 'DOWN'
        ? mapRange(factors.trendStrength, 0, 100, -100, -20)
        : mapRange(factors.trendStrength, 0, 100, -15, 15)
    signals.push({ name: 'TREND', signal: factors.trendDirection, weight: 30, score: Math.round(trendScore) })
    const rsiRaw = seededRandom(symbol, 2)
    factors.rsiValue = Math.round(rsiRaw * 60 + 20)
    factors.rsiSignal = factors.rsiValue >= 70 ? 'OVERBOUGHT' : factors.rsiValue <= 30 ? 'OVERSOLD' : 'NEUTRAL'
    const rsiScore = factors.rsiSignal === 'OVERSOLD' ? mapRange(factors.rsiValue, 0, 30, 80, 20) : factors.rsiSignal === 'OVERBOUGHT' ? mapRange(factors.rsiValue, 70, 100, -20, -80) : mapRange(factors.rsiValue, 30, 70, -10, 10)
    signals.push({ name: 'RSI', signal: factors.rsiSignal, weight: 15, score: Math.round(rsiScore) })
    const macdRaw = seededRandom(symbol, 3)
    factors.macdHistogram = Math.round((macdRaw - 0.5) * 200) / 100
    factors.macdSignal = factors.macdHistogram > 0.1 ? 'BULLISH' : factors.macdHistogram < -0.1 ? 'BEARISH' : 'NEUTRAL'
    const macdScore = mapRange(factors.macdHistogram, -1, 1, -100, 100)
    signals.push({ name: 'MACD', signal: factors.macdSignal, weight: 20, score: Math.round(macdScore) })
    const bollRaw = seededRandom(symbol, 4)
    factors.bollingerPosition = bollRaw > 0.85 ? 'ABOVE_UPPER' : bollRaw > 0.7 ? 'NEAR_UPPER' : bollRaw < 0.15 ? 'BELOW_LOWER' : bollRaw < 0.3 ? 'NEAR_LOWER' : 'MIDDLE'
    const bollScore = factors.bollingerPosition === 'BELOW_LOWER' ? mapRange(bollRaw, 0, 0.15, 80, 40) : factors.bollingerPosition === 'ABOVE_UPPER' ? mapRange(bollRaw, 0.85, 1, -40, -80) : factors.bollingerPosition === 'NEAR_LOWER' ? mapRange(bollRaw, 0.15, 0.3, 40, 10) : factors.bollingerPosition === 'NEAR_UPPER' ? mapRange(bollRaw, 0.7, 0.85, -10, -40) : 0
    signals.push({ name: 'BOLLINGER', signal: factors.bollingerPosition, weight: 15, score: Math.round(bollScore) })
    factors.adxValue = Math.round(seededRandom(symbol, 5) * 60 + 10)
    signals.push({ name: 'ADX', signal: factors.adxValue > 25 ? 'TRENDING' : 'RANGING', weight: 10, score: 0 })
    const volRaw = seededRandom(symbol, 6)
    factors.volumeTrend = volRaw > 0.65 ? 'INCREASING' : volRaw < 0.35 ? 'DECREASING' : 'NORMAL'
    signals.push({ name: 'VOLUME', signal: factors.volumeTrend, weight: 10, score: 0 })
    const stochRaw = seededRandom(symbol, 7)
    factors.stochasticSignal = stochRaw > 0.8 ? 'OVERBOUGHT' : stochRaw < 0.2 ? 'OVERSOLD' : 'NEUTRAL'
    const basePrice = 1000 + seededRandom(symbol, 8) * 9000
    const spread = basePrice * 0.03
    factors.supportLevel = Math.round((basePrice - spread) * 100) / 100
    factors.resistanceLevel = Math.round((basePrice + spread) * 100) / 100
    let totalWeight = 0
    let weightedSum = 0
    for (const sig of signals) { weightedSum += sig.score * sig.weight; totalWeight += sig.weight }
    factors.overallScore = totalWeight > 0 ? Math.round(clamp(weightedSum / totalWeight, -100, 100)) : 0
    factors.signals = signals
    return factors
  } catch (err) {
    logger.error('AI_ENGINE', `Mock technical analysis failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err), symbol,
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
 * Fix #14/#18: Now reuses sentiment-filter's scoreArticle() instead of
 * maintaining a separate hardcoded keyword list. This ensures consistency
 * between news scoring and sentiment analysis.
 */
export async function analyzeNewsFactors(symbol: string): Promise<NewsFactors> {
  try {
    const result = await fetchNews({ symbols: [symbol], maxArticles: 20, forceRefresh: false })
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

    // Fix #20: Get base equity from account data or risk config
    let baseEquity = 100_000_000
    try {
      const dailyPerf = await db.dailyPerformance.findFirst({ where: { date: new Date().toISOString().slice(0, 10) } })
      if (dailyPerf) {
        baseEquity = Math.max(dailyPerf.startBalance, 100_000_000)
      }
    } catch {
    // Use default estimate
  }

    // Fix: Compute margin usage percentage
    factors.marginUsagePct = baseEquity > 0
      ? Math.round((totalMargin / baseEquity) * 100)
      : 0

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
 * @param precomputedRiskFactors - Optional pre-computed risk factors (Fix 5: for batch optimization)
 * @param useAdaptiveLearning - When true, uses adaptive weights + confidence calibration (request-scoped)
 * @returns Complete AiDecision with all factors and recommendations
 */
export async function makeDecision(
  symbol: string,
  timeframe: string = DEFAULT_TIMEFRAME,
  precomputedRiskFactors?: RiskFactors,
  useAdaptiveLearning?: boolean,
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
    // Fix #17: Use async technical analysis (real data from indicator-pool)
    // Fix 5 (Task 7): Use pre-computed risk factors if provided (batch optimization)
    const [technicalFactors, newsFactors, sentimentFactors, riskFactors] = await Promise.all([
      analyzeTechnicalFactorsAsync(symbol, timeframe),
      analyzeNewsFactors(symbol),
      analyzeSentimentFactors(symbol),
      precomputedRiskFactors ?? analyzeRiskFactors(),
    ])

    // Fix #22: Check market hours before making decisions
    try {
      const { getTradingPhase } = await import('./mt5-connection')
      const phase = getTradingPhase()
      if (phase === 'CLOSED') {
        const closedDecision: AiDecision = {
          symbol,
          decision: 'HOLD',
          confidence: 0,
          reasoning: `Market is currently CLOSED (phase: ${phase}). No decisions made outside trading hours.`,
          technicalFactors: defaultTechnicalFactors(),
          newsFactors,
          sentimentFactors,
          riskFactors,
          suggestedLotSize: 0,
          suggestedSl: 0,
          suggestedTp: 0,
          strategyUsed: 'AI_COMPOSITE',
          timeframe,
          signalSources: [],
          volatilityMultiplier: 1.0,
          createdAt: now,
        }
        return closedDecision
      }
    } catch {
      // If phase check fails, continue with decision
    }

    // --- Step 4: Weighted composite scoring ---
    // Self-learning: use adaptive weights if enabled and sufficient data exists
    let effectiveTechWeight = config.technicalWeight
    let effectiveNewsWeight = config.newsWeight
    let effectiveSentWeight = config.sentimentWeight
    let learningState: SelfLearningState | null = null

    if (useAdaptiveLearning) {
      try {
        const mc = classifyMarketCondition(technicalFactors, riskFactors.volatilityRegime)
        const adaptiveW = await getAdaptiveWeights(mc, config)
        effectiveTechWeight = adaptiveW.technical
        effectiveNewsWeight = adaptiveW.news
        effectiveSentWeight = adaptiveW.sentiment
        learningState = await loadSelfLearningState()
      } catch (err) {
        logger.error('AI_ENGINE', `Adaptive weights failed for ${symbol}, using base weights`, {
          details: err instanceof Error ? err.message : String(err),
          symbol,
        })
      }
    }

    const technicalScore = technicalFactors.overallScore * (effectiveTechWeight as number)
    const newsScore = newsFactors.newsImpactScore * (effectiveNewsWeight as number)
    const sentimentScore = sentimentFactors.symbolScore * (effectiveSentWeight as number)

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

    // Fix #24 / Fix 2 (Task 7): Adjust confidence based on sentiment trend direction
    // Sentiment should SUPPORT the signal direction, not contradict it
    const sentTrendDir = (sentimentFactors as Record<string, unknown>).trendDirection as string | undefined
    if (sentTrendDir === 'DECLINING' && compositeScore > 0) {
      // Declining sentiment contradicts bullish signal → reduce confidence
      confidence = Math.max(20, Math.round(confidence * 0.85))
    } else if (sentTrendDir === 'IMPROVING' && compositeScore > 0) {
      // Improving sentiment supports bullish signal → boost confidence
      confidence = Math.min(95, Math.round(confidence * 1.1))
    } else if (sentTrendDir === 'IMPROVING' && compositeScore < 0) {
      // Improving sentiment contradicts bearish signal → reduce confidence
      confidence = Math.max(20, Math.round(confidence * 0.85))
    } else if (sentTrendDir === 'DECLINING' && compositeScore < 0) {
      // Declining sentiment supports bearish signal → boost confidence
      confidence = Math.min(95, Math.round(confidence * 1.1))
    }

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

    // Fix 4 (Task 7): Override for extreme/elevated risk → REDUCE or CLOSE_ALL
    // Override: extreme risk → CLOSE_ALL if there are open positions
    if (riskFactors.riskScore >= 9 && riskFactors.openPositions > 0) {
      decision = 'CLOSE_ALL'
    }
    // Override: elevated risk with open positions → REDUCE
    else if (riskFactors.riskScore >= 7 && riskFactors.openPositions > 2) {
      decision = 'REDUCE'
    }
    // Override: consecutive losses → REDUCE position sizing
    else if (riskFactors.consecutiveLosses >= 4 && (decision === 'BUY' || decision === 'SELL')) {
      decision = 'REDUCE'
    }

    // --- Step 8: Calculate suggested SL/TP ---
    // Fix 3 (Task 7): Use real ATR if available, otherwise fall back to estimate
    const midPrice = (technicalFactors.supportLevel + technicalFactors.resistanceLevel) / 2
    const realAtr = technicalFactors.atrValue
    const atrPct = realAtr && realAtr > 0
      ? realAtr / (midPrice || 1)
      : DEFAULT_ATR_PCT

    let suggestedSl = 0
    let suggestedTp = 0
    let suggestedLotSize = 0.01

    if (decision === 'BUY' || decision === 'SELL') {
      const slDistance = midPrice * atrPct * SL_MULTIPLIER
      const tpDistance = midPrice * atrPct * TP_MULTIPLIER

      if (decision === 'BUY') {
        suggestedSl = Math.round((midPrice - slDistance) * 100) / 100
        suggestedTp = Math.round((midPrice + tpDistance) * 100) / 100
      } else {
        suggestedSl = Math.round((midPrice + slDistance) * 100) / 100
        suggestedTp = Math.round((midPrice - tpDistance) * 100) / 100
      }

      // Fix 6 (Task 7): Risk-based lot sizing: risk 1% of estimated account on this trade
      const riskAmount = ESTIMATED_ACCOUNT_VALUE * RISK_PER_TRADE_PCT

      if (suggestedSl > 0 && midPrice > 0) {
        const slDistanceVal = Math.abs(midPrice - suggestedSl)
        const slPct = slDistanceVal / midPrice
        if (slPct > 0) {
          // lotSize = riskAmount / (slDistance * 100)
          const rawLotSize = riskAmount / (slDistanceVal * 100)
          // Scale by confidence (0.5x to 1.0x)
          const confidenceScale = 0.5 + (confidence / 100) * 0.5
          suggestedLotSize = Math.round(rawLotSize * confidenceScale * 100) / 100
        }
      }
      // Clamp to reasonable range
      suggestedLotSize = clamp(suggestedLotSize, 0.01, 5.0)
    }

    // --- Step 9: Build signal sources ---
    const signalSources = buildSignalSources(technicalFactors, newsFactors, sentimentFactors)

    // --- Step 10: Generate reasoning ---
    const reasoning = generateReasoning(
      decision, compositeScore, confidence, technicalFactors, newsFactors, sentimentFactors, riskFactors,
    )

    // --- Step 10.5: Confidence calibration (self-learning) ---
    // Apply calibration feedback if adaptive learning is enabled and data exists
    if (useAdaptiveLearning && learningState) {
      confidence = calibrateConfidence(confidence, learningState)
    }

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
        adaptiveLearning: useAdaptiveLearning ?? false,
        effectiveWeights: useAdaptiveLearning
          ? { technical: effectiveTechWeight, news: effectiveNewsWeight, sentiment: effectiveSentWeight }
          : undefined,
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
 * Fix 5 (Task 7): Risk factors are computed ONCE and shared across all symbols,
 * since risk factors are portfolio-level (same for all symbols).
 *
 * @param symbols - Array of ticker symbols to analyze
 * @param timeframe - Chart timeframe (default 'H1')
 * @param useAdaptiveLearning - When true, uses adaptive weights + calibration for each decision
 * @returns Array of AiDecision sorted by confidence descending
 */
export async function makeBatchDecision(
  symbols: string[],
  timeframe: string = DEFAULT_TIMEFRAME,
  useAdaptiveLearning?: boolean,
): Promise<AiDecision[]> {
  try {
    const config = await getDecisionConfig()

    // Fix 5 (Task 7): Compute shared risk factors ONCE for the entire batch
    const sharedRiskFactors = await analyzeRiskFactors()

    // Process all symbols (sequentially to avoid DB contention)
    const decisions: AiDecision[] = []
    for (const symbol of symbols) {
      try {
        const decision = await makeDecision(symbol, timeframe, sharedRiskFactors, useAdaptiveLearning)
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
      where: {
        createdAt: { gte: since },
        id: { not: '__self_learning_state__' }, // Exclude system records
      },
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

    // Fix N+1: Batch-load all closed trades in the time window first,
    // then match in-memory instead of per-decision DB queries.
    const tradeWindowStart = new Date(since.getTime() - MATCHING_WINDOW_MS)
    let allClosedTrades: Array<{
      symbol: string; direction: string; pnl: number; openTime: Date; id: string
    }> = []
    try {
      allClosedTrades = await db.trade.findMany({
        where: {
          status: 'CLOSED',
          openTime: { gte: tradeWindowStart },
        },
        select: {
          symbol: true,
          direction: true,
          pnl: true,
          openTime: true,
          id: true,
        },
      })
    } catch {
      // Trade batch load failed, continue without matching
    }

    // Collect decision IDs that need pnlImpact backfill (to batch later)
    const backfillMap = new Map<string, number>() // decisionId -> pnl

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

      // Match to a trade in-memory from the pre-loaded batch
      const decisionTime = d.createdAt.getTime()
      const matchWindowStart = decisionTime
      const matchWindowEnd = decisionTime + MATCHING_WINDOW_MS

      const matchedTrade = allClosedTrades.find(
        t => t.symbol === d.symbol
          && t.direction === dType
          && t.openTime.getTime() >= matchWindowStart
          && t.openTime.getTime() <= matchWindowEnd,
      )

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

        // Queue pnlImpact backfill
        backfillMap.set(d.id, pnl)
      }
    }

    // Batch backfill pnlImpact on matched decisions
    if (backfillMap.size > 0) {
      try {
        await Promise.all(
          Array.from(backfillMap.entries()).map(([id, pnl]) =>
            db.decisionLog.update({ where: { id }, data: { pnlImpact: pnl } }),
          ),
        )
      } catch {
        // Non-critical
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
  // Safety cap
  const safeLimit = Math.min(Math.max(limit, 1), 500)
  try {
    return await db.decisionLog.findMany({
      where: symbol ? { symbol } : undefined,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
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

    // Ensure normalized weights sum to exactly 1.0
    const normalizedSum = newSentimentW + newTechnicalW + newNewsW
    if (Math.abs(normalizedSum - 1.0) > 0.001) {
      // Adjust the largest weight to make the sum exactly 1.0
      const diff = 1.0 - normalizedSum
      if (newTechnicalW >= newSentimentW && newTechnicalW >= newNewsW) {
        newTechnicalW = Math.round((newTechnicalW + diff) * 100) / 100
      } else if (newSentimentW >= newNewsW) {
        newSentimentW = Math.round((newSentimentW + diff) * 100) / 100
      } else {
        newNewsW = Math.round((newNewsW + diff) * 100) / 100
      }
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

// ============================================================================
// SECTION 16: SELF-LEARNING MODULE
// ============================================================================

/** Half-life for exponential time-decay weighting (168 hours = 1 week) */
const DECAY_HALF_LIFE_HOURS = 168

/** EMA smoothing alpha for adaptive multipliers (0.7 = 70% old, 30% new) */
const ADAPTIVE_SMOOTHING_ALPHA = 0.7

/** Minimum decisions required before computing adaptive multipliers */
const MIN_DECISIONS_FOR_ADAPTIVE = 30

/** Minimum decisions per market condition before computing weight hints */
const MIN_DECISIONS_PER_MC = 15

/** Per-strategy performance entry for self-learning */
export interface StrategyPerformanceEntry {
  strategy: string
  totalTrades: number
  winRate: number
  avgPnl: number
  bestMarketCondition: string
  worstMarketCondition: string
}

/** Confidence calibration bucket */
export interface CalibrationBucket {
  rangeStart: number
  rangeEnd: number
  count: number
  winRate: number
  calibrationFactor: number
}

/** Per-market-condition weight adjustment hints */
export interface MarketConditionWeightHint {
  technicalBoost: number
  newsBoost: number
  sentimentBoost: number
}

/** Complete self-learning state persisted in DB */
export interface SelfLearningState {
  /** Per-strategy win rates: strategy -> {wins, total, pnlSum} */
  strategyStats: Record<string, { wins: number; total: number; pnlSum: number }>
  /** Per (strategy, marketCondition) stats */
  strategyMarketStats: Record<string, { wins: number; total: number; pnlSum: number }>
  /** Confidence calibration: 10-point buckets from 0-100 (last bucket 90+ with rangeEnd=101) */
  calibrationBuckets: CalibrationBucket[]
  /** Per-market-condition weight hints */
  marketConditionWeights: Partial<Record<string, MarketConditionWeightHint>>
  /** Adaptive multipliers applied on top of base weights */
  adaptiveMultipliers: {
    technical: number
    news: number
    sentiment: number
  }
  /** Timestamp of last feedback loop run */
  lastUpdated: string
  /** Total decisions analyzed */
  totalAnalyzed: number
}

/** In-memory cache for self-learning state */
let selfLearningCache: {
  state: SelfLearningState | null
  loadedAt: number
} | null = null
const SELF_LEARNING_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Default empty self-learning state */
function getDefaultSelfLearningState(): SelfLearningState {
  const buckets: CalibrationBucket[] = []
  for (let i = 0; i < 100; i += 10) {
    // Last bucket uses rangeEnd=101 so that confidence=100 is included (100 < 101)
    const rangeEnd = i === 90 ? 101 : i + 10
    buckets.push({ rangeStart: i, rangeEnd, count: 0, winRate: 0, calibrationFactor: 1.0 })
  }
  return {
    strategyStats: {},
    strategyMarketStats: {},
    calibrationBuckets: buckets,
    marketConditionWeights: {},
    adaptiveMultipliers: { technical: 1.0, news: 1.0, sentiment: 1.0 },
    lastUpdated: new Date().toISOString(),
    totalAnalyzed: 0,
  }
}

/** Persist self-learning state to DB via a special DecisionLog record */
async function persistSelfLearningState(state: SelfLearningState): Promise<void> {
  try {
    const jsonStr = toJsonString(state)
    await db.decisionLog.upsert({
      where: { id: '__self_learning_state__' },
      update: {
        factors: jsonStr,
        createdAt: new Date(),
      },
      create: {
        id: '__self_learning_state__',
        symbol: '__SYSTEM__',
        decision: 'HOLD',
        confidence: 0,
        reasoning: 'Self-learning state persistence record',
        factors: jsonStr,
        finalAction: 'HOLD',
      },
    })
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to persist self-learning state', {
      details: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Load self-learning state from DB or return cached version */
export async function loadSelfLearningState(): Promise<SelfLearningState> {
  // Check in-memory cache first
  if (
    selfLearningCache
    && selfLearningCache.state
    && (Date.now() - selfLearningCache.loadedAt) < SELF_LEARNING_CACHE_TTL_MS
  ) {
    return selfLearningCache.state
  }

  // Load from DB
  try {
    const record = await db.decisionLog.findUnique({
      where: { id: '__self_learning_state__' },
    })
    if (record && record.factors) {
      const parsed = safeJsonParse(record.factors) as SelfLearningState | null
      if (parsed && parsed.calibrationBuckets && parsed.adaptiveMultipliers) {
        selfLearningCache = { state: parsed, loadedAt: Date.now() }
        return parsed
      }
    }
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to load self-learning state from DB', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  // Return default
  const defaultState = getDefaultSelfLearningState()
  selfLearningCache = { state: defaultState, loadedAt: Date.now() }
  return defaultState
}

/** Invalidate the in-memory cache (call after updating state) */
export function invalidateSelfLearningCache(): void {
  selfLearningCache = null
}

/**
 * Get adaptive weights based on current self-learning state.
 *
 * Reads the learning state, applies market-condition-specific boosts,
 * and returns { technical, news, sentiment } weights that sum to 1.0.
 * Falls back to base config weights if learning has insufficient data.
 *
 * @param currentMarketCondition - The current market condition label
 * @param baseConfig - The base AiDecisionConfig record
 * @returns Normalized weights { technical, news, sentiment }
 */
export async function getAdaptiveWeights(
  currentMarketCondition: string,
  baseConfig: Awaited<ReturnType<typeof getDecisionConfig>>,
): Promise<{ technical: number; news: number; sentiment: number }> {
  const state = await loadSelfLearningState()

  // Need minimum data before adjusting (at least 20 analyzed decisions)
  if (state.totalAnalyzed < 20) {
    return {
      technical: baseConfig.technicalWeight as number,
      news: baseConfig.newsWeight as number,
      sentiment: baseConfig.sentimentWeight as number,
    }
  }

  // Start with base weights * adaptive multipliers
  let tech = (baseConfig.technicalWeight as number) * state.adaptiveMultipliers.technical
  let news = (baseConfig.newsWeight as number) * state.adaptiveMultipliers.news
  let sent = (baseConfig.sentimentWeight as number) * state.adaptiveMultipliers.sentiment

  // Apply market-condition-specific boosts
  const condHint = state.marketConditionWeights[currentMarketCondition]
  if (condHint) {
    tech *= condHint.technicalBoost
    news *= condHint.newsBoost
    sent *= condHint.sentimentBoost
  }

  // Normalize to sum to 1.0
  const sum = tech + news + sent
  if (sum > 0) {
    tech = Math.round((tech / sum) * 100) / 100
    news = Math.round((news / sum) * 100) / 100
    sent = Math.round((sent / sum) * 100) / 100
  }

  // Fix any floating point drift
  const normalizedSum = tech + news + sent
  if (Math.abs(normalizedSum - 1.0) > 0.001) {
    const diff = 1.0 - normalizedSum
    if (tech >= news && tech >= sent) {
      tech = Math.round((tech + diff) * 100) / 100
    } else if (news >= sent) {
      news = Math.round((news + diff) * 100) / 100
    } else {
      sent = Math.round((sent + diff) * 100) / 100
    }
  }

  return { technical: tech, news: news, sentiment: sent }
}

/**
 * Calibrate a raw confidence value based on historical calibration data.
 *
 * If a confidence range (e.g. 70-80) historically only wins 40% of the time,
 * we apply a calibration factor to reduce the stated confidence.
 * This prevents overconfidence in systematically miscalibrated ranges.
 *
 * @param rawConfidence - The raw confidence (0-100)
 * @param state - The current self-learning state
 * @returns Calibrated confidence (0-100)
 */
export function calibrateConfidence(rawConfidence: number, state: SelfLearningState): number {
  if (!state || !state.calibrationBuckets || state.calibrationBuckets.length === 0) {
    return rawConfidence
  }

  const bucket = state.calibrationBuckets.find(
    b => rawConfidence >= b.rangeStart && rawConfidence < b.rangeEnd,
  )

  if (!bucket || bucket.count < 5) {
    // Not enough data in this bucket to calibrate
    return rawConfidence
  }

  // The ideal win rate for a given confidence level IS the confidence itself.
  // If 75% confidence only wins 45%, the factor should pull it down.
  const idealWinRate = (bucket.rangeStart + bucket.rangeEnd) / 2 / 100
  const actualWinRate = bucket.winRate / 100

  if (actualWinRate <= 0) return rawConfidence

  // Calibration factor: ratio of actual to ideal, clamped to [0.5, 1.0]
  // Don't inflate confidence, only reduce it when overconfident
  const rawFactor = actualWinRate / idealWinRate
  const factor = clamp(rawFactor, 0.5, 1.0)

  // Apply factor (soft — blend 70% raw + 30% calibrated to avoid jitter)
  const calibrated = rawConfidence * (0.7 + 0.3 * factor)
  return Math.round(clamp(calibrated, 0, 100))
}

/**
 * Update the self-learning state by analyzing recent decisions and trade outcomes.
 *
 * This is the core feedback loop:
 *  1. Load recent BUY/SELL decisions with their outcomes
 *  2. Compute per-strategy and per-(strategy, marketCondition) win rates
 *  3. Build confidence calibration map
 *  4. Compute adaptive weight multipliers based on factor performance
 *  5. Compute market-condition-specific weight hints
 *  6. Persist and cache the updated state
 *
 * @param days - How many days of history to analyze (default 30)
 * @returns Updated SelfLearningState
 */
export async function updateSelfLearningState(days: number = 30): Promise<SelfLearningState> {
  const state = getDefaultSelfLearningState()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Improvement 4: Load previous state for EMA smoothing of adaptive multipliers
  const previousState = await loadSelfLearningState()

  try {
    // --- Step 1: Load decisions and trades in batch ---
    const decisions = await db.decisionLog.findMany({
      where: {
        createdAt: { gte: since },
        decision: { in: ['BUY', 'SELL'] },
        id: { not: '__self_learning_state__' }, // Exclude system records
      },
      orderBy: { createdAt: 'desc' },
    })

    if (decisions.length === 0) {
      state.lastUpdated = new Date().toISOString()
      state.totalAnalyzed = 0
      selfLearningCache = { state, loadedAt: Date.now() }
      return state
    }

    // Batch-load all closed trades
    const tradeWindowStart = new Date(since.getTime() - MATCHING_WINDOW_MS)
    const allClosedTrades = await db.trade.findMany({
      where: {
        status: 'CLOSED',
        openTime: { gte: tradeWindowStart },
      },
      select: {
        symbol: true,
        direction: true,
        pnl: true,
        openTime: true,
        strategy: true,
      },
    })

    // --- Step 2: Match decisions to trades and build stats ---
    // Improvement 3: Use weighted accumulators for time-decay
    const strategyStats: Record<string, { wins: number; total: number; pnlSum: number }> = {}
    const strategyMarketStats: Record<string, { wins: number; total: number; pnlSum: number }> = {}
    const calBuckets: Array<{ wins: number; total: number; rangeStart: number; rangeEnd: number }> = []
    for (let i = 0; i < 100; i += 10) {
      // Last bucket uses rangeEnd=101 so that confidence=100 is included (100 < 101)
      const rangeEnd = i === 90 ? 101 : i + 10
      calBuckets.push({ rangeStart: i, rangeEnd, wins: 0, total: 0 })
    }

    // Improvement 3: Weighted accumulators for factor correctness
    let techCorrect = 0; let techTotal = 0
    let newsCorrect = 0; let newsTotal = 0
    let sentCorrect = 0; let sentTotal = 0

    // Per-market-condition factor performance (weighted)
    const mcFactorPerf: Record<string, {
      techWins: number; techTotal: number
      newsWins: number; newsTotal: number
      sentWins: number; sentTotal: number
    }> = {}

    // Track per-market-condition decision count for Improvement 7
    const mcDecisionCounts: Record<string, number> = {}

    let totalMatched = 0

    for (const d of decisions) {
      const confidence = d.confidence as number
      const strategy = d.strategyUsed || 'AI_COMPOSITE'

      // Parse stored factors
      const factors = (safeJsonParse(d.factors) as Record<string, Record<string, unknown>>) || {}
      const techF = (factors.technical || {}) as Record<string, unknown>
      const newsF = (factors.news || {}) as Record<string, unknown>
      const sentF = (factors.sentiment || {}) as Record<string, unknown>
      const marketCondition = (d.volatilityRegime || 'NORMAL') as string

      // Determine outcome
      let pnl: number | null = null
      if (d.pnlImpact !== null && d.pnlImpact !== undefined) {
        pnl = d.pnlImpact as number
      } else {
        // Match in-memory
        const decisionTime = d.createdAt.getTime()
        const matched = allClosedTrades.find(
          t => t.symbol === d.symbol
            && t.direction === d.decision
            && t.openTime.getTime() >= decisionTime
            && t.openTime.getTime() <= decisionTime + MATCHING_WINDOW_MS,
        )
        if (matched) {
          pnl = matched.pnl
        }
      }

      if (pnl === null) continue // Can't evaluate
      totalMatched++
      const isWin = pnl > 0

      // Improvement 3: Compute time-decay weight based on decision age
      const decisionAgeHours = (Date.now() - d.createdAt.getTime()) / (1000 * 60 * 60)
      const weight = Math.exp(-decisionAgeHours / DECAY_HALF_LIFE_HOURS)

      // Update confidence calibration bucket (weighted)
      const bucketIdx = Math.min(Math.floor(confidence / 10), 9)
      if (calBuckets[bucketIdx]) {
        calBuckets[bucketIdx].total += weight
        if (isWin) calBuckets[bucketIdx].wins += weight
      }

      // Update strategy stats (weighted)
      if (!strategyStats[strategy]) {
        strategyStats[strategy] = { wins: 0, total: 0, pnlSum: 0 }
      }
      strategyStats[strategy].total += weight
      strategyStats[strategy].pnlSum += pnl * weight
      if (isWin) strategyStats[strategy].wins += weight

      // Per (strategy, marketCondition) (weighted)
      const smKey = `${strategy}|${marketCondition}`
      if (!strategyMarketStats[smKey]) {
        strategyMarketStats[smKey] = { wins: 0, total: 0, pnlSum: 0 }
      }
      strategyMarketStats[smKey].total += weight
      strategyMarketStats[smKey].pnlSum += pnl * weight
      if (isWin) strategyMarketStats[smKey].wins += weight

      // Track per-MC decision count for minimum sample guard
      mcDecisionCounts[marketCondition] = (mcDecisionCounts[marketCondition] || 0) + 1

      // --- Improvement 6: Evaluate factors against OUTCOME direction, not decision agreement ---
      const decisionDir = d.decision === 'BUY' ? 1 : -1
      // The correct direction was the decision direction if trade won, opposite if lost
      const outcomeDir = isWin ? decisionDir : (decisionDir === 1 ? -1 : 1)

      // Technical score direction
      const techScore = (techF.overallScore as number) || 0
      const techDir = techScore > 0 ? 1 : techScore < 0 ? -1 : 0
      if (techDir !== 0) {
        techTotal += weight
        if (techDir === outcomeDir) techCorrect += weight
      }

      // News impact direction
      const newsScore = (newsF.impactScore as number) || 0
      const newsDir = newsScore > 0 ? 1 : newsScore < 0 ? -1 : 0
      if (newsDir !== 0) {
        newsTotal += weight
        if (newsDir === outcomeDir) newsCorrect += weight
      }

      // Sentiment direction
      const sentScore = (sentF.symbolScore as number) || 0
      const sentDir = sentScore > 0 ? 1 : sentScore < 0 ? -1 : 0
      if (sentDir !== 0) {
        sentTotal += weight
        if (sentDir === outcomeDir) sentCorrect += weight
      }

      // Per-market-condition factor performance (weighted, outcome-based)
      if (!mcFactorPerf[marketCondition]) {
        mcFactorPerf[marketCondition] = {
          techWins: 0, techTotal: 0,
          newsWins: 0, newsTotal: 0,
          sentWins: 0, sentTotal: 0,
        }
      }
      if (techDir !== 0) {
        mcFactorPerf[marketCondition].techTotal += weight
        if (techDir === outcomeDir) mcFactorPerf[marketCondition].techWins += weight
      }
      if (newsDir !== 0) {
        mcFactorPerf[marketCondition].newsTotal += weight
        if (newsDir === outcomeDir) mcFactorPerf[marketCondition].newsWins += weight
      }
      if (sentDir !== 0) {
        mcFactorPerf[marketCondition].sentTotal += weight
        if (sentDir === outcomeDir) mcFactorPerf[marketCondition].sentWins += weight
      }
    }

    // --- Step 3: Build calibration buckets ---
    state.calibrationBuckets = calBuckets.map(b => {
      const winRate = b.total > 0 ? Math.round((b.wins / b.total) * 100) / 100 : 0
      const idealWinRate = (b.rangeStart + b.rangeEnd) / 2 / 100
      let factor = 1.0
      if (b.total >= 5 && idealWinRate > 0) {
        const rawFactor = (winRate / 100) / idealWinRate
        factor = clamp(rawFactor, 0.5, 1.0)
      }
      return {
        rangeStart: b.rangeStart,
        rangeEnd: b.rangeEnd,
        count: b.total,
        winRate,
        calibrationFactor: Math.round(factor * 100) / 100,
      }
    })

    // --- Step 4: Compute adaptive multipliers based on factor correctness ---
    // Improvement 7: Only compute adaptive multipliers if minimum sample size is met
    if (totalMatched >= MIN_DECISIONS_FOR_ADAPTIVE) {
      const baseTechRate = techTotal > 0 ? techCorrect / techTotal : 0.5
      const baseNewsRate = newsTotal > 0 ? newsCorrect / newsTotal : 0.5
      const baseSentRate = sentTotal > 0 ? sentCorrect / sentTotal : 0.5
      const avgRate = (baseTechRate + baseNewsRate + baseSentRate) / 3

      const newMultipliers = {
        technical: Math.round(clamp(baseTechRate / (avgRate || 0.5), 0.7, 1.3) * 100) / 100,
        news: Math.round(clamp(baseNewsRate / (avgRate || 0.5), 0.7, 1.3) * 100) / 100,
        sentiment: Math.round(clamp(baseSentRate / (avgRate || 0.5), 0.7, 1.3) * 100) / 100,
      }

      // Improvement 4: EMA smoothing between old and new multipliers
      const old = previousState.adaptiveMultipliers
      state.adaptiveMultipliers = {
        technical: Math.round((old.technical * ADAPTIVE_SMOOTHING_ALPHA + newMultipliers.technical * (1 - ADAPTIVE_SMOOTHING_ALPHA)) * 100) / 100,
        news: Math.round((old.news * ADAPTIVE_SMOOTHING_ALPHA + newMultipliers.news * (1 - ADAPTIVE_SMOOTHING_ALPHA)) * 100) / 100,
        sentiment: Math.round((old.sentiment * ADAPTIVE_SMOOTHING_ALPHA + newMultipliers.sentiment * (1 - ADAPTIVE_SMOOTHING_ALPHA)) * 100) / 100,
      }
    } else {
      // Improvement 7: Not enough data — keep previous adaptive multipliers
      logger.warn('AI_ENGINE', `Insufficient decisions for adaptive multipliers: ${totalMatched} < ${MIN_DECISIONS_FOR_ADAPTIVE}`, {
        metadata: { totalMatched, required: MIN_DECISIONS_FOR_ADAPTIVE },
      })
      state.adaptiveMultipliers = { ...previousState.adaptiveMultipliers }
    }

    // --- Step 5: Compute market-condition weight hints ---
    // Improvement 7: Only compute weight hints for MCs with minimum sample size
    const mcWeights: Partial<Record<string, MarketConditionWeightHint>> = {}
    for (const [mc, perf] of Object.entries(mcFactorPerf)) {
      const mcTotal = (mcDecisionCounts[mc] || 0)
      if (mcTotal < MIN_DECISIONS_PER_MC) {
        logger.warn('AI_ENGINE', `Insufficient decisions for MC weight hints: ${mc} has ${mcTotal} < ${MIN_DECISIONS_PER_MC}`, {
          metadata: { marketCondition: mc, total: mcTotal, required: MIN_DECISIONS_PER_MC },
        })
        // Keep previous weight hint for this MC if it existed
        if (previousState.marketConditionWeights[mc]) {
          mcWeights[mc] = previousState.marketConditionWeights[mc]
        }
        continue
      }

      const mcTechRate = perf.techTotal > 0 ? perf.techWins / perf.techTotal : 0.5
      const mcNewsRate = perf.newsTotal > 0 ? perf.newsWins / perf.newsTotal : 0.5
      const mcSentRate = perf.sentTotal > 0 ? perf.sentWins / perf.sentTotal : 0.5
      const mcAvg = (mcTechRate + mcNewsRate + mcSentRate) / 3

      if (mcAvg <= 0) continue

      mcWeights[mc] = {
        technicalBoost: Math.round(clamp(mcTechRate / (mcAvg || 0.5), 0.8, 1.2) * 100) / 100,
        newsBoost: Math.round(clamp(mcNewsRate / (mcAvg || 0.5), 0.8, 1.2) * 100) / 100,
        sentimentBoost: Math.round(clamp(mcSentRate / (mcAvg || 0.5), 0.8, 1.2) * 100) / 100,
      }
    }
    state.marketConditionWeights = mcWeights

    // --- Step 6: Store stats ---
    state.strategyStats = strategyStats
    state.strategyMarketStats = strategyMarketStats
    state.totalAnalyzed = totalMatched
    state.lastUpdated = new Date().toISOString()

    // --- Step 7: Persist and cache ---
    selfLearningCache = { state, loadedAt: Date.now() }
    await persistSelfLearningState(state)

    logger.info('AI_ENGINE', `Self-learning state updated: ${totalMatched} decisions analyzed`, {
      metadata: {
        totalAnalyzed: totalMatched,
        adaptiveMultipliers: state.adaptiveMultipliers,
        marketConditions: Object.keys(mcWeights),
        strategies: Object.keys(strategyStats),
      },
    })

    return state
  } catch (err) {
    logger.error('AI_ENGINE', 'Self-learning state update failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return state
  }
}

/**
 * Get per-strategy performance statistics.
 *
 * @param days - Number of days to look back (default 30)
 * @returns Array of StrategyPerformanceEntry sorted by win rate descending
 */
export async function getStrategyPerformance(days: number = 30): Promise<StrategyPerformanceEntry[]> {
  const state = await loadSelfLearningState()
  const results: StrategyPerformanceEntry[] = []

  // If we have self-learning data, use it directly
  if (state.totalAnalyzed > 0 && Object.keys(state.strategyStats).length > 0) {
    for (const [strategy, stats] of Object.entries(state.strategyStats)) {
      let bestMc = 'NORMAL'
      let worstMc = 'NORMAL'
      let bestWr = -1
      let worstWr = 2

      for (const [key, mcStats] of Object.entries(state.strategyMarketStats)) {
        if (!key.startsWith(`${strategy}|`)) continue
        const mc = key.slice(strategy.length + 1)
        const wr = mcStats.total > 0 ? mcStats.wins / mcStats.total : 0
        if (wr > bestWr) { bestWr = wr; bestMc = mc }
        if (wr < worstWr) { worstWr = wr; worstMc = mc }
      }

      results.push({
        strategy,
        totalTrades: stats.total,
        winRate: stats.total > 0
          ? Math.round((stats.wins / stats.total) * 100) / 100
          : 0,
        avgPnl: stats.total > 0
          ? Math.round((stats.pnlSum / stats.total) * 100) / 100
          : 0,
        bestMarketCondition: bestMc,
        worstMarketCondition: worstMc,
      })
    }

    return results.sort((a, b) => b.winRate - a.winRate)
  }

  // Fallback: compute directly from DB
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const decisions = await db.decisionLog.findMany({
      where: {
        createdAt: { gte: since },
        decision: { in: ['BUY', 'SELL'] },
        id: { not: '__self_learning_state__' }, // Exclude system records
      },
    })

    const tradeWindowStart = new Date(since.getTime() - MATCHING_WINDOW_MS)
    const allTrades = await db.trade.findMany({
      where: { status: 'CLOSED', openTime: { gte: tradeWindowStart } },
      select: { symbol: true, direction: true, pnl: true, openTime: true },
    })

    const stratMap = new Map<string, {
      wins: number; total: number; pnlSum: number
      mcMap: Record<string, { wins: number; total: number }>
    }>()

    for (const d of decisions) {
      const strategy = d.strategyUsed || 'AI_COMPOSITE'
      const mc = d.volatilityRegime || 'NORMAL'

      let pnl: number | null = null
      if (d.pnlImpact !== null && d.pnlImpact !== undefined) {
        pnl = d.pnlImpact as number
      } else {
        const dt = d.createdAt.getTime()
        const matched = allTrades.find(
          t => t.symbol === d.symbol && t.direction === d.decision
            && t.openTime.getTime() >= dt && t.openTime.getTime() <= dt + MATCHING_WINDOW_MS,
        )
        if (matched) pnl = matched.pnl
      }
      if (pnl === null) continue

      if (!stratMap.has(strategy)) {
        stratMap.set(strategy, { wins: 0, total: 0, pnlSum: 0, mcMap: {} })
      }
      const entry = stratMap.get(strategy)!
      entry.total++
      entry.pnlSum += pnl
      if (pnl > 0) entry.wins++
      if (!entry.mcMap[mc]) entry.mcMap[mc] = { wins: 0, total: 0 }
      entry.mcMap[mc].total++
      if (pnl > 0) entry.mcMap[mc].wins++
    }

    for (const [strategy, stats] of stratMap.entries()) {
      let bestMc = 'NORMAL'; let worstMc = 'NORMAL'
      let bestWr = -1; let worstWr = 2
      for (const [mc, mcStats] of Object.entries(stats.mcMap)) {
        const wr = mcStats.total > 0 ? mcStats.wins / mcStats.total : 0
        if (wr > bestWr) { bestWr = wr; bestMc = mc }
        if (wr < worstWr) { worstWr = wr; worstMc = mc }
      }
      results.push({
        strategy,
        totalTrades: stats.total,
        winRate: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) / 100 : 0,
        avgPnl: stats.total > 0 ? Math.round((stats.pnlSum / stats.total) * 100) / 100 : 0,
        bestMarketCondition: bestMc,
        worstMarketCondition: worstMc,
      })
    }

    return results.sort((a, b) => b.winRate - a.winRate)
  } catch (err) {
    logger.error('AI_ENGINE', 'Strategy performance fetch failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

/**
 * Run the full feedback loop: update self-learning state from recent history.
 *
 * This is the main entry point for periodic self-learning. It:
 *  1. Calls updateSelfLearningState() to recompute all adaptive parameters
 *  2. Returns the updated state for inspection
 *
 * Should be called periodically (e.g., every 30 minutes) by a scheduler
 * or manually via the POST /api/ai/accuracy endpoint.
 *
 * @param days - Days of history to analyze (default 30)
 * @returns Updated SelfLearningState
 */
export async function runFeedbackLoop(days: number = 30): Promise<SelfLearningState> {
  logger.info('AI_ENGINE', `Running self-learning feedback loop (last ${days} days)`, {
    metadata: { days },
  })
  const state = await updateSelfLearningState(days)
  logger.info('AI_ENGINE', 'Feedback loop complete', {
    metadata: {
      totalAnalyzed: state.totalAnalyzed,
      adaptiveMultipliers: state.adaptiveMultipliers,
      strategiesTracked: Object.keys(state.strategyStats).length,
      marketConditionsTracked: Object.keys(state.marketConditionWeights).length,
    },
  })
  return state
}

/**
 * Determine the market condition classification from technical factors.
 *
 * Maps technical analysis signals to a MarketCondition label used by
 * the self-learning system for strategy-level performance tracking.
 *
 * @param tech - Technical factors
 * @param riskVolatilityRegime - Volatility regime from risk factors
 * @returns MarketCondition label
 */
export function classifyMarketCondition(
  tech: TechnicalFactors,
  riskVolatilityRegime: string,
): MarketCondition {
  if (riskVolatilityRegime === 'HIGH_VOLATILITY') return 'HIGH_VOLATILITY'
  if (riskVolatilityRegime === 'LOW_VOLATILITY') return 'LOW_VOLATILITY'
  if (tech.adxValue > 25 && tech.trendStrength > 40) return 'TRENDING'
  if (tech.adxValue < 20 && tech.trendStrength < 30) return 'RANGE_BOUND'
  return 'NORMAL'
}
