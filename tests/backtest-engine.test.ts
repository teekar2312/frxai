/**
 * Unit tests — src/lib/backtest-engine.ts (Batch B / Task 5-b)
 * ============================================================
 * Covers: streaming indicators (Sma/Ema/Rsi/Atr/Macd/Bollinger/Donchian),
 * synthetic data generators (mulberry32, hashSeed, generateSyntheticCandles),
 * signal generation (computeSignal), the full runBacktest engine
 * (intrabar SL/TP, END_OF_DATA force close, determinism), pure metrics
 * computation (computeMetrics) and parameter handling (mergeParams).
 *
 * NOTE ON INTENTIONAL "DOCUMENTING" TESTS:
 *  - Rsi flat-series behaviour and Ema.ready warm-up semantics deviate from
 *    textbook definitions. Those deviations are documented below with
 *    explicit BUG notes and reported in the task report (source files are
 *    not modified per task rules).
 */
import { describe, test, expect } from 'bun:test'
import {
  Sma,
  Ema,
  Rsi,
  Atr,
  Macd,
  BollingerBands,
  DonchianChannel,
  mulberry32,
  hashSeed,
  generateSyntheticCandles,
  computeSignal,
  runBacktest,
  warmupBars,
  computeMetrics,
  mergeParams,
  defaultBacktestParams,
  BACKTEST_STRATEGIES,
} from '../src/lib/backtest-engine'
import type {
  BacktestCandle,
  BacktestParams,
  BacktestTradeRecord,
  BacktestStrategyId,
  EquityCurvePoint,
} from '../src/lib/backtest-engine'

// ---- helpers ---------------------------------------------------------------

/** Build a single OHLC candle with 1-hour spacing starting 2024-01-01. */
function mkCandle(i: number, o: number, h: number, l: number, c: number): BacktestCandle {
  return {
    openTime: new Date(Date.UTC(2024, 0, 1, 0, i)),
    open: o,
    high: h,
    low: l,
    close: c,
  }
}

/** n gently falling bars: close 100, 99, 98 ... with ±0.5 range. */
function fallBars(n: number, start = 100, step = 1, halfRange = 0.5): BacktestCandle[] {
  const out: BacktestCandle[] = []
  for (let i = 0; i < n; i++) {
    const c = start - i * step
    out.push(mkCandle(out.length, c, c + halfRange, c - halfRange, c))
  }
  return out
}

/** A minimal SMA-crossover state (StrategyState is intentionally unexported). */
function makeSmaState(fast: number, slow: number): Parameters<typeof computeSignal>[2] {
  return {
    smaFast: new Sma(fast),
    smaSlow: new Sma(slow),
    prevSmaFast: null,
    prevSmaSlow: null,
  } as unknown as Parameters<typeof computeSignal>[2]
}

/** RSI mean-reversion params tuned so entries happen within ~8 bars. */
function rsiParams(): BacktestParams {
  const p = defaultBacktestParams('RSI_MEAN_REVERSION')
  p.rsiPeriod = 3
  p.rsiOversold = 30
  p.rsiOverbought = 70
  p.atrPeriod = 3
  return p
}

// ============================================================================
// INDICATORS — Sma
// ============================================================================

describe('Sma', () => {
  test('warm-up returns null until period is reached, then mean of last `period` values', () => {
    const sma = new Sma(3)
    expect(sma.update(1)).toBeNull()
    expect(sma.update(2)).toBeNull()
    expect(sma.ready).toBe(false)
    expect(sma.update(3)).toBe(2) // mean(1,2,3)
    expect(sma.ready).toBe(true)
  })

  test('window slides forward as new values arrive', () => {
    const sma = new Sma(3)
    sma.update(1)
    sma.update(2)
    sma.update(3)
    expect(sma.update(4)).toBe(3) // mean(2,3,4)
    expect(sma.update(5)).toBe(4) // mean(3,4,5)
  })
})

// ============================================================================
// INDICATORS — Ema
// ============================================================================

