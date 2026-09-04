import logger from '@/lib/trading-logger'
// Fix #17: Integrate with indicator-pool for real technical data
// Fix 1 (Task 7): Added missing OHLCVBar type import
import { fetchCandles, calculateRSI, calculateMACD, calculateBollingerBands, calculateADX, calculateATR, calculateStochastic, calculateEMA, type OHLCVBar } from '@/lib/indicator-pool'
import { DEFAULT_TIMEFRAME, type TechnicalFactors, type IndicatorSignal } from './types'
import { defaultTechnicalFactors, mapRange, clamp, seededRandom } from './helpers'

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
function analyzeTechnicalFromBars(_symbol: string, bars: OHLCVBar[], _timeframe: string): TechnicalFactors {
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
    factors.adxValue = adx.adx !== null ? Math.round(adx.adx) : 0
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
    const ema20 = calculateEMA(closes, 20) ?? closes.slice(-20).reduce((s, c) => s + c, 0) / Math.min(20, closes.length)
    const ema50 = calculateEMA(closes, 50) ?? closes.slice(-50).reduce((s, c) => s + c, 0) / Math.min(50, closes.length)
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
function analyzeTechnicalFactorsMock(symbol: string, _timeframe: string = DEFAULT_TIMEFRAME): TechnicalFactors {
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
