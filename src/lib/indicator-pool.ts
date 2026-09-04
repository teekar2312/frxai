/**
 * Technical Indicator Calculation Engine
 * ======================================
 * Comprehensive indicator pool for IDX/FINEX broker via MT5.
 * Supports 10 technical indicators with dependency graph,
 * caching, validation, and strategy signal generation.
 *
 * Indicators: SMA, EMA, RSI, MACD, ATR, BOLLINGER, STOCHASTIC, ADX, VWAP, PIVOT_POINTS
 *
 * All calculations use real math — no stubs, no Math.sin/random hacks.
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { getTradingPhase, type TradingPhase } from '@/lib/mt5-connection'
import { SYMBOL_MAP } from '@/lib/mt5-connection'
import { detectVolatilityRegime } from '@/lib/risk-engine'
import type { CandleData as PrismaCandleData } from '@prisma/client'

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
const DEFAULT_MAX_CACHE_ENTRIES = 500

/** Fibonacci retracement levels for pivot point variants */
const FIB_LEVELS = {
  s3: 1.0,
  s2: 0.618,
  s1: 0.382,
  r1: 0.382,
  r2: 0.618,
  r3: 1.0,
} as const

// ============================================
// HELPER UTILITIES
// ============================================

/** Safely check if a number is valid (not NaN, not null, not negative for prices) */
function isValidPrice(value: number): boolean {
  return typeof value === 'number' && !Number.isNaN(value) && value > 0 && Number.isFinite(value)
}

/** Calculate standard deviation of an array */
function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squaredDiffs = values.map((v) => (v - mean) ** 2)
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length
  return Math.sqrt(variance)
}

/** Generate a cache key from indicator name, params, and optional scope */
function cacheKey(name: IndicatorName, params?: Record<string, number>, scope?: string): string {
  let key = scope ? `${scope}:` : ''
  if (!params || Object.keys(params).length === 0) return `${key}${name}`
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return `${key}${name}:${sorted}`
}

// ============================================
// CORE CALCULATION FUNCTIONS
// ============================================

/**
 * Simple Moving Average
 * @param closes - Array of closing prices
 * @param period - Lookback period
 * @returns SMA value or null if insufficient data
 */
export function calculateSMA(closes: number[], period: number): number | null {
  if (!closes || closes.length < period || period <= 0) return null
  const slice = closes.slice(-period)
  // Validate no NaN/null in the slice
  for (const v of slice) {
    if (!isValidPrice(v)) return null
  }
  const sum = slice.reduce((acc, val) => acc + val, 0)
  return sum / period
}

/**
 * Exponential Moving Average
 * Multiplier = 2 / (period + 1)
 * First EMA = SMA of first `period` closes, then EMA[i] = close[i] * k + EMA[i-1] * (1-k)
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period
 * @returns Latest EMA value or null if insufficient data
 */
export function calculateEMA(closes: number[], period: number): number | null {
  if (!closes || closes.length < period || period <= 0) return null

  const k = 2 / (period + 1)

  // Validate input
  for (const v of closes) {
    if (!isValidPrice(v)) return null
  }

  // Seed: SMA of the first `period` values
  let ema = 0
  for (let i = 0; i < period; i++) {
    ema += closes[i]
  }
  ema /= period

  // Compute EMA for remaining values
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
  }

  return ema
}

/**
 * Compute the full EMA series (same length as input, null-padded for first period-1 entries)
 */
export function calculateEMASeries(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null)
  if (!closes || closes.length < period || period <= 0) return result

  const k = 2 / (period + 1)

  // Validate input
  let valid = true
  for (const v of closes) {
    if (!isValidPrice(v)) {
      valid = false
      break
    }
  }
  if (!valid) return result

  // Seed: SMA of first `period` values
  let ema = 0
  for (let i = 0; i < period; i++) {
    ema += closes[i]
  }
  ema /= period
  result[period - 1] = ema

  // Compute EMA for remaining values
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k)
    result[i] = ema
  }

  return result
}

/**
 * Wilder's RSI (Relative Strength Index)
 * Uses exponential smoothing (Wilder's method) for average gain/loss.
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 14)
 * @returns RSI value 0-100 or null if insufficient data
 */
export function calculateRSI(closes: number[], period: number = 14): number | null {
  if (!closes || closes.length < period + 1 || period <= 0) return null

  // Validate input
  for (const v of closes) {
    if (!isValidPrice(v)) return null
  }

  // Calculate price changes
  const changes: number[] = []
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1])
  }

  // Separate gains and losses
  const gains = changes.map((c) => (c > 0 ? c : 0))
  const losses = changes.map((c) => (c < 0 ? -c : 0))

  // Initial averages: SMA of first `period` values
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    avgGain += gains[i]
    avgLoss += losses[i]
  }
  avgGain /= period
  avgLoss /= period

  // Wilder's smoothing for subsequent values
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }

  // Calculate RS and RSI
  if (avgLoss === 0 && avgGain === 0) return 50 // flat series → neutral
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * MACD (Moving Average Convergence Divergence)
 * MACD Line = EMA(fast) - EMA(slow)
 * Signal Line = EMA(signalPeriod) of MACD Line values
 * Histogram = MACD Line - Signal Line
 *
 * @param closes - Array of closing prices
 * @param fastPeriod - Fast EMA period (default 12)
 * @param slowPeriod - Slow EMA period (default 26)
 * @param signalPeriod - Signal EMA period (default 9)
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macdLine: number | null; signalLine: number | null; histogram: number | null } {
  const minRequired = slowPeriod + signalPeriod
  if (!closes || closes.length < minRequired || fastPeriod <= 0 || slowPeriod <= 0 || signalPeriod <= 0) {
    return { macdLine: null, signalLine: null, histogram: null }
  }

  // Validate
  for (const v of closes) {
    if (!isValidPrice(v)) return { macdLine: null, signalLine: null, histogram: null }
  }

  // Compute fast and slow EMA series
  const fastK = 2 / (fastPeriod + 1)
  const slowK = 2 / (slowPeriod + 1)

  // Seed fast EMA
  let fastEma = 0
  for (let i = 0; i < fastPeriod; i++) fastEma += closes[i]
  fastEma /= fastPeriod

  // Seed slow EMA
  let slowEma = 0
  for (let i = 0; i < slowPeriod; i++) slowEma += closes[i]
  slowEma /= slowPeriod

  // Warm up fast EMA for bars between fastPeriod and slowPeriod
  // Without this, fastEma at i=slowPeriod is the SMA of closes[0..fastPeriod-1]
  // missing updates for closes[fastPeriod..slowPeriod-1]
  for (let i = fastPeriod; i < slowPeriod; i++) {
    fastEma = closes[i] * fastK + fastEma * (1 - fastK)
  }

  // Build MACD line series starting from slowPeriod-1
  const macdLineSeries: number[] = []

  // For indices before slowPeriod, compute but only start collecting after seed
  for (let i = slowPeriod; i < closes.length; i++) {
    // Update fast EMA up to i
    if (i >= fastPeriod) {
      fastEma = closes[i] * fastK + fastEma * (1 - fastK)
    }
    // Update slow EMA
    slowEma = closes[i] * slowK + slowEma * (1 - slowK)
    macdLineSeries.push(fastEma - slowEma)
  }

  if (macdLineSeries.length < signalPeriod) {
    return { macdLine: null, signalLine: null, histogram: null }
  }

  // Compute signal line: EMA of MACD line series
  const sigK = 2 / (signalPeriod + 1)
  let signalEma = 0
  for (let i = 0; i < signalPeriod; i++) signalEma += macdLineSeries[i]
  signalEma /= signalPeriod

  for (let i = signalPeriod; i < macdLineSeries.length; i++) {
    signalEma = macdLineSeries[i] * sigK + signalEma * (1 - sigK)
  }

  const latestMacd = macdLineSeries[macdLineSeries.length - 1]
  const histogram = latestMacd - signalEma

  return {
    macdLine: latestMacd,
    signalLine: signalEma,
    histogram,
  }
}

