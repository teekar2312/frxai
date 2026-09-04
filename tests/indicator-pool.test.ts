/**
 * Unit tests — src/lib/indicator-pool.ts (Batch B / Task 5-b)
 * ============================================================
 * Covers the pure indicator math (SMA, EMA, EMA series, RSI, MACD, ATR,
 * Bollinger, Stochastic, ADX, VWAP, Pivot Points), the timeframe helper,
 * the caching IndicatorPool class, snapshot (de)serialisation and the
 * strategy-signal guard clause — all with small datasets that can be
 * verified by hand.
 *
 * All functions under test are pure (no DB); IndicatorPool.compute() is
 * async but only touches its in-memory cache.
 */
import { describe, test, expect } from 'bun:test'
import {
  calculateSMA,
  calculateEMA,
  calculateEMASeries,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateStochastic,
  calculateADX,
  calculateVWAP,
  calculatePivotPoints,
  getTimeframeMs,
  IndicatorPool,
  captureIndicatorSnapshot,
  parseIndicatorSnapshot,
  computeStrategySignal,
  generateMockCandles,
} from '../src/lib/indicator-pool'
import type { OHLCVBar } from '../src/lib/indicator-pool'

// ---- helpers ---------------------------------------------------------------

const bar = (o: number, h: number, l: number, c: number, v = 100, i = 0): OHLCVBar => ({
  openTime: new Date(Date.UTC(2024, 0, 1, 0, i)),
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
})

const range = (from: number, to: number, step = 1): number[] => {
  const out: number[] = []
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v)
  return out
}

const alternating = (n: number, lo: number, hi: number): number[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? lo : hi))

// ============================================================================
// SMA
// ============================================================================

describe('calculateSMA', () => {
  test('[1..5] with period 5 → 3', () => {
    expect(calculateSMA([1, 2, 3, 4, 5], 5)).toBe(3)
  })

  test('uses the LAST `period` values of the series', () => {
    expect(calculateSMA([10, 20, 30, 40, 50], 2)).toBe(45)
    expect(calculateSMA([1, 2, 3, 4, 5], 3)).toBe(4)
  })

  test('insufficient data / bad period → null', () => {
    expect(calculateSMA([1, 2], 5)).toBeNull()
    expect(calculateSMA([], 5)).toBeNull()
    expect(calculateSMA([1, 2, 3], 0)).toBeNull()
    expect(calculateSMA([1, 2, 3], -2)).toBeNull()
  })

  test('NaN or non-positive prices in the window → null', () => {
    expect(calculateSMA([1, NaN, 3, 4, 5], 5)).toBeNull()
    expect(calculateSMA([1, 0, 3, 4, 5], 5)).toBeNull()
    expect(calculateSMA([1, -1, 3, 4, 5], 5)).toBeNull()
  })
})

// ============================================================================
// EMA
// ============================================================================

