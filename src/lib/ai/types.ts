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

// ============================================================================
// SECTION 1: TYPES & INTERFACES
// ============================================================================

/** Market condition labels used for self-learning classification */
export type MarketCondition = 'TRENDING' | 'RANGE_BOUND' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'NORMAL'

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

/** LLM enhancement data attached to a decision */
export interface LlmEnhancement {
  /** Whether LLM analysis was attempted */
  used: boolean
  /** Which provider was used (e.g. 'groq', 'openai') */
  provider: string | null
  /** Model used */
  model: string | null
  /** Latency in ms */
  latencyMs: number | null
  /** LLM's market condition assessment */
  llmMarketCondition: string | null
  /** LLM's trend direction */
  llmTrendDirection: string | null
  /** LLM's confidence */
  llmConfidence: number | null
  /** LLM's recommended action */
  llmAction: string | null
  /** LLM's reasoning */
  llmReasoning: string | null
  /** Key factors identified by LLM */
  llmKeyFactors: Array<{ name: string; impact: string; score: number; detail: string }> | null
  /** LLM's risk assessment */
  llmRiskAssessment: string | null
  /** LLM's sentiment bias */
  llmSentimentBias: string | null
  /** Raw LLM response */
  rawResponse: string | null
  /** Error if LLM failed */
  error: string | null
  /** Token usage */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
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
  /** LLM enhancement data (null if no LLM providers configured) */
  llmEnhancement: LlmEnhancement | null
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

/** Metadata for a single strategy in the registry */
export interface StrategyMeta {
  id: string
  name: string
  description: string
  timeframes: string[]
  minBars: number
  weight: number
}

/** Per-strategy signal breakdown used in multi-strategy consensus */
export interface StrategyBreakdown {
  strategyId: string
  strategyName: string
  signal: 'BUY' | 'SELL' | 'NEUTRAL'
  confidence: number
  weight: number
  weightedScore: number
}

/** Return type for strategy performance tracking */
export interface StrategyPerformance {
  strategyId: string
  totalDecisions: number
  buyCount: number
  sellCount: number
  holdCount: number
  avgConfidence: number
  accuracy: number | null
  totalPnl: number | null
}

/**
 * Multi-Strategy Registry
 * =======================
 * Maps all 7 strategy IDs to their metadata including supported timeframes,
 * minimum bar requirements, and consensus weights.
 */
export const STRATEGY_REGISTRY: StrategyMeta[] = [
  { id: 'ma-ribbon', name: 'MA Ribbon', description: 'Multi-EMA ribbon alignment', timeframes: ['M15', 'H1', 'H4'], minBars: 100, weight: 1.0 },
  { id: 'momentum-scalp', name: 'Momentum Scalping', description: 'RSI reversal + MACD momentum', timeframes: ['M5', 'M15'], minBars: 50, weight: 0.8 },
  { id: 'pivot-point', name: 'Pivot Point', description: 'Support/resistance bounces', timeframes: ['M15', 'H1'], minBars: 50, weight: 0.9 },
  { id: 'ema-crossover', name: 'EMA Crossover', description: 'Golden/Death cross signals', timeframes: ['M15', 'H1', 'H4'], minBars: 30, weight: 0.85 },
  { id: 'rmi-trend-sync', name: 'RMI Trend Sync', description: 'RSI + ADX trend synchronization', timeframes: ['M15', 'H1'], minBars: 50, weight: 0.9 },
  { id: 'linear-regression', name: 'Linear Regression', description: 'Bollinger Band mean reversion', timeframes: ['M15', 'H1', 'H4'], minBars: 30, weight: 0.75 },
  { id: 'ema-rsi-filter', name: 'EMA/RSI Filter', description: 'EMA trend + RSI neutral zone', timeframes: ['M15', 'H1'], minBars: 50, weight: 0.85 },
]

// ============================================================================
// SECTION 2: CONSTANTS
// =============================================================================

// NOTE (v2.1.0 split): module-private constants below are exported so sibling
// modules under src/lib/ai/ can import them; they were module-scope before.
export const DEFAULT_TIMEFRAME = 'H1'
export const BUY_THRESHOLD = 30
export const SELL_THRESHOLD = -30
export const HIGH_RISK_SCORE = 7
export const MAX_BREAKING_NEWS = 2
export const SL_MULTIPLIER = 1.0
export const TP_MULTIPLIER = 1.5
export const DEFAULT_ATR_PCT = 0.015 // 1.5% estimated ATR for SL/TP calc
export const BREAKING_NEWS_CACHE_TTL_MS = 60_000 // 1 minute
export const NEWS_FETCH_CACHE_MS = 5 * 60 * 1000 // 5 minutes
export const MATCHING_WINDOW_MS = 5 * 60 * 1000 // 5 minutes to match decision to trade
export const NEWS_FETCH_CACHE_MAX_ENTRIES = 100 // Max entries before LRU eviction
export const ESTIMATED_ACCOUNT_VALUE = 100_000_000 // 100M IDR estimate
export const RISK_PER_TRADE_PCT = 0.01 // 1% risk per trade