/**
 * ATR (Average True Range)
 * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
 * ATR = Wilder's smoothing of TR over period
 *
 * @param bars - Array of OHLCV bars
 * @param period - Lookback period (default 14)
 */
export function calculateATR(bars: OHLCVBar[], period: number = 14): number | null {
  if (!bars || bars.length < period + 1 || period <= 0) return null

  // Validate
  for (const bar of bars) {
    if (!isValidPrice(bar.high) || !isValidPrice(bar.low) || !isValidPrice(bar.close)) return null
  }

  // Calculate True Range series
  const trSeries: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const highLow = bars[i].high - bars[i].low
    const highPrevClose = Math.abs(bars[i].high - bars[i - 1].close)
    const lowPrevClose = Math.abs(bars[i].low - bars[i - 1].close)
    trSeries.push(Math.max(highLow, highPrevClose, lowPrevClose))
  }

  if (trSeries.length < period) return null

  // Initial ATR: SMA of first `period` TR values
  let atr = 0
  for (let i = 0; i < period; i++) {
    atr += trSeries[i]
  }
  atr /= period

  // Wilder's smoothing
  for (let i = period; i < trSeries.length; i++) {
    atr = (atr * (period - 1) + trSeries[i]) / period
  }

  return atr
}

/**
 * Bollinger Bands
 * Middle = SMA(period)
 * Upper = Middle + stdDev * stddev(closes, period)
 * Lower = Middle - stdDev * stddev(closes, period)
 * Bandwidth = (upper - lower) / middle
 * %B = (close - lower) / (upper - lower)
 *
 * @param closes - Array of closing prices
 * @param period - Lookback period (default 20)
 * @param stdDevMultiplier - Standard deviation multiplier (default 2)
 */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number | null; middle: number | null; lower: number | null; bandwidth: number | null; percentB: number | null } {
  if (!closes || closes.length < period || period <= 0 || stdDevMultiplier <= 0) {
    return { upper: null, middle: null, lower: null, bandwidth: null, percentB: null }
  }

  // Validate
  for (const v of closes) {
    if (!isValidPrice(v)) {
      return { upper: null, middle: null, lower: null, bandwidth: null, percentB: null }
    }
  }

  const slice = closes.slice(-period)
  const middle = slice.reduce((acc, v) => acc + v, 0) / period
  const sd = standardDeviation(slice)

  const upper = middle + stdDevMultiplier * sd
  const lower = middle - stdDevMultiplier * sd

  const bandwidth = middle !== 0 ? (upper - lower) / middle : null
  const range = upper - lower
  const lastClose = closes[closes.length - 1]
  const percentB = range !== 0 ? (lastClose - lower) / range : null

  return { upper, middle, lower, bandwidth, percentB }
}

/**
 * Stochastic Oscillator
 * %K = (close - lowestLow) / (highestHigh - lowestLow) * 100
 * %D = SMA(%K, dPeriod)
 *
 * @param bars - Array of OHLCV bars
 * @param kPeriod - %K lookback period (default 14)
 * @param dPeriod - %D smoothing period (default 3)
 */
export function calculateStochastic(
  bars: OHLCVBar[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: number | null; d: number | null } {
  if (!bars || bars.length < kPeriod + dPeriod - 1 || kPeriod <= 0 || dPeriod <= 0) {
    return { k: null, d: null }
  }

  // Validate
  for (const bar of bars) {
    if (!isValidPrice(bar.high) || !isValidPrice(bar.low) || !isValidPrice(bar.close)) {
      return { k: null, d: null }
    }
  }

  // Compute %K series
  const kSeries: number[] = []
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const slice = bars.slice(i - kPeriod + 1, i + 1)
    const highestHigh = Math.max(...slice.map((b) => b.high))
    const lowestLow = Math.min(...slice.map((b) => b.low))
    const range = highestHigh - lowestLow
    const k = range !== 0 ? ((bars[i].close - lowestLow) / range) * 100 : 50
    kSeries.push(k)
  }

  if (kSeries.length < dPeriod) return { k: null, d: null }

  // %D = SMA of last dPeriod %K values
  const lastK = kSeries[kSeries.length - 1]
  const kSlice = kSeries.slice(-dPeriod)
  const d = kSlice.reduce((acc, v) => acc + v, 0) / dPeriod

  return { k: lastK, d }
}

/**
 * ADX (Average Directional Index)
 * Computes +DI, -DI, DX, and ADX using Wilder's smoothing.
 *
 * @param bars - Array of OHLCV bars
 * @param period - Lookback period (default 14)
 */