describe('calculateEMA', () => {
  test('seed = SMA of first period, then k-recurrence (exact values)', () => {
    // period 3: k = 0.5; seed = 2 → 4*0.5 + 2*0.5 = 3 → 5*0.5 + 3*0.5 = 4
    expect(calculateEMA([1, 2, 3, 4, 5], 3)).toBe(4)
    // period 5: only the seed applies
    expect(calculateEMA([1, 2, 3, 4, 5], 5)).toBe(3)
  })

  test('insufficient data → null', () => {
    expect(calculateEMA([1, 2], 3)).toBeNull()
    expect(calculateEMA([], 5)).toBeNull()
  })

  test('converges to the level of a long constant series', () => {
    expect(calculateEMA(Array(100).fill(100), 5)).toBe(100)
    expect(calculateEMA(Array(100).fill(100), 20)).toBeCloseTo(100, 10)
  })

  test('EMA series: null-padded for the first period-1 entries', () => {
    expect(calculateEMASeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
    expect(calculateEMASeries([1, 2], 3)).toEqual([null, null])
  })
})

// ============================================================================
// RSI
// ============================================================================

describe('calculateRSI', () => {
  test('monotonically rising closes → 100 (no losses)', () => {
    expect(calculateRSI(range(1, 20), 14)).toBe(100)
  })

  test('monotonically falling closes → 0 (no gains)', () => {
    expect(calculateRSI(range(20, 1, -1), 14)).toBe(0)
  })

  test('alternating equal up/down closes → RSI near 50', () => {
    const rsi = calculateRSI(alternating(20, 99, 101), 14)
    expect(rsi).not.toBeNull()
    expect(rsi as number).toBeGreaterThan(40)
    expect(rsi as number).toBeLessThan(60)
  })

  test('insufficient data (needs period+1 closes) → null', () => {
    expect(calculateRSI([1, 2, 3], 14)).toBeNull()
    expect(calculateRSI(range(1, 14), 14)).toBeNull() // exactly 14 → null
    expect(calculateRSI(range(1, 15), 14)).not.toBeNull()
  })

  test('flat closes → returns 50 (neutral — fixed from buggy 100)', () => {
    // When avgGain === 0 AND avgLoss === 0 (no movement), the convention is
    // neutral 50. Same fix applied to the backtest-engine Rsi class.
    expect(calculateRSI([5, 5, 5, 5, 5], 3)).toBe(50)
  })
})

// ============================================================================
// MACD
// ============================================================================

describe('calculateMACD', () => {
  test('insufficient data (needs slow + signal closes) → all null', () => {
    expect(calculateMACD([1, 2, 3], 12, 26, 9)).toEqual({
      macdLine: null,
      signalLine: null,
      histogram: null,
    })
    expect(calculateMACD(range(1, 30), 12, 26, 9).macdLine).toBeNull()
  })

  test('histogram = macdLine - signalLine', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 8 + i * 0.2)
    const m = calculateMACD(closes, 12, 26, 9)
    expect(m.macdLine).not.toBeNull()
    expect(m.signalLine).not.toBeNull()
    expect(m.histogram).not.toBeNull()
    expect(m.histogram).toBeCloseTo((m.macdLine as number) - (m.signalLine as number), 10)
  })

  test('strong uptrend → positive MACD line (fast EMA above slow EMA)', () => {
    const m = calculateMACD(range(100, 160), 12, 26, 9)
    expect(m.macdLine as number).toBeGreaterThan(0)
  })
})

// ============================================================================
// ATR
// ============================================================================

describe('calculateATR', () => {
  const identical = Array.from({ length: 5 }, () => bar(9, 10, 8, 9))

  test('identical bars → TR = high - low = 2', () => {
    expect(calculateATR(identical, 3)).toBe(2)
  })

  test('true range accounts for gaps vs previous close', () => {
    // bar 2 gaps down: high 5, low 4, prev close 9 → TR = max(1, |5-9|, |4-9|) = 5
    const bars = [bar(9, 10, 8, 9), bar(5, 5, 4, 4.5)]
    expect(calculateATR(bars, 1)).toBe(5)
  })

  test('insufficient data (needs period+1 bars) → null', () => {
    expect(calculateATR(identical.slice(0, 3), 3)).toBeNull()
    expect(calculateATR(identical, 14)).toBeNull()
  })
})

// ============================================================================
// BOLLINGER BANDS
// ============================================================================

describe('calculateBollingerBands', () => {
  test('[1,2,3,4] period 4 × 2σ → middle 2.5, upper/lower = 2.5 ± 2·sqrt(1.25)', () => {
    const b = calculateBollingerBands([1, 2, 3, 4], 4, 2)
    expect(b.middle).toBe(2.5)
    expect(b.upper).toBeCloseTo(2.5 + 2 * Math.sqrt(1.25), 10)
    expect(b.lower).toBeCloseTo(2.5 - 2 * Math.sqrt(1.25), 10)
    expect(b.bandwidth).toBeCloseTo((4 * Math.sqrt(1.25)) / 2.5, 10)
    // last close 4 → %B = (4 - lower) / (upper - lower)
    expect(b.percentB).toBeCloseTo((4 - (2.5 - 2 * Math.sqrt(1.25))) / (4 * Math.sqrt(1.25)), 10)
  })

  test('flat data → upper = middle = lower, zero bandwidth, %B null', () => {
    const b = calculateBollingerBands([50, 50, 50, 50], 4, 2)
    expect(b.upper).toBe(50)
    expect(b.middle).toBe(50)
    expect(b.lower).toBe(50)
    expect(b.bandwidth).toBe(0)
    expect(b.percentB).toBeNull()
  })

  test('insufficient data / bad multiplier → all null', () => {
    const empty = { upper: null, middle: null, lower: null, bandwidth: null, percentB: null }
    expect(calculateBollingerBands([1, 2], 4, 2)).toEqual(empty)
    expect(calculateBollingerBands([1, 2, 3, 4], 4, 0)).toEqual(empty)
    expect(calculateBollingerBands([1, 2, 3, 4], 0, 2)).toEqual(empty)
  })
})

