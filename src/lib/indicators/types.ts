/**
 * TYPES & INTERFACES + CONSTANTS — split from src/lib/indicator-pool.ts (v2.1.0 refactor).
 * Pure types, interfaces, and immutable constants; no runtime imports.
 * Cross-part note: DEFAULT_MAX_CACHE_ENTRIES (used by pool.ts) and FIB_LEVELS
 * (used by calculations.ts) were previously module-private; they are exported
 * for sibling parts and declared exactly once — here.
 */

// ============================================
// TYPES & INTERFACES
// ============================================

/** Single OHLCV candle bar */
export interface OHLCVBar {
  openTime: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Array of OHLCV bars sorted ASC by openTime (oldest first) */
export type OHLCVSeries = OHLCVBar[]

/** All supported indicator names */
export type IndicatorName =
  | 'SMA'
  | 'EMA'
  | 'RSI'
  | 'MACD'
  | 'ATR'
  | 'BOLLINGER'
  | 'STOCHASTIC'
  | 'ADX'
  | 'VWAP'
  | 'PIVOT_POINTS'

/** Configuration for computing an indicator */
export interface IndicatorConfig {
  name: IndicatorName
  params?: Record<string, number>
}

/** Result of computing a single indicator */
export interface IndicatorResult {
  name: IndicatorName
  values: Record<string, number>
  timestamp: Date
  calculated: boolean
  error?: string
}

/** Result of computing a pool of indicators */
export interface IndicatorPoolResult {
  results: Map<IndicatorName, IndicatorResult>
  computedAt: Date
  cacheHits: number
  cacheMisses: number
}

/** Dependency graph: maps each indicator to its required sub-indicators */
export type DependencyGraph = Record<IndicatorName, IndicatorName[]>

/** Strategy signal output */
export interface StrategySignal {
  signal: 'BUY' | 'SELL' | 'NEUTRAL'
  confidence: number
  strength: number
  indicators: IndicatorResult[]
}

// ============================================
// CONSTANTS
// ============================================

/** Default minimum bars required for safe indicator computation */
const DEFAULT_MIN_BARS = 200

/** Default cache TTL in milliseconds */
export const DEFAULT_CACHE_TTL_MS = 60_000

/** Default maximum cache entries to prevent unbounded memory growth */
export const DEFAULT_MAX_CACHE_ENTRIES = 500

/** Fibonacci retracement levels for pivot point variants */
export const FIB_LEVELS = {
  s3: 1.0,
  s2: 0.618,
  s1: 0.382,
  r1: 0.382,
  r2: 0.618,
  r3: 1.0,
} as const