export function calculateADX(
  bars: OHLCVBar[],
  period: number = 14
): { adx: number | null; plusDi: number | null; minusDi: number | null } {
  if (!bars || bars.length < period * 2 || period <= 0) {
    return { adx: null, plusDi: null, minusDi: null }
  }

  // Validate
  for (const bar of bars) {
    if (
      !isValidPrice(bar.high) ||
      !isValidPrice(bar.low) ||
      !isValidPrice(bar.close)
    ) {
      return { adx: null, plusDi: null, minusDi: null }
    }
  }

  // Calculate True Range, +DM, -DM
  const trList: number[] = []
  const plusDmList: number[] = []
  const minusDmList: number[] = []

  for (let i = 1; i < bars.length; i++) {
    const highDiff = bars[i].high - bars[i - 1].high
    const lowDiff = bars[i - 1].low - bars[i].low

    // +DM and -DM
    let plusDm = 0
    let minusDm = 0
    if (highDiff > lowDiff && highDiff > 0) {
      plusDm = highDiff
    }
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDm = lowDiff
    }

    // True Range
    const highLow = bars[i].high - bars[i].low
    const highPrevClose = Math.abs(bars[i].high - bars[i - 1].close)
    const lowPrevClose = Math.abs(bars[i].low - bars[i - 1].close)
    const tr = Math.max(highLow, highPrevClose, lowPrevClose)

    trList.push(tr)
    plusDmList.push(plusDm)
    minusDmList.push(minusDm)
  }

  if (trList.length < period) return { adx: null, plusDi: null, minusDi: null }

  // Initial smoothed values: SMA of first `period` values
  let smoothTR = 0
  let smoothPlusDM = 0
  let smoothMinusDM = 0

  for (let i = 0; i < period; i++) {
    smoothTR += trList[i]
    smoothPlusDM += plusDmList[i]
    smoothMinusDM += minusDmList[i]
  }

  // DX series
  const dxSeries: number[] = []

  // First DX
  let plusDI = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0
  let minusDI = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0
  const diSum = plusDI + minusDI
  const firstDX = diSum !== 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0
  dxSeries.push(firstDX)

  // Subsequent values with Wilder's smoothing
  for (let i = period; i < trList.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trList[i]
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDmList[i]
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDmList[i]

    plusDI = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0
    minusDI = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0
    const sum = plusDI + minusDI
    const dx = sum !== 0 ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0
    dxSeries.push(dx)
  }

  // ADX = Wilder's smooth of DX
  if (dxSeries.length < period) return { adx: null, plusDi: plusDI, minusDi: minusDI }

  let adx = 0
  for (let i = 0; i < period; i++) {
    adx += dxSeries[i]
  }
  adx /= period

  for (let i = period; i < dxSeries.length; i++) {
    adx = (adx * (period - 1) + dxSeries[i]) / period
  }

  return { adx, plusDi: plusDI, minusDi: minusDI }
}

/**
 * VWAP (Volume Weighted Average Price)
 * Cumulative(price * volume) / cumulative(volume)
 * Intended for intraday data only.
 *
 * @param bars - Array of OHLCV bars
 */
export function calculateVWAP(bars: OHLCVBar[]): { vwap: number | null; cumulativeVolume: number } {
  let cumulativeTPV = 0  // Typical Price * Volume
  let cumulativeVolume = 0

  if (!bars || bars.length === 0) {
    return { vwap: null, cumulativeVolume: 0 }
  }

  for (const bar of bars) {
    if (!isValidPrice(bar.high) || !isValidPrice(bar.low) || !isValidPrice(bar.close) || bar.volume < 0) {
      continue
    }
    const typicalPrice = (bar.high + bar.low + bar.close) / 3
    cumulativeTPV += typicalPrice * bar.volume
    cumulativeVolume += bar.volume
  }

  if (cumulativeVolume === 0) {
    return { vwap: null, cumulativeVolume: 0 }
  }

  return {
    vwap: cumulativeTPV / cumulativeVolume,
    cumulativeVolume,
  }
}

/**
 * Pivot Points
 * Classic: PP=(H+L+C)/3, R1=2*PP-L, S1=2*PP-H, R2=PP+(H-L), S2=PP-(H-L), R3=H+2*(PP-L), S3=L-2*(H-PP)
 * Fibonacci: Uses 0.382/0.618/1.0 multipliers for support/resistance levels
 *
 * @param bars - Array of OHLCV bars
 * @param numPeriods - Number of periods to aggregate (default 1 = last bar only)
 * @param fibonacci - Use Fibonacci-based levels instead of classic (default false)
 */
export function calculatePivotPoints(
  bars: OHLCVBar[],
  numPeriods: number = 1,
  fibonacci: boolean = false
): { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } | null {
  if (!bars || bars.length < numPeriods || numPeriods <= 0) return null

  const relevantBars = bars.slice(-numPeriods)

  // Validate
  for (const bar of relevantBars) {
    if (!isValidPrice(bar.high) || !isValidPrice(bar.low) || !isValidPrice(bar.close)) {
      return null
    }
  }

  const high = Math.max(...relevantBars.map((b) => b.high))
  const low = Math.min(...relevantBars.map((b) => b.low))
  const close = relevantBars[relevantBars.length - 1].close

  // Pivot Point
  const pp = (high + low + close) / 3

  if (!fibonacci) {
    // Classic pivot points
    return {
      pivot: pp,
      r1: 2 * pp - low,
      r2: pp + (high - low),
      r3: high + 2 * (pp - low),
      s1: 2 * pp - high,
      s2: pp - (high - low),
      s3: low - 2 * (high - pp),
    }
  }

  // Fibonacci pivot points
  const range = high - low
  return {
    pivot: pp,
    r1: pp + FIB_LEVELS.r1 * range,
    r2: pp + FIB_LEVELS.r2 * range,
    r3: pp + FIB_LEVELS.r3 * range,
    s1: pp - FIB_LEVELS.s1 * range,
    s2: pp - FIB_LEVELS.s2 * range,
    s3: pp - FIB_LEVELS.s3 * range,
  }
}

// ============================================
// INDICATOR POOL CLASS
// ============================================

/**
 * IndicatorPool — Caching, dependency-ordered indicator computation engine.
 *
 * Maintains an internal cache with configurable TTL, tracks cache hit/miss stats,
 * and resolves computation order via a dependency graph.
 */
export class IndicatorPool {
  private cache: Map<string, { result: IndicatorResult; computedAt: Date }> = new Map()
  private cacheTtlMs: number
  private maxCacheEntries: number
  private scope: string
  private hits = 0
  private misses = 0

  /** Dependency graph: which indicators depend on which sub-indicators */
  private static readonly DEPENDENCIES: DependencyGraph = {
    SMA: [],
    EMA: [],
    RSI: [],
    MACD: ['EMA'],
    ATR: [],
    BOLLINGER: ['SMA'],
    STOCHASTIC: [],
    ADX: [],
    VWAP: [],
    PIVOT_POINTS: [],
  }

  constructor(cacheTtlMs: number = DEFAULT_CACHE_TTL_MS, scope: string = 'global') {
    this.cacheTtlMs = cacheTtlMs
    this.maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES
    this.scope = scope
    logger.info('INDICATOR_POOL', 'IndicatorPool initialized', { source: 'IndicatorPool', details: `cacheTtl=${cacheTtlMs}ms, scope=${scope}` })
  }