// ============================================================================
// STOCHASTIC
// ============================================================================

describe('calculateStochastic', () => {
  test('closes riding the highs → %K and %D near 100', () => {
    const bars = range(0, 7).map((i) => bar(10 + i, 10.5 + i, 9.5 + i, 10 + i, 100, i))
    const s = calculateStochastic(bars, 5, 3)
    // last close is 0.5 below the window high with a 5-point range → 90
    expect(s.k).toBe(90)
    expect(s.d).toBe(90)
  })

  test('closes riding the lows → %K and %D near 0', () => {
    const bars = range(0, 7).map((i) => bar(20 - i, 20.5 - i, 19.5 - i, 20 - i, 100, i))
    const s = calculateStochastic(bars, 5, 3)
    expect(s.k).toBe(10)
    expect(s.d).toBe(10)
  })

  test('flat bars with close in the middle of the range → %K = %D = 50', () => {
    const bars = range(0, 5).map((i) => bar(9, 10, 8, 9, 100, i))
    expect(calculateStochastic(bars, 3, 2)).toEqual({ k: 50, d: 50 })
  })

  test('insufficient data → null', () => {
    expect(calculateStochastic(range(0, 1).map((i) => bar(9, 10, 8, 9, 100, i)), 5, 3)).toEqual({
      k: null,
      d: null,
    })
  })
})

// ============================================================================
// ADX
// ============================================================================

describe('calculateADX', () => {
  test('pure uptrend → +DI > -DI and high ADX', () => {
    const bars = range(0, 39).map((i) => bar(10 + i, 10.5 + i, 9.5 + i, 10 + i, 100, i))
    const a = calculateADX(bars, 14)
    expect(a.adx).not.toBeNull()
    expect(a.plusDi as number).toBeGreaterThan(a.minusDi as number)
    expect(a.adx as number).toBeGreaterThan(50)
  })

  test('insufficient data (needs 2×period bars) → null', () => {
    const bars = range(0, 9).map((i) => bar(10 + i, 10.5 + i, 9.5 + i, 10 + i, 100, i))
    expect(calculateADX(bars, 14)).toEqual({ adx: null, plusDi: null, minusDi: null })
  })
})

// ============================================================================
// VWAP
// ============================================================================

describe('calculateVWAP', () => {
  test('volume-weighted mean of typical prices', () => {
    // TP1 = (12+8+10)/3 = 10, TP2 = (6+4+5)/3 = 5 → VWAP = (10·100 + 5·100)/200 = 7.5
    const bars = [bar(10, 12, 8, 10, 100, 0), bar(5, 6, 4, 5, 100, 1)]
    expect(calculateVWAP(bars)).toEqual({ vwap: 7.5, cumulativeVolume: 200 })
  })

  test('heavier volume pulls VWAP toward the heavily-traded price', () => {
    const bars = [bar(10, 12, 8, 10, 1, 0), bar(5, 6, 4, 5, 999, 1)]
    const { vwap } = calculateVWAP(bars)
    expect(vwap as number).toBeGreaterThan(5)
    expect(vwap as number).toBeLessThan(6) // dominated by the 999-volume bar
  })

  test('empty series → null vwap, zero volume', () => {
    expect(calculateVWAP([])).toEqual({ vwap: null, cumulativeVolume: 0 })
  })
})

