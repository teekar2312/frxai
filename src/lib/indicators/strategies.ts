/**
 * STRATEGY SIGNAL GENERATION — split from src/lib/indicator-pool.ts (v2.1.0 refactor).
 * computeStrategySignal — real indicator logic per strategy id.
 */

import logger from '@/lib/trading-logger'
import { IndicatorPool } from './pool'
import { calculateEMA, calculateRSI } from './calculations'
import type { IndicatorResult, OHLCVBar, StrategySignal } from './types'

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