  /** Returns the dependency graph for all indicators */
  getDependencyGraph(): DependencyGraph {
    return { ...IndicatorPool.DEPENDENCIES }
  }

  /**
   * Compute multiple indicators in dependency order with caching.
   * @param indicators - Array of indicator configs to compute
   * @param bars - OHLCV bar data
   */
  async compute(
    indicators: IndicatorConfig[],
    bars: OHLCVSeries
  ): Promise<IndicatorPoolResult> {
    const results = new Map<IndicatorName, IndicatorResult>()
    const startHits = this.hits
    const startMisses = this.misses

    // Topological sort based on dependencies
    const computed = new Set<string>()
    const queue = [...indicators]

    // Simple topological resolution: compute dependencies first
    const ordered: IndicatorConfig[] = []
    const seen = new Set<string>()

    const resolveOrder = (config: IndicatorConfig) => {
      const key = config.name
      if (seen.has(key)) return
      seen.add(key)

      // Resolve dependencies first
      const deps = IndicatorPool.DEPENDENCIES[config.name] || []
      for (const dep of deps) {
        // Only add dep if it's also in the requested set
        if (indicators.some((i) => i.name === dep)) {
          const depConfig = indicators.find((i) => i.name === dep)
          if (depConfig) resolveOrder(depConfig)
        }
      }

      ordered.push(config)
    }

    for (const config of queue) {
      resolveOrder(config)
    }

    // Compute in order
    for (const config of ordered) {
      const key = cacheKey(config.name, config.params, this.scope)

      // Check cache
      const cached = this.cache.get(key)
      if (cached) {
        const age = Date.now() - cached.computedAt.getTime()
        if (age < this.cacheTtlMs) {
          results.set(config.name, cached.result)
          this.hits++
          computed.add(key)
          continue
        }
        // Expired — remove
        this.cache.delete(key)
      }

      // Cache miss — compute
      this.misses++
      const result = this.computeSingle(config.name, bars, config.params)
      this.cache.set(key, { result, computedAt: new Date() })

      // Evict oldest entries if over limit
      while (this.cache.size > this.maxCacheEntries) {
        const firstKey = this.cache.keys().next().value
        if (firstKey) this.cache.delete(firstKey)
      }
      results.set(config.name, result)
      computed.add(key)
    }

    logger.debug('INDICATOR_POOL', 'IndicatorPool.compute completed', {
      source: 'IndicatorPool',
      details: `requested=${indicators.length}, computed=${ordered.length}, hits=${this.hits - startHits}, misses=${this.misses - startMisses}`,
    })

    return {
      results,
      computedAt: new Date(),
      cacheHits: this.hits - startHits,
      cacheMisses: this.misses - startMisses,
    }
  }

  /**
   * Compute a single indicator without caching.
   * @param name - Indicator name
   * @param bars - OHLCV bar data
   * @param params - Optional parameters
   */
  computeSingle(name: IndicatorName, bars: OHLCVSeries, params?: Record<string, number>): IndicatorResult {
    const timestamp = new Date()
    const closes = bars.map((b) => b.close)

    try {
      switch (name) {
        case 'SMA': {
          const period = params?.period ?? 20
          const value = calculateSMA(closes, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for SMA' }
          }
          return { name, values: { sma: value, period }, timestamp, calculated: true }
        }

        case 'EMA': {
          const period = params?.period ?? 20
          const value = calculateEMA(closes, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for EMA' }
          }
          return { name, values: { ema: value, period }, timestamp, calculated: true }
        }

        case 'RSI': {
          const period = params?.period ?? 14
          const value = calculateRSI(closes, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for RSI' }
          }
          return { name, values: { rsi: value, period }, timestamp, calculated: true }
        }

        case 'MACD': {
          const fastPeriod = params?.fastPeriod ?? 12
          const slowPeriod = params?.slowPeriod ?? 26
          const signalPeriod = params?.signalPeriod ?? 9
          const { macdLine, signalLine, histogram } = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod)
          if (macdLine === null || signalLine === null || histogram === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for MACD' }
          }
          return {
            name,
            values: { macdLine, signalLine, histogram, fastPeriod, slowPeriod, signalPeriod },
            timestamp,
            calculated: true,
          }
        }

        case 'ATR': {
          const period = params?.period ?? 14
          const value = calculateATR(bars, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for ATR' }
          }
          return { name, values: { atr: value, period }, timestamp, calculated: true }
        }

        case 'BOLLINGER': {
          const period = params?.period ?? 20
          const stdDev = params?.stdDev ?? 2
          const { upper, middle, lower, bandwidth, percentB } = calculateBollingerBands(closes, period, stdDev)
          if (upper === null || middle === null || lower === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for Bollinger Bands' }
          }
          return {
            name,
            values: {
              upper,
              middle,
              lower,
              bandwidth: bandwidth ?? 0,
              percentB: percentB ?? 0,
              period,
              stdDev,
            },
            timestamp,
            calculated: true,
          }
        }

        case 'STOCHASTIC': {
          const kPeriod = params?.kPeriod ?? 14
          const dPeriod = params?.dPeriod ?? 3
          const { k, d } = calculateStochastic(bars, kPeriod, dPeriod)
          if (k === null || d === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for Stochastic' }
          }
          return { name, values: { k, d, kPeriod, dPeriod }, timestamp, calculated: true }
        }

        case 'ADX': {
          const period = params?.period ?? 14
          const { adx, plusDi, minusDi } = calculateADX(bars, period)
          if (adx === null || plusDi === null || minusDi === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for ADX' }
          }
          return { name, values: { adx, plusDi, minusDi, period }, timestamp, calculated: true }
        }

        case 'VWAP': {
          const { vwap, cumulativeVolume } = calculateVWAP(bars)
          if (vwap === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for VWAP' }
          }
          return { name, values: { vwap, cumulativeVolume }, timestamp, calculated: true }
        }

        case 'PIVOT_POINTS': {
          const numPeriods = params?.numPeriods ?? 1
          const fibonacci = params?.fibonacci === 1
          const pp = calculatePivotPoints(bars, numPeriods, fibonacci)
          if (pp === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for Pivot Points' }
          }
          return {
            name,
            values: { pivot: pp.pivot, r1: pp.r1, r2: pp.r2, r3: pp.r3, s1: pp.s1, s2: pp.s2, s3: pp.s3 },
            timestamp,
            calculated: true,
          }
        }

        default: {
          const _exhaustive: never = name
          return { name: _exhaustive, values: {}, timestamp, calculated: false, error: `Unknown indicator: ${String(name)}` }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('INDICATOR_POOL', `Indicator computation failed: ${name}`, {
        source: 'IndicatorPool',
        details: message,
      })
      return { name, values: {}, timestamp, calculated: false, error: message }
    }
  }

  /** Clear all cached indicator results */
  clearCache(): void {
    const size = this.cache.size
    this.cache.clear()
    logger.info('INDICATOR_POOL', 'IndicatorPool cache cleared', { source: 'IndicatorPool', details: `removed=${size} entries` })
  }

  /** Get cache statistics */
  getCacheStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    }
  }

  /**
   * Validate input bar data for indicator computation.
   * Checks: bars sorted ASC by openTime, sufficient data, no NaN/null/negative prices.
   */
  validateInput(bars: OHLCVSeries, minBars: number): { valid: boolean; error?: string } {
    if (!bars || bars.length === 0) {
      return { valid: false, error: 'No bar data provided' }
    }

    if (bars.length < minBars) {
      return { valid: false, error: `Insufficient bars: need ${minBars}, got ${bars.length}` }
    }

    // Check ascending sort by openTime
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].openTime.getTime() <= bars[i - 1].openTime.getTime()) {
        return {
          valid: false,
          error: `Bars not sorted ASC at index ${i}: bars[${i - 1}].openTime=${bars[i - 1].openTime.toISOString()} >= bars[${i}].openTime=${bars[i].openTime.toISOString()}`,
        }
      }
    }

    // Check for valid price data
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]
      if (!isValidPrice(bar.open)) {
        return { valid: false, error: `Invalid open price at bar ${i}: ${bar.open}` }
      }
      if (!isValidPrice(bar.high)) {
        return { valid: false, error: `Invalid high price at bar ${i}: ${bar.high}` }
      }
      if (!isValidPrice(bar.low)) {
        return { valid: false, error: `Invalid low price at bar ${i}: ${bar.low}` }
      }
      if (!isValidPrice(bar.close)) {
        return { valid: false, error: `Invalid close price at bar ${i}: ${bar.close}` }
      }
      if (bar.volume < 0) {
        return { valid: false, error: `Invalid volume at bar ${i}: ${bar.volume}` }
      }
    }

    return { valid: true }
  }
}