// ============================================================================
// PIVOT POINTS
// ============================================================================

describe('calculatePivotPoints', () => {
  test('classic formula: PP = (H+L+C)/3 with full R1-R3 / S1-S3 set', () => {
    // H=10, L=8, C=9 → PP = 9
    const p = calculatePivotPoints([bar(9, 10, 8, 9)], 1, false)
    expect(p).not.toBeNull()
    expect(p!.pivot).toBe(9)
    expect(p!.r1).toBe(10) // 2*PP - L
    expect(p!.s1).toBe(8) // 2*PP - H
    expect(p!.r2).toBe(11) // PP + (H - L)
    expect(p!.s2).toBe(7) // PP - (H - L)
    expect(p!.r3).toBe(12) // H + 2*(PP - L)
    expect(p!.s3).toBe(6) // L - 2*(H - PP)
  })

  test('aggregating 2 periods uses combined high/low and last close', () => {
    // combined H = 12, L = 7, close = 11 → PP = 10
    const p = calculatePivotPoints([bar(9, 10, 8, 9), bar(9, 12, 7, 11)], 2, false)
    expect(p!.pivot).toBe(10)
    expect(p!.r1).toBe(13)
    expect(p!.s1).toBe(8)
  })

  test('fibonacci variant uses 0.382/0.618/1.0 range multiples', () => {
    // H=10, L=8, C=9 → PP 9, range 2
    const p = calculatePivotPoints([bar(9, 10, 8, 9)], 1, true)
    expect(p!.pivot).toBe(9)
    expect(p!.r1).toBeCloseTo(9 + 0.382 * 2, 10)
    expect(p!.r2).toBeCloseTo(9 + 0.618 * 2, 10)
    expect(p!.r3).toBeCloseTo(11, 10)
    expect(p!.s1).toBeCloseTo(9 - 0.382 * 2, 10)
    expect(p!.s2).toBeCloseTo(9 - 0.618 * 2, 10)
    expect(p!.s3).toBeCloseTo(7, 10)
  })

  test('insufficient bars for numPeriods → null', () => {
    expect(calculatePivotPoints([], 1)).toBeNull()
    expect(calculatePivotPoints([bar(9, 10, 8, 9)], 2)).toBeNull()
    expect(calculatePivotPoints([bar(9, 10, 8, 9)], 0)).toBeNull()
  })
})

// ============================================================================
// TIMEFRAME HELPER
// ============================================================================

describe('getTimeframeMs', () => {
  test('maps every supported timeframe', () => {
    expect(getTimeframeMs('M1')).toBe(60_000)
    expect(getTimeframeMs('M5')).toBe(300_000)
    expect(getTimeframeMs('M15')).toBe(900_000)
    expect(getTimeframeMs('H1')).toBe(3_600_000)
    expect(getTimeframeMs('H4')).toBe(14_400_000)
    expect(getTimeframeMs('D1')).toBe(86_400_000)
  })

  test('case-insensitive; unknown timeframe falls back to M5', () => {
    expect(getTimeframeMs('h1')).toBe(3_600_000)
    expect(getTimeframeMs('d1')).toBe(86_400_000)
    expect(getTimeframeMs('bogus')).toBe(300_000)
  })
})

// ============================================================================
// INDICATOR POOL (cache behaviour)
// ============================================================================

