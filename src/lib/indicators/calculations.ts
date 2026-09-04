/**
 * CORE CALCULATION FUNCTIONS — split from src/lib/indicator-pool.ts (v2.1.0 refactor).
 * Pure indicator math: SMA, EMA, RSI, MACD, ATR, Bollinger, Stochastic, ADX,
 * VWAP, Pivot Points.
 */

import { FIB_LEVELS, type OHLCVBar } from './types'
import { isValidPrice, standardDeviation } from './helpers'

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