// ============================================
// CANDLE DATA MANAGEMENT FUNCTIONS
// ============================================

/**
 * Fetch candle data from the database, sorted ASC by openTime.
 * @param symbol - Stock symbol (e.g., 'BBRI')
 * @param timeframe - Timeframe string (e.g., 'M5', 'H1')
 * @param limit - Maximum number of candles to fetch (default 200)
 */
export async function fetchCandles(
  symbol: string,
  timeframe: string,
  limit: number = 200
): Promise<OHLCVBar[]> {
  try {
    const rows = await db.candleData.findMany({
      where: { symbol, timeframe },
      orderBy: { openTime: 'desc' },
      take: limit,
    })

    // Reverse to ASC order (oldest first) as required by indicators
    const bars: OHLCVBar[] = rows.reverse().map((row) => ({
      openTime: row.openTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }))

    logger.debug('INDICATOR_POOL', `Fetched ${bars.length} candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: `timeframe=${timeframe}, limit=${limit}, returned=${bars.length}`,
    })

    return bars
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('INDICATOR_POOL', `Failed to fetch candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: message,
    })
    return []
  }
}

/**
 * Store (upsert) candle data into the database.
 * Uses the unique constraint [symbol, timeframe, openTime] for upsert.
 *
 * @param symbol - Stock symbol
 * @param timeframe - Timeframe string
 * @param bars - Array of OHLCV bars to store
 * @returns Number of bars stored
 */
export async function storeCandles(
  symbol: string,
  timeframe: string,
  bars: OHLCVBar[]
): Promise<number> {
  if (!bars || bars.length === 0) return 0

  let stored = 0

  try {
    // Upsert in batches to avoid overwhelming SQLite
    const BATCH_SIZE = 50
    for (let i = 0; i < bars.length; i += BATCH_SIZE) {
      const batch = bars.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map((bar) =>
          db.candleData.upsert({
            where: {
              symbol_timeframe_openTime: {
                symbol,
                timeframe,
                openTime: bar.openTime,
              },
            },
            create: {
              symbol,
              timeframe,
              openTime: bar.openTime,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
            update: {
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
          })
        )
      )

      stored += batch.length
    }

    logger.info('INDICATOR_POOL', `Stored ${stored} candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: `timeframe=${timeframe}, batched=${Math.ceil(bars.length / BATCH_SIZE)}`,
    })

    return stored
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('INDICATOR_POOL', `Failed to store candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: message,
    })
    return stored
  }
}

/**
 * Generate realistic mock OHLCV candle data for testing.
 * Uses a random walk with realistic volatility — no Math.sin.
 * Base price is taken from SYMBOL_MAP if available, otherwise defaults to 5000.
 *
 * @param symbol - Stock symbol
 * @param timeframe - Timeframe string
 * @param count - Number of candles to generate (default 200)
 */
export function generateMockCandles(
  symbol: string,
  timeframe: string,
  count: number = 200
): OHLCVBar[] {
  // Determine base price from SYMBOL_MAP or use default
  // Default base price for unknown symbols (known symbols use knownPrices below)
  const basePrice = 5000

  // For well-known stocks, use approximate real-world base prices
  const knownPrices: Record<string, number> = {
    BBRI: 4600,
    BBCA: 9800,
    BMRI: 6200,
    BBNI: 4800,
    BRIS: 2600,
    TLKM: 3900,
    ASII: 5100,
    UNVR: 2600,
    GOTO: 70,
    ANTM: 1600,
    ADRO: 2900,
    PGAS: 1600,
  }

  const price = knownPrices[symbol] ?? basePrice
  const volatility = price * 0.015 // 1.5% per-bar volatility for IDX stocks
  const tfMs = getTimeframeMs(timeframe)
  const now = new Date()

  const bars: OHLCVBar[] = []
  let currentPrice = price

  // Seeded-ish random using multiple Math.random calls for variety
  for (let i = 0; i < count; i++) {
    const openTime = new Date(now.getTime() - (count - i) * tfMs)

    // Random walk components
    const trend = (Math.random() - 0.495) * volatility * 0.3 // Slight upward bias
    const noise = (Math.random() - 0.5) * volatility * 2

    // Gap from previous close
    const gap = (Math.random() - 0.5) * volatility * 0.1
    const open = currentPrice + gap

    // Body direction
    const direction = Math.random() > 0.48 ? 1 : -1 // Slight bullish bias
    const bodySize = Math.random() * volatility * 0.8
    const close = open + direction * bodySize + trend

    // High and Low
    const upperWick = Math.random() * volatility * 0.5
    const lowerWick = Math.random() * volatility * 0.5
    const high = Math.max(open, close) + upperWick
    const low = Math.min(open, close) - lowerWick

    // Ensure positive prices
    const finalOpen = Math.max(open, 1)
    const finalHigh = Math.max(high, finalOpen, 1)
    const finalLow = Math.max(low, 1)
    const finalClose = Math.max(close, 1)

    // Realistic volume: 100k to 10M with some variation
    const baseVolume = 500_000
    const volumeVariation = Math.random() * 9_500_000
    const volume = Math.floor(baseVolume + volumeVariation)

    bars.push({
      openTime,
      open: parseFloat(finalOpen.toFixed(2)),
      high: parseFloat(finalHigh.toFixed(2)),
      low: parseFloat(finalLow.toFixed(2)),
      close: parseFloat(finalClose.toFixed(2)),
      volume,
    })

    currentPrice = finalClose
  }

  logger.debug('INDICATOR_POOL', `Generated ${count} mock candles for ${symbol} ${timeframe}`, {
    source: 'IndicatorPool',
    symbol,
    details: `timeframe=${timeframe}, basePrice=${price}`,
  })

  return bars
}