describe('IndicatorPool', () => {
  const bars = range(0, 29).map((i) => bar(10 + i, 10.5 + i, 9.5 + i, 10 + i, 100, i))

  test('computeSingle calculates SMA over the given bars', () => {
    const pool = new IndicatorPool(60_000, 'unit')
    const r = pool.computeSingle('SMA', bars, { period: 5 })
    expect(r.calculated).toBe(true)
    expect(r.values.sma).toBe(37) // mean(35..39)
    expect(r.values.period).toBe(5)
  })

  test('computeSingle reports insufficient data without throwing', () => {
    const pool = new IndicatorPool(60_000, 'unit')
    const r = pool.computeSingle('SMA', bars, { period: 200 })
    expect(r.calculated).toBe(false)
    expect(r.error).toContain('Insufficient data')
  })

  test('compute() caches results within the TTL (2nd call = pure cache hits)', async () => {
    const pool = new IndicatorPool(60_000, 'unit')
    const req = [
      { name: 'SMA', params: { period: 5 } },
      { name: 'EMA', params: { period: 5 } },
    ] as const
    const first = await pool.compute([...req], bars)
    const second = await pool.compute([...req], bars)
    expect(first.cacheHits).toBe(0)
    expect(first.cacheMisses).toBe(2)
    expect(second.cacheHits).toBe(2)
    expect(second.cacheMisses).toBe(0)
    expect(second.results.get('SMA')?.values.sma).toBe(first.results.get('SMA')?.values.sma)
  })

  test('zero TTL disables caching (every call recomputes)', async () => {
    const pool = new IndicatorPool(0, 'unit')
    const req = [{ name: 'SMA', params: { period: 5 } }] as const
    const first = await pool.compute([...req], bars)
    const second = await pool.compute([...req], bars)
    expect(first.cacheMisses).toBe(1)
    expect(second.cacheMisses).toBe(1)
    expect(second.cacheHits).toBe(0)
  })

  test('dependency graph: MACD depends on EMA, BOLLINGER on SMA', () => {
    const pool = new IndicatorPool(60_000, 'unit')
    const deps = pool.getDependencyGraph()
    expect(deps.MACD).toContain('EMA')
    expect(deps.BOLLINGER).toContain('SMA')
    expect(deps.SMA).toEqual([])
    expect(Object.keys(deps).length).toBe(10)
  })

  test('computeSingle returns values for every indicator family (and errors when starved)', () => {
    const pool = new IndicatorPool(0, 'unit')
    const ok = pool.computeSingle('BOLLINGER', bars, { period: 5, stdDev: 2 })
    expect(ok.calculated).toBe(true)
    expect(ok.values.middle).toBeCloseTo(37, 6)
    expect(pool.computeSingle('STOCHASTIC', bars, { kPeriod: 5, dPeriod: 3 }).calculated).toBe(true)
    expect(pool.computeSingle('ADX', bars, { period: 14 }).calculated).toBe(true)
    expect(pool.computeSingle('VWAP', bars).values.cumulativeVolume).toBe(3_000)
    expect(pool.computeSingle('PIVOT_POINTS', bars, { numPeriods: 1 }).values.pivot).toBeDefined()
    // starved inputs degrade to calculated:false with an error message
    // (VWAP/PIVOT need warm-up-free bars, so starve them with an empty series)
    expect(pool.computeSingle('BOLLINGER', bars.slice(0, 3)).error).toContain('Insufficient data')
    expect(pool.computeSingle('STOCHASTIC', bars.slice(0, 3)).error).toContain('Insufficient data')
    expect(pool.computeSingle('ADX', bars.slice(0, 3)).error).toContain('Insufficient data')
    expect(pool.computeSingle('VWAP', []).calculated).toBe(false)
    expect(pool.computeSingle('PIVOT_POINTS', []).calculated).toBe(false)
  })

  test('getCacheStats / clearCache track and reset the in-memory cache', async () => {
    const pool = new IndicatorPool(60_000, 'unit')
    const req = [{ name: 'SMA', params: { period: 5 } }] as const
    await pool.compute([...req], bars)
    await pool.compute([...req], bars)
    const stats = pool.getCacheStats()
    expect(stats.size).toBe(1)
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    pool.clearCache()
    expect(pool.getCacheStats()).toEqual({ size: 0, hits: 1, misses: 1 })
  })

  test('validateInput rejects empty, short, unsorted and malformed series', () => {
    const pool = new IndicatorPool(60_000, 'unit')
    expect(pool.validateInput([], 5).valid).toBe(false)
    expect(pool.validateInput(bars.slice(0, 3), 5).error).toContain('Insufficient bars')
    const unsorted = [bars[1], bars[0], ...bars.slice(2)]
    expect(pool.validateInput(unsorted, 5).error).toContain('not sorted ASC')
    const badPrice = [...bars.slice(0, 5)]
    badPrice[2] = { ...badPrice[2], close: NaN }
    expect(pool.validateInput(badPrice, 5).error).toContain('Invalid close price')
    const badVolume = [...bars.slice(0, 5)]
    badVolume[1] = { ...badVolume[1], volume: -1 }
    expect(pool.validateInput(badVolume, 5).error).toContain('Invalid volume')
    expect(pool.validateInput(bars, 5)).toEqual({ valid: true })
  })
})