describe('Ema', () => {
  test('warm-up: returns null until period bars have been seen, then exact recurrence', () => {
    const ema = new Ema(3)
    expect(ema.update(10)).toBeNull()
    expect(ema.update(11)).toBeNull()
    // k = 2/(3+1) = 0.5 → 12*0.5 + 10.5*0.5 = 11.25
    expect(ema.update(12)).toBe(11.25)
    expect(ema.update(13)).toBe(12.125)
    expect(ema.update(14)).toBe(13.0625)
  })

  test('converges to a constant series', () => {
    const ema = new Ema(5)
    let last: number | null = null
    for (let i = 0; i < 200; i++) last = ema.update(100)
    expect(last).toBe(100)
  })

  test('converges to the mean of an alternating series', () => {
    const ema = new Ema(5)
    let last: number | null = null
    for (let i = 0; i < 500; i++) last = ema.update(i % 2 === 0 ? 10 : 20)
    // steady-state oscillation is 14 ↔ 16 around the 15 mean (k = 1/3)
    expect(last).toBeGreaterThanOrEqual(14)
    expect(last).toBeLessThanOrEqual(16)
  })

  test('ready flag only flips once warm-up completes (count >= period)', () => {
    const ema = new Ema(3)
    expect(ema.ready).toBe(false)
    expect(ema.update(10)).toBeNull()
    // ready follows the same semantics as update() emitting values:
    // false during warm-up (count < period), true afterwards.
    expect(ema.ready).toBe(false)
    ema.update(11)
    expect(ema.ready).toBe(false)
    ema.update(12)
    expect(ema.ready).toBe(true)
    expect(ema.update(13)).not.toBeNull()
  })
})

// ============================================================================
// INDICATORS — Rsi
// ============================================================================

describe('Rsi', () => {
  test('monotonically rising prices → RSI = 100', () => {
    const rsi = new Rsi(5)
    let last: number | null = null
    for (let i = 1; i <= 12; i++) last = rsi.update(100 + i)
    expect(last).toBe(100)
  })

  test('monotonically falling prices → RSI = 0', () => {
    const rsi = new Rsi(5)
    let last: number | null = null
    for (let i = 1; i <= 12; i++) last = rsi.update(100 - i)
    expect(last).toBe(0)
  })

  test('alternating equal up/down moves → RSI oscillates around 50', () => {
    const rsi = new Rsi(5)
    let last: number | null = null
    for (let i = 1; i <= 14; i++) last = rsi.update(100 + (i % 2 === 0 ? 1 : -1))
    expect(last).not.toBeNull()
    expect(last as number).toBeGreaterThan(40)
    expect(last as number).toBeLessThan(60)
  })

  test('flat series returns 50 (neutral — no gains, no losses)', () => {
    // When avgGain === 0 AND avgLoss === 0 (no movement at all), the
    // convention is neutral 50 (fixed from the old buggy 100).
    const rsi = new Rsi(5)
    let last: number | null = null
    for (let i = 0; i < 12; i++) last = rsi.update(100)
    expect(last).toBe(50)
  })

  test('ready flag becomes true after period+1 closes (period changes seeded)', () => {
    const rsi = new Rsi(5)
    for (let i = 0; i < 5; i++) rsi.update(100)
    expect(rsi.ready).toBe(false)
    rsi.update(100)
    expect(rsi.ready).toBe(true)
  })
})

// ============================================================================
// INDICATORS — Atr
// ============================================================================

describe('Atr', () => {
  test('identical bars → TR = high - low (2.0), first value after period+1 bars', () => {
    const atr = new Atr(3)
    expect(atr.update({ high: 10, low: 8, close: 9 })).toBeNull() // seeds prevClose
    expect(atr.update({ high: 10, low: 8, close: 9 })).toBeNull()
    expect(atr.update({ high: 10, low: 8, close: 9 })).toBeNull()
    expect(atr.update({ high: 10, low: 8, close: 9 })).toBe(2)
    expect(atr.update({ high: 10, low: 8, close: 9 })).toBe(2)
    expect(atr.ready).toBe(true)
  })

  test('value getter returns 0 before warm-up', () => {
    const atr = new Atr(3)
    expect(atr.value).toBe(0)
    expect(atr.ready).toBe(false)
  })
})