/**
 * Convert a timeframe string to milliseconds.
 * Supported: M1, M5, M15, H1, H4, D1
 */
export function getTimeframeMs(timeframe: string): number {
  const map: Record<string, number> = {
    M1: 60_000,
    M5: 300_000,
    M15: 900_000,
    H1: 3_600_000,
    H4: 14_400_000,
    D1: 86_400_000,
  }
  const ms = map[timeframe.toUpperCase()]
  if (ms === undefined) {
    logger.warn('INDICATOR_POOL', `Unknown timeframe: ${timeframe}, defaulting to M5`, { source: 'IndicatorPool' })
    return 300_000
  }
  return ms
}

// ============================================
// STRATEGY SIGNAL GENERATION
// ============================================

/**
 * Compute a strategy signal using real indicator logic.
 *
 * @param strategyId - Strategy identifier
 * @param bars - OHLCV bar data
 * @returns Signal with direction, confidence, strength, and used indicator values
 */
export function computeStrategySignal(
  strategyId: string,
  bars: OHLCVBar[]
): StrategySignal {
  const emptyResult: StrategySignal = {
    signal: 'NEUTRAL',
    confidence: 0,
    strength: 0,
    indicators: [],
  }

  if (!bars || bars.length < 30) {
    return { ...emptyResult, indicators: [{
      name: 'SMA',
      values: {},
      timestamp: new Date(),
      calculated: false,
      error: `Insufficient data for ${strategyId}: need 30+ bars, got ${bars?.length ?? 0}`,
    }] }
  }

  const closes = bars.map((b) => b.close)
  const currentPrice = closes[closes.length - 1]
  const pool = new IndicatorPool(0) // No caching for single-shot computation

  try {
    switch (strategyId) {
      // ------------------------------------------
      // MA Ribbon: EMA ribbon (10, 20, 30, 50, 100)
      // ------------------------------------------
      case 'ma-ribbon': {
        const periods = [10, 20, 30, 50, 100]
        const emaResults: IndicatorResult[] = []
        const emas: number[] = []

        for (const period of periods) {
          const result = pool.computeSingle('EMA', bars, { period })
          emaResults.push(result)
          if (result.calculated && result.values.ema) {
            emas.push(result.values.ema)
          }
        }

        if (emas.length < periods.length) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators: emaResults }
        }

        // emas is ordered fast→slow [EMA10, EMA20, EMA30, EMA50, EMA100].
        // BULLISH stacking = fast above slow → array values descend.
        // BEARISH stacking = slow above fast → array values ascend.
        const bullishStack = emas.every((val, i) => i === 0 || val < emas[i - 1])
        const bearishStack = emas.every((val, i) => i === 0 || val > emas[i - 1])

        // Also check price is above/below the ribbon
        const priceAboveRibbon = currentPrice > emas[emas.length - 1] // above slowest
        const priceBelowRibbon = currentPrice < emas[emas.length - 1] // below slowest

        if (bullishStack && priceAboveRibbon) {
          // Count how many are properly ordered — stronger signal when more aligned
          const alignment = emas.filter((val, i) => i === 0 || val < emas[i - 1]).length
          const strength = alignment / emas.length
          return {
            signal: 'BUY',
            confidence: Math.min(85, 50 + strength * 35),
            strength,
            indicators: emaResults,
          }
        }

        if (bearishStack && priceBelowRibbon) {
          const alignment = emas.filter((val, i) => i === 0 || val > emas[i - 1]).length
          const strength = alignment / emas.length
          return {
            signal: 'SELL',
            confidence: Math.min(85, 50 + strength * 35),
            strength,
            indicators: emaResults,
          }
        }

        return { signal: 'NEUTRAL', confidence: 30, strength: 0.2, indicators: emaResults }
      }

      // ------------------------------------------
      // Momentum Scalp: RSI(14) + MACD
      // ------------------------------------------
      case 'momentum-scalp': {
        const rsiResult = pool.computeSingle('RSI', bars, { period: 14 })
        const macdResult = pool.computeSingle('MACD', bars)
        const indicators = [rsiResult, macdResult]

        if (!rsiResult.calculated || !macdResult.calculated) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }
        }

        const rsi = rsiResult.values.rsi
        const histogram = macdResult.values.histogram
        const prevRsi = calculateRSI(closes.slice(0, -1), 14)

        // BUY: RSI crosses above 30 (oversold) and MACD histogram > 0
        if (prevRsi !== null && prevRsi < 30 && rsi >= 30 && histogram > 0) {
          return {
            signal: 'BUY',
            confidence: Math.min(80, 55 + (30 - prevRsi)),
            strength: Math.min(1, (histogram / (Math.abs(histogram) + 0.001)) * 0.8 + 0.2),
            indicators,
          }
        }

        // SELL: RSI crosses below 70 (overbought) and MACD histogram < 0
        if (prevRsi !== null && prevRsi > 70 && rsi <= 70 && histogram < 0) {
          return {
            signal: 'SELL',
            confidence: Math.min(80, 55 + (prevRsi - 70)),
            strength: Math.min(1, (Math.abs(histogram) / (Math.abs(histogram) + 0.001)) * 0.8 + 0.2),
            indicators,
          }
        }

        // Weaker signals: RSI approaching extremes with MACD confirmation
        if (rsi < 35 && histogram > 0) {
          return { signal: 'BUY', confidence: 45, strength: 0.3, indicators }
        }
        if (rsi > 65 && histogram < 0) {
          return { signal: 'SELL', confidence: 45, strength: 0.3, indicators }
        }

        return { signal: 'NEUTRAL', confidence: 20, strength: 0.1, indicators }
      }

      // ------------------------------------------
      // Pivot Point: Buy near support, sell near resistance
      // ------------------------------------------
      case 'pivot-point': {
        const pivotResult = pool.computeSingle('PIVOT_POINTS', bars, { numPeriods: 1, fibonacci: 0 })
        const indicators = [pivotResult]

        if (!pivotResult.calculated) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }
        }

        const { pivot, r1, r2, s1, s2 } = pivotResult.values
        const ppRange = r1 - s1
        if (ppRange === 0) return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }

        // BUY near S1/S2 with bounce (price within 0.5% of support and closing higher)
        const distToS1 = Math.abs(currentPrice - s1) / s1
        const distToS2 = Math.abs(currentPrice - s2) / s2
        const prevClose = closes[closes.length - 2]
        const bouncingUp = currentPrice > prevClose

        if (distToS1 < 0.005 && bouncingUp) {
          return {
            signal: 'BUY',
            confidence: 70,
            strength: Math.max(0.3, 1 - distToS1 / 0.005),
            indicators,
          }
        }
        if (distToS2 < 0.005 && bouncingUp) {
          return {
            signal: 'BUY',
            confidence: 65,
            strength: Math.max(0.3, 1 - distToS2 / 0.005),
            indicators,
          }
        }

        // SELL near R1/R2 with rejection (price within 0.5% of resistance and closing lower)
        const distToR1 = Math.abs(currentPrice - r1) / r1
        const distToR2 = Math.abs(currentPrice - r2) / r2
        const rejectingDown = currentPrice < prevClose

        if (distToR1 < 0.005 && rejectingDown) {
          return {
            signal: 'SELL',
            confidence: 70,
            strength: Math.max(0.3, 1 - distToR1 / 0.005),
            indicators,
          }
        }
        if (distToR2 < 0.005 && rejectingDown) {
          return {
            signal: 'SELL',
            confidence: 65,
            strength: Math.max(0.3, 1 - distToR2 / 0.005),
            indicators,
          }
        }

        // Weak directional bias based on price vs pivot
        if (currentPrice > pivot && currentPrice < r1) {
          return { signal: 'BUY', confidence: 35, strength: 0.2, indicators }
        }
        if (currentPrice < pivot && currentPrice > s1) {
          return { signal: 'SELL', confidence: 35, strength: 0.2, indicators }
        }

        return { signal: 'NEUTRAL', confidence: 25, strength: 0.1, indicators }
      }

      // ------------------------------------------
      // EMA Crossover: EMA(9) x EMA(21)
      // ------------------------------------------
      case 'ema-crossover': {
        const ema9Result = pool.computeSingle('EMA', bars, { period: 9 })
        const ema21Result = pool.computeSingle('EMA', bars, { period: 21 })
        const indicators = [ema9Result, ema21Result]

        if (!ema9Result.calculated || !ema21Result.calculated) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }
        }

        const currentEma9 = ema9Result.values.ema
        const currentEma21 = ema21Result.values.ema

        // Previous EMAs for crossover detection
        const prevCloses = closes.slice(0, -1)
 const prevEma9 = calculateEMA(prevCloses, 9)
        const prevEma21 = calculateEMA(prevCloses, 21)

        if (prevEma9 === null || prevEma21 === null) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }
        }

        // Golden cross: fast EMA crosses above slow EMA
        const goldenCross = prevEma9 <= prevEma21 && currentEma9 > currentEma21
        // Death cross: fast EMA crosses below slow EMA
        const deathCross = prevEma9 >= prevEma21 && currentEma9 < currentEma21

        if (goldenCross) {
          const spread = (currentEma9 - currentEma21) / currentEma21
          return {
            signal: 'BUY',
            confidence: Math.min(80, 60 + Math.abs(spread) * 500),
            strength: Math.min(1, Math.abs(spread) * 100 + 0.3),
            indicators,
          }
        }

        if (deathCross) {
          const spread = (currentEma21 - currentEma9) / currentEma21
          return {
            signal: 'SELL',
            confidence: Math.min(80, 60 + Math.abs(spread) * 500),
            strength: Math.min(1, Math.abs(spread) * 100 + 0.3),
            indicators,
          }
        }

        // Trending above/below
        if (currentEma9 > currentEma21) {
          return { signal: 'BUY', confidence: 40, strength: 0.3, indicators }
        }
        if (currentEma9 < currentEma21) {
          return { signal: 'SELL', confidence: 40, strength: 0.3, indicators }
        }

        return { signal: 'NEUTRAL', confidence: 20, strength: 0.1, indicators }
      }

      // ------------------------------------------
      // RMI Trend Sync: RSI momentum + ADX trend strength
      // ------------------------------------------
      case 'rmi-trend-sync': {
        const rsiResult = pool.computeSingle('RSI', bars, { period: 14 })
        const adxResult = pool.computeSingle('ADX', bars, { period: 14 })
        const indicators = [rsiResult, adxResult]

        if (!rsiResult.calculated || !adxResult.calculated) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }
        }

        const rsi = rsiResult.values.rsi
        const { adx, plusDi, minusDi } = adxResult.values
        const prevRsi = calculateRSI(closes.slice(0, -1), 14)

        // BUY: RSI rising from oversold (<40) + ADX > 25 (strong trend) + bullish DI
        if (prevRsi !== null && rsi > prevRsi && prevRsi < 40 && adx > 25 && plusDi > minusDi) {
          const adxStrength = Math.min(1, (adx - 25) / 25)
          const rsiMomentum = Math.min(1, (rsi - prevRsi) / 5)
          return {
            signal: 'BUY',
            confidence: Math.min(85, 55 + adx * 0.3 + rsiMomentum * 15),
            strength: adxStrength * 0.6 + rsiMomentum * 0.4,
            indicators,
          }
        }

        // SELL: RSI falling from overbought (>60) + ADX > 25 + bearish DI
        if (prevRsi !== null && rsi < prevRsi && prevRsi > 60 && adx > 25 && minusDi > plusDi) {
          const adxStrength = Math.min(1, (adx - 25) / 25)
          const rsiMomentum = Math.min(1, (prevRsi - rsi) / 5)
          return {
            signal: 'SELL',
            confidence: Math.min(85, 55 + adx * 0.3 + rsiMomentum * 15),
            strength: adxStrength * 0.6 + rsiMomentum * 0.4,
            indicators,
          }
        }

        // Weak signals
        if (rsi < 35 && plusDi > minusDi && adx > 20) {
          return { signal: 'BUY', confidence: 40, strength: 0.25, indicators }
        }
        if (rsi > 65 && minusDi > plusDi && adx > 20) {
          return { signal: 'SELL', confidence: 40, strength: 0.25, indicators }
        }

        return { signal: 'NEUTRAL', confidence: 20, strength: 0.1, indicators }
      }

      // ------------------------------------------
      // Linear Regression: Bollinger Bands mean reversion
      // ------------------------------------------
      case 'linear-regression': {
        const bollResult = pool.computeSingle('BOLLINGER', bars, { period: 20, stdDev: 2 })
        const indicators = [bollResult]

        if (!bollResult.calculated) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }
        }

        const { upper, middle, lower, percentB } = bollResult.values

        // BUY at lower band (%B < 0.1 — price near or below lower band)
        if (percentB < 0.1) {
          return {
            signal: 'BUY',
            confidence: Math.min(80, 55 + (0.1 - percentB) * 250),
            strength: Math.max(0.3, 1 - percentB / 0.1),
            indicators,
          }
        }

        // SELL at upper band (%B > 0.9 — price near or above upper band)
        if (percentB > 0.9) {
          return {
            signal: 'SELL',
            confidence: Math.min(80, 55 + (percentB - 0.9) * 250),
            strength: Math.max(0.3, (percentB - 0.9) / 0.1),
            indicators,
          }
        }

        // Moderate signals near bands
        if (percentB < 0.25) {
          return { signal: 'BUY', confidence: 40, strength: 0.25, indicators }
        }
        if (percentB > 0.75) {
          return { signal: 'SELL', confidence: 40, strength: 0.25, indicators }
        }

        // Mid-band: neutral
        return { signal: 'NEUTRAL', confidence: 20, strength: 0.1, indicators }
      }

      // ------------------------------------------
      // EMA-RSI Filter: EMA(50) trend + RSI(14) filter
      // ------------------------------------------
      case 'ema-rsi-filter': {
        const ema50Result = pool.computeSingle('EMA', bars, { period: 50 })
        const rsiResult = pool.computeSingle('RSI', bars, { period: 14 })
        const indicators = [ema50Result, rsiResult]

        if (!ema50Result.calculated || !rsiResult.calculated) {
          return { signal: 'NEUTRAL', confidence: 0, strength: 0, indicators }
        }

        const ema50 = ema50Result.values.ema
        const rsi = rsiResult.values.rsi

        // BUY: price > EMA(50) and RSI in 40-60 (neutral momentum, trend continuation)
        if (currentPrice > ema50 && rsi >= 40 && rsi <= 60) {
          const trendStrength = (currentPrice - ema50) / ema50
          return {
            signal: 'BUY',
            confidence: Math.min(75, 50 + (1 - Math.abs(rsi - 50) / 10) * 25),
            strength: Math.min(0.8, Math.abs(trendStrength) * 50 + 0.2),
            indicators,
          }
        }

        // SELL: price < EMA(50) and RSI in 40-60
        if (currentPrice < ema50 && rsi >= 40 && rsi <= 60) {
          const trendStrength = (ema50 - currentPrice) / ema50
          return {
            signal: 'SELL',
            confidence: Math.min(75, 50 + (1 - Math.abs(rsi - 50) / 10) * 25),
            strength: Math.min(0.8, Math.abs(trendStrength) * 50 + 0.2),
            indicators,
          }
        }

        // Weaker pullback signals
        if (currentPrice > ema50 && rsi < 40) {
          return { signal: 'BUY', confidence: 45, strength: 0.3, indicators }
        }
        if (currentPrice < ema50 && rsi > 60) {
          return { signal: 'SELL', confidence: 45, strength: 0.3, indicators }
        }

        return { signal: 'NEUTRAL', confidence: 20, strength: 0.1, indicators }
      }

      default:
        logger.warn('INDICATOR_POOL', `Unknown strategy: ${strategyId}`, { source: 'IndicatorPool' })
        return emptyResult
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('INDICATOR_POOL', `Strategy signal computation failed: ${strategyId}`, {
      source: 'IndicatorPool',
      details: message,
    })
    return { ...emptyResult, indicators: [{
      name: 'SMA',
      values: {},
      timestamp: new Date(),
      calculated: false,
      error: message,
    }] }
  }
}