// ============================================================================
// SNAPSHOT SERIALIZATION
// ============================================================================

describe('indicator snapshots', () => {
  const bars = range(0, 29).map((i) => bar(10 + i, 10.5 + i, 9.5 + i, 10 + i, 100, i))

  test('capture → parse roundtrip preserves indicator values and metadata', () => {
    const json = captureIndicatorSnapshot('BBCA', bars)
    const parsed = parseIndicatorSnapshot(json)
    expect(parsed._meta).toBeDefined()
    expect(parsed._meta.barCount).toBe(bars.length)
    expect(parsed._meta.lastPrice).toBe(bars[bars.length - 1].close)
    expect(parsed.SMA.sma).toBeCloseTo(29.5, 6) // mean(15..29)? → mean of last 20
    expect(parsed.SMA.period).toBe(20)
    expect(parsed.PIVOT_POINTS.pivot).toBeDefined()
  })

  test('indicators that need more bars than provided are omitted', () => {
    // MACD needs 26+9 = 35 closes but only 30 bars are given
    const parsed = parseIndicatorSnapshot(captureIndicatorSnapshot('BBCA', bars))
    expect(parsed.MACD).toBeUndefined()
    expect(parsed.SMA).toBeDefined()
  })

  test('parseIndicatorSnapshot returns {} for invalid or non-object JSON', () => {
    expect(parseIndicatorSnapshot('this is not json')).toEqual({})
    expect(parseIndicatorSnapshot('42')).toEqual({})
    expect(parseIndicatorSnapshot('null')).toEqual({})
  })
})

// ============================================================================
// STRATEGY SIGNAL (guard clause)
// ============================================================================

describe('computeStrategySignal', () => {
  test('fewer than 30 bars → NEUTRAL with an explicit error indicator', () => {
    const bars = range(0, 19).map((i) => bar(10 + i, 10.5 + i, 9.5 + i, 10 + i, 100, i))
    const s = computeStrategySignal('ma-ribbon', bars)
    expect(s.signal).toBe('NEUTRAL')
    expect(s.confidence).toBe(0)
    expect(s.indicators[0]?.calculated).toBe(false)
    expect(s.indicators[0]?.error).toContain('need 30+ bars')
  })
})

// ============================================================================
// MOCK CANDLE GENERATOR
// ============================================================================

describe('generateMockCandles', () => {
  test('generates the requested number of OHLCV-valid bars', () => {
    const bars = generateMockCandles('BBCA', 'H1', 50)
    expect(bars.length).toBe(50)
    for (const b of bars) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close))
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close))
      expect(b.open).toBeGreaterThan(0)
      expect(b.high).toBeGreaterThan(0)
      expect(b.low).toBeGreaterThan(0)
      expect(b.close).toBeGreaterThan(0)
      expect(b.volume).toBeGreaterThanOrEqual(100_000)
    }
  })

  test('known symbols start near their real-world base price; unknown default to 5000', () => {
    const bbca = generateMockCandles('BBCA', 'H1', 30)
    expect(bbca[0].open).toBeGreaterThan(5_000) // BBCA base 9800 ± noise
    expect(bbca[0].open).toBeLessThan(15_000)
    const unknown = generateMockCandles('ZZZZ', 'H1', 30)
    expect(unknown[0].open).toBeGreaterThan(2_500)
    expect(unknown[0].open).toBeLessThan(7_500)
  })

  test('timestamps ascend with the timeframe step', () => {
    const bars = generateMockCandles('TLKM', 'M5', 10)
    for (let i = 1; i < bars.length; i++) {
      const gap = bars[i].openTime.getTime() - bars[i - 1].openTime.getTime()
      expect(gap).toBe(300_000)
    }
  })
})