// ============================================================================
// INDICATORS — Macd
// ============================================================================

describe('Macd', () => {
  test('warm-up: null until slow EMA and signal EMA are both ready', () => {
    const macd = new Macd(3, 6, 3)
    // Ema(6) emits from bar 6, signal Ema(3) of the macd line needs 3 more
    for (let i = 0; i < 7; i++) {
      expect(macd.update(100 + i)).toBeNull()
    }
    expect(macd.ready).toBe(false)
    const first = macd.update(107)
    expect(first).not.toBeNull()
    expect(macd.ready).toBe(true)
  })

  test('bearish-to-bullish V-shape triggers cross = +1 (macd rises through signal)', () => {
    const macd = new Macd(3, 6, 3)
    const prices: number[] = []
    for (let i = 0; i < 10; i++) prices.push(100 - i) // decline
    for (let i = 0; i < 10; i++) prices.push(91 + i * 2) // recovery
    let sawBullCross = false
    let sawBearCross = false
    for (const p of prices) {
      const r = macd.update(p)
      if (r) {
        if (r.cross === 1) sawBullCross = true
        if (r.cross === -1) sawBearCross = true
      }
    }
    expect(sawBullCross).toBe(true)
    expect(sawBearCross).toBe(false)
  })

  test('bullish-to-bearish reversal triggers cross = -1', () => {
    const macd = new Macd(3, 6, 3)
    const prices: number[] = []
    for (let i = 0; i < 12; i++) prices.push(100 + i) // rise
    for (let i = 0; i < 10; i++) prices.push(112 - i) // decline
    let sawBearCross = false
    for (const p of prices) {
      const r = macd.update(p)
      if (r && r.cross === -1) sawBearCross = true
    }
    expect(sawBearCross).toBe(true)
  })

  test('histogram equals macd - signal', () => {
    const macd = new Macd(3, 6, 3)
    let last: { macd: number; signal: number; histogram: number } | null = null
    for (let i = 0; i < 20; i++) {
      const r = macd.update(100 + Math.sin(i / 3) * 5 + i * 0.3)
      if (r) last = r
    }
    expect(last).not.toBeNull()
    expect(last!.histogram).toBeCloseTo(last!.macd - last!.signal, 10)
  })
})

// ============================================================================
// INDICATORS — BollingerBands
// ============================================================================

describe('BollingerBands', () => {
  test('population std dev: [1,2,3,4] period 4 mult 1 → middle 2.5, upper 3.618…', () => {
    const bb = new BollingerBands(4, 1)
    expect(bb.update(1)).toBeNull()
    expect(bb.update(2)).toBeNull()
    expect(bb.update(3)).toBeNull()
    const r = bb.update(4)
    expect(r).not.toBeNull()
    expect(r!.middle).toBe(2.5)
    // variance = 1.25, std = sqrt(1.25) ≈ 1.1180339887
    expect(r!.upper).toBeCloseTo(2.5 + Math.sqrt(1.25), 10)
    expect(r!.lower).toBeCloseTo(2.5 - Math.sqrt(1.25), 10)
  })

  test('flat data → upper = middle = lower (zero variance)', () => {
    const bb = new BollingerBands(3, 2)
    bb.update(50)
    bb.update(50)
    const r = bb.update(50)
    expect(r).toEqual({ upper: 50, middle: 50, lower: 50 })
  })

  test('window slides: [1,2,3,4,5] drops the oldest value', () => {
    const bb = new BollingerBands(4, 1)
    for (const p of [1, 2, 3, 4, 5]) bb.update(p)
    const r = bb.update(6)
    // window is now [3,4,5,6] → mean 4.5
    expect(r!.middle).toBe(4.5)
  })
})

// ============================================================================
// INDICATORS — DonchianChannel
// ============================================================================