// ============================================
// INDICATOR SNAPSHOT FOR TRADE
// ============================================

/**
 * Capture a full indicator snapshot for a trade.
 * Computes all 10 indicators and returns them as a JSON string
 * suitable for storage in Trade.indicatorSnapshot.
 *
 * @param symbol - Stock symbol
 * @param bars - OHLCV bar data
 * @returns JSON string of all indicator values
 */
export function captureIndicatorSnapshot(symbol: string, bars: OHLCVBar[]): string {
  const pool = new IndicatorPool(0) // No caching for snapshot
  const allIndicators: IndicatorConfig[] = [
    { name: 'SMA', params: { period: 20 } },
    { name: 'EMA', params: { period: 20 } },
    { name: 'RSI', params: { period: 14 } },
    { name: 'MACD' },
    { name: 'ATR', params: { period: 14 } },
    { name: 'BOLLINGER', params: { period: 20, stdDev: 2 } },
    { name: 'STOCHASTIC', params: { kPeriod: 14, dPeriod: 3 } },
    { name: 'ADX', params: { period: 14 } },
    { name: 'VWAP' },
    { name: 'PIVOT_POINTS' },
  ]

  const snapshot: Record<string, Record<string, number>> = {
    _meta: {
      symbol: symbol as unknown as number,
      capturedAt: new Date().getTime(),
      barCount: bars.length,
      lastPrice: bars.length > 0 ? bars[bars.length - 1].close : 0,
    },
  }

  for (const config of allIndicators) {
    const result = pool.computeSingle(config.name, bars, config.params)
    if (result.calculated) {
      snapshot[config.name] = { ...result.values }
    }
  }

  const json = JSON.stringify(snapshot)
  logger.debug('INDICATOR_POOL', `Captured indicator snapshot for ${symbol}`, {
    source: 'IndicatorPool',
    symbol,
    details: `indicators=${Object.keys(snapshot).length - 1}, size=${json.length}bytes`,
  })

  return json
}

/**
 * Parse an indicator snapshot JSON string back into a structured object.
 *
 * @param json - JSON string from captureIndicatorSnapshot
 * @returns Record of indicator name to values
 */
export function parseIndicatorSnapshot(json: string): Record<string, Record<string, number>> {
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) {
      logger.warn('INDICATOR_POOL', 'Invalid indicator snapshot JSON: not an object', { source: 'IndicatorPool' })
      return {}
    }
    return parsed as Record<string, Record<string, number>>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('INDICATOR_POOL', 'Failed to parse indicator snapshot JSON', {
      source: 'IndicatorPool',
      details: message,
    })
    return {}
  }
}