describe('DonchianChannel', () => {
  test('upper = max highs, lower = min lows over the period window', () => {
    const dc = new DonchianChannel(3)
    expect(dc.update({ high: 5, low: 1 })).toBeNull()
    expect(dc.update({ high: 10, low: 2 })).toBeNull()
    expect(dc.update({ high: 7, low: 3 })).toEqual({ upper: 10, lower: 1 })
  })

  test('window slides so old extremes drop out', () => {
    const dc = new DonchianChannel(3)
    dc.update({ high: 5, low: 1 })
    dc.update({ high: 10, low: 2 })
    dc.update({ high: 7, low: 3 })
    // window becomes [10,2],[7,3],[4,6] → high 10 drops later
    expect(dc.update({ high: 4, low: 6 })).toEqual({ upper: 10, lower: 2 })
    expect(dc.update({ high: 2, low: 5 })).toEqual({ upper: 7, lower: 3 })
  })
})

// ============================================================================
// SYNTHETIC DATA GENERATORS
// ============================================================================

describe('mulberry32', () => {
  test('same seed → identical sequence', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = [a(), a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  test('all values lie in [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('different seeds produce (almost certainly) different sequences', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = [a(), a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b(), b()]
    expect(seqA).not.toEqual(seqB)
  })
})

describe('hashSeed', () => {
  test('same string → same hash', () => {
    expect(hashSeed('FRxAI:H1:1000')).toBe(hashSeed('FRxAI:H1:1000'))
  })

  test('different strings → different hashes', () => {
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'))
  })

  test('returns a 32-bit unsigned integer', () => {
    const h = hashSeed('seed-string')
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('generateSyntheticCandles', () => {
  const opts = {
    symbol: 'SYNTH',
    timeframe: 'H1',
    bars: 120,
    startDate: new Date('2024-01-01T00:00:00Z'),
  }

  test('produces exactly `bars` candles', () => {
    expect(generateSyntheticCandles(opts).length).toBe(120)
  })

  test('OHLC invariants: high >= max(open,close), low <= min(open,close), all prices > 0', () => {
    const candles = generateSyntheticCandles(opts)
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close))
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close))
      expect(c.open).toBeGreaterThan(0)
      expect(c.high).toBeGreaterThan(0)
      expect(c.low).toBeGreaterThan(0)
      expect(c.close).toBeGreaterThan(0)
    }
  })

  test('deterministic for identical options (same derived seed + startDate)', () => {
    const a = generateSyntheticCandles(opts)
    const b = generateSyntheticCandles(opts)
    expect(a).toEqual(b)
  })

  test('timestamps strictly increase', () => {
    const candles = generateSyntheticCandles(opts)
    for (let i = 1; i < candles.length; i++) {
      expect(new Date(candles[i].openTime).getTime()).toBeGreaterThan(
        new Date(candles[i - 1].openTime).getTime()
      )
    }
  })

  test('different bar counts derive different seeds → different data', () => {
    const a = generateSyntheticCandles({ ...opts, bars: 50 })
    const b = generateSyntheticCandles({ ...opts, bars: 51 })
    expect(a[0].close).not.toBe(b[0].close)
  })
})

// ============================================================================
// SIGNAL GENERATION
// ============================================================================

describe('computeSignal — SMA_CROSSOVER', () => {
  test('falling-then-rising series: crossUp → ENTER_LONG, later crossDown → EXIT_LONG', () => {
    const state = makeSmaState(2, 4)
    const closes = [10, 9.5, 9, 8.5, 8, 7.5, 7, 7.5, 8.5, 10, 12, 14, 16, 14, 12, 10, 8]
    const actions: string[] = []
    for (const c of closes) {
      actions.push(computeSignal('SMA_CROSSOVER', { open: c, high: c, low: c, close: c }, state))
    }
    expect(actions).toContain('ENTER_LONG')
    expect(actions).toContain('EXIT_LONG')
    // cross up happens while the series turns up (index 8)…
    expect(actions.indexOf('ENTER_LONG')).toBe(8)
    // …and cross down after the peak (index 14)
    expect(actions.indexOf('EXIT_LONG')).toBe(14)
    // first bars are warm-up HOLD
    expect(actions.slice(0, 8).every((a) => a === 'HOLD')).toBe(true)
  })

  test('unknown strategy id → HOLD', () => {
    const state = makeSmaState(2, 4)
    const action = computeSignal(
      'NOT_A_STRATEGY' as BacktestStrategyId,
      { open: 1, high: 1, low: 1, close: 1 },
      state
    )
    expect(action).toBe('HOLD')
  })
})

// ============================================================================
// WARM-UP ESTIMATION
// ============================================================================

describe('warmupBars', () => {
  test('every strategy reports a positive warm-up', () => {
    const p = defaultBacktestParams('SMA_CROSSOVER')
    for (const s of BACKTEST_STRATEGIES) {
      expect(warmupBars(s.id, p)).toBeGreaterThan(0)
    }
  })

  test('SMA/EMA crossover warm-up = slowPeriod + atrPeriod + 1', () => {
    const p = defaultBacktestParams('SMA_CROSSOVER')
    expect(warmupBars('SMA_CROSSOVER', p)).toBe(p.slowPeriod + p.atrPeriod + 1)
    expect(warmupBars('EMA_CROSSOVER', p)).toBe(p.slowPeriod + p.atrPeriod + 1)
  })

  test('RSI mean-reversion warm-up = rsiPeriod * 2 + 1', () => {
    const p = defaultBacktestParams('RSI_MEAN_REVERSION')
    expect(warmupBars('RSI_MEAN_REVERSION', p)).toBe(p.rsiPeriod * 2 + 1)
  })
})

// ============================================================================
// FULL ENGINE — runBacktest
// ============================================================================

describe('runBacktest — end-to-end (synthetic 1000 bars, SMA_CROSSOVER)', () => {
  const candles = generateSyntheticCandles({
    symbol: 'E2E1K',
    timeframe: 'H1',
    bars: 1000,
    startDate: new Date('2024-01-01T00:00:00Z'),
  })
  const params = defaultBacktestParams('SMA_CROSSOVER')
  const result = runBacktest(candles, params)

  test('produces trades on a random-walk series', () => {
    expect(result.metrics.totalTrades).toBeGreaterThan(0)
    expect(result.trades.length).toBe(result.metrics.totalTrades)
  })

  test('equity curve is populated and starts at initial capital', () => {
    expect(result.equityCurve.length).toBeGreaterThan(0)
    expect(result.equityCurve[0].equity).toBe(params.initialCapital)
    expect(result.equityCurve[0].drawdown).toBe(0)
  })

  test('accounting identity: finalCapital = initialCapital + totalPnl', () => {
    expect(result.metrics.finalCapital).toBeCloseTo(
      params.initialCapital + result.metrics.totalPnl,
      2
    )
  })

  test('durationMs is non-negative', () => {
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('deterministic: identical inputs → identical metrics & trades', () => {
    const again = runBacktest(candles, params)
    expect(again.metrics).toEqual(result.metrics)
    expect(again.trades).toEqual(result.trades)
    expect(again.equityCurve).toEqual(result.equityCurve)
  })

  test('strategy field echoes the params', () => {
    expect(result.strategy).toBe('SMA_CROSSOVER')
    expect(result.params).toBe(params)
  })
})

describe('runBacktest — intrabar exit reasons (RSI entries on manual candles)', () => {
  test('stop-loss: candle low penetrates SL → exitReason "SL"', () => {
    // 8 falling bars → RSI <= oversold → ENTER_LONG around bar 7 (close 93).
    // ATR ≈ 1.5 (TR dominated by |low - prevClose|), slAtrMult 2 → SL ≈ 90.
    const candles = [...fallBars(8), mkCandle(8, 93, 93, 75, 80)]
    const res = runBacktest(candles, rsiParams())
    expect(res.trades.length).toBeGreaterThan(0)
    expect(res.trades[0].direction).toBe('BUY')
    expect(res.trades[0].exitReason).toBe('SL')
    expect(res.trades[0].entryPrice).toBeCloseTo(93.02, 2) // close + 2 tick slippage
    expect(res.trades[0].exitPrice).toBeCloseTo(90.0, 2) // SL fill minus slippage
  })

  test('take-profit: candle high reaches TP → exitReason "TP"', () => {
    // Entry ~93.02, TP ≈ 93.02 + 3*ATR(1.5) = 97.52; high 100 penetrates it.
    const candles = [...fallBars(8), mkCandle(8, 93, 100, 92.9, 99)]
    const res = runBacktest(candles, rsiParams())
    expect(res.trades.length).toBeGreaterThan(0)
    expect(res.trades[0].exitReason).toBe('TP')
    expect(res.trades[0].exitPrice).toBeCloseTo(97.5, 2)
  })

  test('open position at end of data → force-closed with "END_OF_DATA" + warning', () => {
    // Falling prices keep RSI low (no overbought exit), and the small
    // ±0.5 bar range never reaches SL/TP → position survives to the end.
    const candles = fallBars(10)
    const res = runBacktest(candles, rsiParams())
    expect(res.trades.length).toBeGreaterThan(0)
    const last = res.trades[res.trades.length - 1]
    expect(last.exitReason).toBe('END_OF_DATA')
    expect(res.warnings).toContain('Open position force-closed at end of data')
  })

  test('pessimistic SL priority: both SL and TP inside one bar → SL wins', () => {
    // One huge bar whose low breaches SL and high breaches TP.
    const candles = [...fallBars(8), mkCandle(8, 93, 200, 10, 90)]
    const res = runBacktest(candles, rsiParams())
    expect(res.trades[0].exitReason).toBe('SL')
  })
})

describe('runBacktest — misc behaviour', () => {
  test('too few candles → warning about insufficient data', () => {
    const p = defaultBacktestParams('SMA_CROSSOVER') // warmup = 35
    const res = runBacktest(fallBars(5), p)
    expect(res.warnings.some((w) => w.startsWith('Insufficient candles'))).toBe(true)
    expect(res.metrics.totalTrades).toBe(0)
  })

  test('equity curve respects maxEquityPoints cap', () => {
    const candles = generateSyntheticCandles({
      symbol: 'CAP',
      timeframe: 'M5',
      bars: 100,
      startDate: new Date('2024-01-01T00:00:00Z'),
    })
    const res = runBacktest(candles, defaultBacktestParams('DONCHIAN_BREAKOUT'), {
      maxEquityPoints: 10,
    })
    expect(res.equityCurve.length).toBeLessThanOrEqual(10)
  })
})

// ============================================================================
// METRICS (pure)
// ============================================================================

describe('computeMetrics — hand-computed fixture', () => {
  const params = defaultBacktestParams('SMA_CROSSOVER') // initialCapital 10_000

  const mkTrade = (seq: number, pnl: number, commission: number): BacktestTradeRecord => ({
    sequence: seq,
    direction: 'BUY',
    entryTime: new Date('2024-01-01'),
    exitTime: new Date('2024-01-02'),
    entryPrice: 100,
    exitPrice: 101,
    shares: 10,
    lotSize: 0.1,
    pnl,
    pnlPercent: pnl / 100,
    commission,
    exitReason: 'SIGNAL',
    equityAfter: 10_000 + pnl,
    drawdownAfter: 0,
  })

  // PnL sequence: +100, +30, -50, -20, -10, +5  → final equity 10_055
  const trades: BacktestTradeRecord[] = [
    mkTrade(1, 100, 2),
    mkTrade(2, 30, 2),
    mkTrade(3, -50, 2),
    mkTrade(4, -20, 2),
    mkTrade(5, -10, 2),
    mkTrade(6, 5, 2),
  ]

  const equityCurve: EquityCurvePoint[] = [
    { date: '2024-01-01T00:00:00Z', equity: 10_000, drawdown: 0 },
    { date: '2024-01-02T00:00:00Z', equity: 10_100, drawdown: 0 },
    { date: '2024-01-03T00:00:00Z', equity: 10_130, drawdown: 0 },
    { date: '2024-01-04T00:00:00Z', equity: 10_080, drawdown: 0.198 },
    { date: '2024-01-05T00:00:00Z', equity: 10_060, drawdown: 0.69 },
    { date: '2024-01-06T00:00:00Z', equity: 10_050, drawdown: 0.79 },
    { date: '2024-01-07T00:00:00Z', equity: 10_055, drawdown: 0.74 },
  ]

  const m = computeMetrics(trades, equityCurve, params, 100, 40, 0.05, 500)

  test('trade counts and win rate', () => {
    expect(m.totalTrades).toBe(6)
    expect(m.winTrades).toBe(3)
    expect(m.lossTrades).toBe(3)
    expect(m.winRate).toBe(50)
  })

  test('avg win / avg loss / gross totals', () => {
    expect(m.avgWin).toBe(45) // (100 + 30 + 5) / 3
    expect(m.avgLoss).toBeCloseTo(26.67, 2) // (50 + 20 + 10) / 3
    expect(m.grossProfit).toBe(135)
    expect(m.grossLoss).toBe(80)
  })

  test('profit factor = grossProfit / grossLoss', () => {
    expect(m.profitFactor).toBeCloseTo(1.69, 2) // 135 / 80
  })

  test('expectancy = p(win)*avgWin - p(loss)*avgLoss', () => {
    expect(m.expectancy).toBeCloseTo(9.17, 2) // 0.5*45 - 0.5*26.667
  })

  test('max consecutive wins / losses streaks', () => {
    expect(m.maxConsecWins).toBe(2) // +100, +30
    expect(m.maxConsecLosses).toBe(3) // -50, -20, -10
  })

  test('commission total sums per-trade commissions', () => {
    expect(m.commissionTotal).toBe(12) // 6 × $2
  })

  test('capital accounting from the equity curve', () => {
    expect(m.finalCapital).toBe(10_055)
    expect(m.totalPnl).toBe(55)
    expect(m.totalPnlPct).toBeCloseTo(0.55, 2)
    expect(m.avgTradePnl).toBeCloseTo(9.17, 2)
  })

  test('drawdown / exposure / total bars are passed through', () => {
    expect(m.maxDrawdown).toBe(5) // 0.05 as %
    expect(m.maxDrawdownAbs).toBe(500)
    expect(m.exposurePct).toBe(40) // 40 / 100 bars
    expect(m.totalBars).toBe(100)
  })

  test('risk ratios are finite numbers (not NaN)', () => {
    expect(Number.isFinite(m.sharpeRatio)).toBe(true)
    expect(Number.isFinite(m.sortinoRatio)).toBe(true)
    expect(Number.isFinite(m.calmarRatio)).toBe(true)
  })
})

describe('computeMetrics — edge cases', () => {
  const params = defaultBacktestParams('SMA_CROSSOVER')

  test('no trades → zeros, profitFactor 0, finalCapital = initial', () => {
    const m = computeMetrics([], [], params, 10, 0, 0, 0)
    expect(m.totalTrades).toBe(0)
    expect(m.winRate).toBe(0)
    expect(m.profitFactor).toBe(0)
    expect(m.finalCapital).toBe(params.initialCapital)
    expect(m.totalPnl).toBe(0)
  })

  test('no trades but equity curve present → finalCapital from curve', () => {
    const curve: EquityCurvePoint[] = [
      { date: '2024-01-01T00:00:00Z', equity: 10_000, drawdown: 0 },
      { date: '2024-01-02T00:00:00Z', equity: 10_250, drawdown: 0 },
    ]
    const m = computeMetrics([], curve, params, 10, 0, 0, 0)
    expect(m.finalCapital).toBe(10_250)
    expect(m.totalPnl).toBe(250)
  })

  test('only winning trades → profitFactor null (undefined ratio)', () => {
    const t: BacktestTradeRecord[] = [
      {
        sequence: 1,
        direction: 'BUY',
        entryTime: new Date(),
        exitTime: new Date(),
        entryPrice: 10,
        exitPrice: 11,
        shares: 1,
        lotSize: 0.01,
        pnl: 10,
        pnlPercent: 1,
        commission: 1,
        exitReason: 'TP',
        equityAfter: 10_010,
        drawdownAfter: 0,
      },
    ]
    const m = computeMetrics(t, [], params, 10, 5, 0, 0)
    expect(m.profitFactor).toBeNull()
    expect(m.winRate).toBe(100)
  })
})

// ============================================================================
// PARAMS
// ============================================================================

describe('mergeParams', () => {
  test('overrides initialCapital and fastPeriod while keeping other defaults', () => {
    const p = mergeParams('SMA_CROSSOVER', { initialCapital: 50_000, fastPeriod: 5 })
    expect(p.initialCapital).toBe(50_000)
    expect(p.fastPeriod).toBe(5)
    expect(p.slowPeriod).toBe(20)
    expect(p.strategy).toBe('SMA_CROSSOVER')
  })

  test('fastPeriod >= slowPeriod is corrected to floor(slow/2)', () => {
    const p = mergeParams('SMA_CROSSOVER', { fastPeriod: 30, slowPeriod: 20 })
    expect(p.fastPeriod).toBe(10)
    expect(p.fastPeriod).toBeLessThan(p.slowPeriod)
  })

  test('positionPct clamped into [0.001, 1]', () => {
    expect(mergeParams('SMA_CROSSOVER', { positionPct: 5 }).positionPct).toBe(1)
    expect(mergeParams('SMA_CROSSOVER', { positionPct: 0 }).positionPct).toBe(0.001)
    expect(mergeParams('SMA_CROSSOVER', { positionPct: -3 }).positionPct).toBe(0.001)
    expect(mergeParams('SMA_CROSSOVER', { positionPct: 0.25 }).positionPct).toBe(0.25)
  })

  test('non-number values are ignored (defaults retained)', () => {
    const p = mergeParams('SMA_CROSSOVER', {
      initialCapital: 'lots',
      positionPct: 'half',
      fastPeriod: null,
      slowPeriod: NaN,
    })
    expect(p.initialCapital).toBe(10_000)
    expect(p.positionPct).toBe(0.1)
    expect(p.fastPeriod).toBe(10)
    expect(p.slowPeriod).toBe(20)
  })

  test('allowShort boolean passes through; undefined config returns defaults', () => {
    expect(mergeParams('SMA_CROSSOVER', { allowShort: true }).allowShort).toBe(true)
    expect(mergeParams('SMA_CROSSOVER', undefined).allowShort).toBe(false)
    expect(mergeParams('SMA_CROSSOVER', null as unknown as Record<string, unknown>)).toEqual(
      defaultBacktestParams('SMA_CROSSOVER')
    )
  })

  test('slAtrMult / tpAtrMult sanity clamps', () => {
    expect(mergeParams('SMA_CROSSOVER', { slAtrMult: 99 }).slAtrMult).toBe(10)
    expect(mergeParams('SMA_CROSSOVER', { slAtrMult: -1 }).slAtrMult).toBe(0.25)
    expect(mergeParams('SMA_CROSSOVER', { tpAtrMult: 99 }).tpAtrMult).toBe(20)
  })
})

describe('defaultBacktestParams', () => {
  test('returns sane defaults for every registered strategy', () => {
    for (const s of BACKTEST_STRATEGIES) {
      const p = defaultBacktestParams(s.id)
      expect(p.strategy).toBe(s.id)
      expect(p.initialCapital).toBe(10_000)
      expect(p.positionPct).toBeGreaterThan(0)
      expect(p.positionPct).toBeLessThanOrEqual(1)
      expect(p.fastPeriod).toBeLessThan(p.slowPeriod)
      expect(p.rsiOversold).toBeLessThan(p.rsiOverbought)
      expect(p.bollingerStd).toBeGreaterThan(0)
      expect(p.donchianPeriod).toBeGreaterThan(1)
      expect(p.barsPerYear).toBeGreaterThan(0)
      expect(p.commissionPerLot).toBeGreaterThanOrEqual(0)
    }
  })
})
