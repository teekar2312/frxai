/**
 * FRxAI — Backtest Engine v2
 * ============================
 * Pure, deterministic, dependency-free backtesting engine.
 * (No DB / no I/O — persistence lives in the API route.)
 *
 * Strategies (6, signal-based):
 *   1. SMA_CROSSOVER        — fast/slow SMA cross with ATR SL/TP
 *   2. EMA_CROSSOVER        — fast/slow EMA cross with ATR SL/TP
 *   3. RSI_MEAN_REVERSION   — RSI oversold/overbought entries
 *   4. MACD_MOMENTUM        — MACD line/signal cross + histogram filter
 *   5. BOLLINGER_BREAKOUT   — close breaks band, ATR-confirmed
 *   6. DONCHIAN_BREAKOUT    — N-bar high/low channel breakout
 *
 * Execution model:
 *   - Single position at a time, long & short supported
 *   - ATR-based SL/TP with intrabar hit detection (pessimistic: SL first)
 *   - Commission per lot + fixed slippage (ticks) on entry & exit
 *   - Position sizing: percent-of-equity (default 10%)
 *
 * Metrics:
 *   winRate, profitFactor, expectancy, avgWin/avgLoss, grossProfit/Loss,
 *   Sharpe, Sortino, Calmar, maxDrawdown (% & abs), maxConsecutiveWins/Losses,
 *   totalCommission, per-trade ledger, equity curve.
 */

// ============================================
// TYPES
// ============================================

export interface BacktestCandle {
  openTime: Date | string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type BacktestStrategyId =
  | 'SMA_CROSSOVER'
  | 'EMA_CROSSOVER'
  | 'RSI_MEAN_REVERSION'
  | 'MACD_MOMENTUM'
  | 'BOLLINGER_BREAKOUT'
  | 'DONCHIAN_BREAKOUT'

export interface BacktestParams {
  strategy: BacktestStrategyId
  initialCapital: number
  /** Fraction of equity deployed per trade (0..1) */
  positionPct: number
  /** ATR multiplier for stop-loss distance */
  slAtrMult: number
  /** ATR multiplier for take-profit distance */
  tpAtrMult: number
  atrPeriod: number
  commissionPerLot: number
  /** Slippage in ticks applied to each fill */
  slippageTicks: number
  tickSize: number
  lotSize: number
  /** Strategy-specific knobs */
  fastPeriod: number
  slowPeriod: number
  rsiPeriod: number
  rsiOversold: number
  rsiOverbought: number
  macdFast: number
  macdSlow: number
  macdSignal: number
  bollingerPeriod: number
  bollingerStd: number
  donchianPeriod: number
  /** Allow short positions */
  allowShort: boolean
  /** Bars per year — for Sharpe/Sortino annualisation */
  barsPerYear: number
}

export interface BacktestTradeRecord {
  sequence: number
  direction: 'BUY' | 'SELL'
  entryTime: Date
  exitTime: Date
  entryPrice: number
  exitPrice: number
  shares: number
  lotSize: number
  pnl: number
  pnlPercent: number
  commission: number
  exitReason: 'SL' | 'TP' | 'SIGNAL' | 'END_OF_DATA'
  equityAfter: number
  drawdownAfter: number
}

export interface BacktestMetrics {
  initialCapital: number
  finalCapital: number
  totalPnl: number
  totalPnlPct: number
  totalTrades: number
  winTrades: number
  lossTrades: number
  winRate: number
  avgWin: number
  avgLoss: number
  avgTradePnl: number
  grossProfit: number
  grossLoss: number
  profitFactor: number | null
  expectancy: number
  sharpeRatio: number | null
  sortinoRatio: number | null
  calmarRatio: number | null
  maxDrawdown: number
  maxDrawdownAbs: number
  maxConsecWins: number
  maxConsecLosses: number
  commissionTotal: number
  totalBars: number
  exposurePct: number
}

export interface EquityCurvePoint {
  date: string
  equity: number
  drawdown: number
}

export interface BacktestResult {
  metrics: BacktestMetrics
  trades: BacktestTradeRecord[]
  equityCurve: EquityCurvePoint[]
  params: BacktestParams
  strategy: BacktestStrategyId
  startedAt: string
  finishedAt: string
  durationMs: number
  warnings: string[]
}

export const BACKTEST_STRATEGIES: Array<{ id: BacktestStrategyId; label: string; description: string }> = [
  { id: 'SMA_CROSSOVER', label: 'SMA Crossover', description: 'Fast/slow simple MA cross with ATR-based SL/TP' },
  { id: 'EMA_CROSSOVER', label: 'EMA Crossover', description: 'Fast/slow exponential MA cross with ATR-based SL/TP' },
  { id: 'RSI_MEAN_REVERSION', label: 'RSI Mean Reversion', description: 'Enter on RSI oversold (long) / overbought (short)' },
  { id: 'MACD_MOMENTUM', label: 'MACD Momentum', description: 'MACD line/signal crossover momentum entries' },
  { id: 'BOLLINGER_BREAKOUT', label: 'Bollinger Breakout', description: 'Close breaking upper/lower Bollinger band' },
  { id: 'DONCHIAN_BREAKOUT', label: 'Donchian Breakout', description: 'N-bar high/low channel breakout entries' },
]

// ============================================
// DEFAULT PARAMS
// ============================================

export function defaultBacktestParams(strategy: BacktestStrategyId): BacktestParams {
  return {
    strategy,
    initialCapital: 10_000,
    positionPct: 0.1,
    slAtrMult: 2.0,
    tpAtrMult: 3.0,
    atrPeriod: 14,
    commissionPerLot: 1,
    slippageTicks: 2,
    tickSize: 0.01,
    lotSize: 100,
    fastPeriod: 10,
    slowPeriod: 20,
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
    bollingerPeriod: 20,
    bollingerStd: 2,
    donchianPeriod: 20,
    allowShort: false,
    barsPerYear: 252,
  }
}

/** Merge partial user config over defaults with clamping. */
export function mergeParams(strategy: BacktestStrategyId, config: Record<string, unknown> | undefined): BacktestParams {
  const base = defaultBacktestParams(strategy)
  if (!config || typeof config !== 'object') return base
  const out = { ...base }
  const numKeys: Array<keyof BacktestParams> = [
    'initialCapital', 'positionPct', 'slAtrMult', 'tpAtrMult', 'atrPeriod', 'commissionPerLot',
    'slippageTicks', 'tickSize', 'lotSize', 'fastPeriod', 'slowPeriod', 'rsiPeriod', 'rsiOversold',
    'rsiOverbought', 'macdFast', 'macdSlow', 'macdSignal', 'bollingerPeriod', 'bollingerStd',
    'donchianPeriod', 'barsPerYear',
  ]
  for (const k of numKeys) {
    const v = config[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      ;(out[k] as number) = Math.max(0, v)
    }
  }
  if (typeof config.allowShort === 'boolean') out.allowShort = config.allowShort
  // Clamp sanity
  out.positionPct = Math.min(1, Math.max(0.001, out.positionPct))
  out.slAtrMult = Math.min(10, Math.max(0.25, out.slAtrMult))
  out.tpAtrMult = Math.min(20, Math.max(0.25, out.tpAtrMult))
  if (out.fastPeriod >= out.slowPeriod) out.fastPeriod = Math.max(2, Math.floor(out.slowPeriod / 2))
  return out
}

// ============================================
// INDICATOR MATH (streaming, O(1) per bar)
// ============================================

/** Simple moving average with running sum. */
export class Sma {
  private buf: number[] = []
  private sum = 0
  constructor(public readonly period: number) {}
  get ready(): boolean { return this.buf.length >= this.period }
  update(price: number): number | null {
    this.buf.push(price)
    this.sum += price
    if (this.buf.length > this.period) {
      this.sum -= this.buf.shift() as number
    }
    return this.ready ? this.sum / this.period : null
  }
}

/** Exponential moving average. */
export class Ema {
  private prev: number | null = null
  private count = 0
  constructor(public readonly period: number) {}
  /** Ready only once update() will emit a value (after `period` bars). */
  get ready(): boolean { return this.prev !== null && this.count >= this.period }
  update(price: number): number | null {
    if (this.prev === null) {
      this.prev = price
      this.count = 1
      return null
    }
    this.count++
    const k = 2 / (this.period + 1)
    this.prev = price * k + this.prev * (1 - k)
    // Warm-up: emit null until period bars seen
    return this.count >= this.period ? this.prev : null
  }
}

/** Wilder's RSI. */
export class Rsi {
  private avgGain: number | null = null
  private avgLoss: number | null = null
  private prevClose: number | null = null
  private count = 0
  constructor(public readonly period: number) {}
  get ready(): boolean { return this.avgGain !== null && this.avgLoss !== null }
  update(close: number): number | null {
    if (this.prevClose === null) {
      this.prevClose = close
      return null
    }
    const change = close - this.prevClose
    this.prevClose = close
    const gain = Math.max(0, change)
    const loss = Math.max(0, -change)
    this.count++
    if (this.avgGain === null || this.avgLoss === null) {
      // Seed with simple average over first `period` changes
      if (!this._seed) this._seed = { gains: [], losses: [] }
      this._seed.gains.push(gain)
      this._seed.losses.push(loss)
      if (this._seed.gains.length >= this.period) {
        this.avgGain = this._seed.gains.reduce((a, b) => a + b, 0) / this.period
        this.avgLoss = this._seed.losses.reduce((a, b) => a + b, 0) / this.period
        this._seed = undefined
      }
      return null
    }
    // Wilder smoothing
    this.avgGain = (this.avgGain * (this.period - 1) + gain) / this.period
    this.avgLoss = (this.avgLoss * (this.period - 1) + loss) / this.period
    if (this.avgLoss === 0 && this.avgGain === 0) return 50 // flat series → neutral
    if (this.avgLoss === 0) return 100
    const rs = this.avgGain / this.avgLoss
    return 100 - 100 / (1 + rs)
  }
  private _seed?: { gains: number[]; losses: number[] }
}

/** Running ATR (Wilder). */
export class Atr {
  private trBuf: number[] = []
  private trSum = 0
  private prevClose: number | null = null
  private atr: number | null = null
  constructor(public readonly period: number) {}
  get ready(): boolean { return this.atr !== null }
  get value(): number { return this.atr ?? 0 }
  update(bar: { high: number; low: number; close: number }): number | null {
    if (this.prevClose === null) {
      this.prevClose = bar.close
      return null
    }
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - this.prevClose),
      Math.abs(bar.low - this.prevClose)
    )
    this.prevClose = bar.close
    this.trBuf.push(tr)
    this.trSum += tr
    if (this.atr === null) {
      if (this.trBuf.length >= this.period) {
        this.atr = this.trSum / this.period
      }
    } else {
      this.trSum += tr - (this.trBuf.shift() as number)
      this.atr = (this.atr * (this.period - 1) + tr) / this.period
    }
    return this.atr
  }
}

/** MACD with EMA fast/slow/signal. */
export class Macd {
  private fastEma: Ema
  private slowEma: Ema
  private signalEma: Ema
  private prevSignal: number | null = null
  private prevMacd: number | null = null
  constructor(fast: number, slow: number, signal: number) {
    this.fastEma = new Ema(fast)
    this.slowEma = new Ema(slow)
    this.signalEma = new Ema(signal)
  }
  get ready(): boolean { return this.prevSignal !== null }
  /** Returns { macd, signal, histogram, cross } — cross: +1 bullish, -1 bearish, 0 none. */
  update(close: number): { macd: number; signal: number; histogram: number; cross: number } | null {
    const fast = this.fastEma.update(close)
    const slow = this.slowEma.update(close)
    if (fast === null || slow === null) return null
    const macd = fast - slow
    const signal = this.signalEma.update(macd)
    if (signal === null) return null
    const histogram = macd - signal
    let cross = 0
    if (this.prevMacd !== null && this.prevSignal !== null) {
      if (this.prevMacd <= this.prevSignal && macd > signal) cross = 1
      else if (this.prevMacd >= this.prevSignal && macd < signal) cross = -1
    }
    this.prevMacd = macd
    this.prevSignal = signal
    return { macd, signal, histogram, cross }
  }
}

/** Bollinger Bands with running variance. */
export class BollingerBands {
  private buf: number[] = []
  private sum = 0
  private sumSq = 0
  constructor(public readonly period: number, public readonly stdMult: number) {}
  get ready(): boolean { return this.buf.length >= this.period }
  update(close: number): { upper: number; middle: number; lower: number } | null {
    this.buf.push(close)
    this.sum += close
    this.sumSq += close * close
    if (this.buf.length > this.period) {
      const old = this.buf.shift() as number
      this.sum -= old
      this.sumSq -= old * old
    }
    if (!this.ready) return null
    const n = this.period
    const mean = this.sum / n
    const variance = Math.max(0, this.sumSq / n - mean * mean)
    const std = Math.sqrt(variance)
    return { upper: mean + this.stdMult * std, middle: mean, lower: mean - this.stdMult * std }
  }
}

/** Donchian channel (N-bar highest high / lowest low). */
export class DonchianChannel {
  private highs: number[] = []
  private lows: number[] = []
  constructor(public readonly period: number) {}
  get ready(): boolean { return this.highs.length >= this.period }
  update(bar: { high: number; low: number }): { upper: number; lower: number } | null {
    this.highs.push(bar.high)
    this.lows.push(bar.low)
    if (this.highs.length > this.period) {
      this.highs.shift()
      this.lows.shift()
    }
    if (!this.ready) return null
    return {
      upper: Math.max(...this.highs),
      lower: Math.min(...this.lows),
    }
  }
}

// ============================================
// SIGNAL GENERATION (per strategy)
// ============================================

export type SignalAction = 'ENTER_LONG' | 'EXIT_LONG' | 'ENTER_SHORT' | 'EXIT_SHORT' | 'HOLD'

interface StrategyState {
  smaFast: Sma
  smaSlow: Sma
  emaFast: Ema
  emaSlow: Ema
  rsi: Rsi
  macd: Macd
  bb: BollingerBands
  donchian: DonchianChannel
  prevSmaFast: number | null
  prevSmaSlow: number | null
  prevEmaFast: number | null
  prevEmaSlow: number | null
  /** Previous-bar Bollinger bands (breakout compares vs these, not self-inclusive) */
  prevBands: { upper: number; middle: number; lower: number } | null
  /** Previous-bar Donchian channel */
  prevChannel: { upper: number; lower: number } | null
  /** RSI thresholds (from params) */
  rsiOversold: number
  rsiOverbought: number
}

function makeState(p: BacktestParams): StrategyState {
  return {
    smaFast: new Sma(p.fastPeriod),
    smaSlow: new Sma(p.slowPeriod),
    emaFast: new Ema(p.fastPeriod),
    emaSlow: new Ema(p.slowPeriod),
    rsi: new Rsi(p.rsiPeriod),
    macd: new Macd(p.macdFast, p.macdSlow, p.macdSignal),
    bb: new BollingerBands(p.bollingerPeriod, p.bollingerStd),
    donchian: new DonchianChannel(p.donchianPeriod),
    prevSmaFast: null,
    prevSmaSlow: null,
    prevEmaFast: null,
    prevEmaSlow: null,
    prevBands: null,
    prevChannel: null,
    rsiOversold: p.rsiOversold,
    rsiOverbought: p.rsiOverbought,
  }
}

/**
 * Compute the strategy's action for the current closed bar.
 * Pure per-bar state machine — no lookahead (only uses bar & prior state).
 */
export function computeSignal(
  strategy: BacktestStrategyId,
  bar: { open: number; high: number; low: number; close: number },
  state: StrategyState
): SignalAction {
  switch (strategy) {
    case 'SMA_CROSSOVER': {
      const f = state.smaFast.update(bar.close)
      const s = state.smaSlow.update(bar.close)
      if (f === null || s === null) return 'HOLD'
      const crossUp = state.prevSmaFast !== null && state.prevSmaSlow !== null && state.prevSmaFast <= state.prevSmaSlow && f > s
      const crossDown = state.prevSmaFast !== null && state.prevSmaSlow !== null && state.prevSmaFast >= state.prevSmaSlow && f < s
      state.prevSmaFast = f
      state.prevSmaSlow = s
      if (crossUp) return 'ENTER_LONG'
      if (crossDown) return 'EXIT_LONG'
      return 'HOLD'
    }
    case 'EMA_CROSSOVER': {
      const f = state.emaFast.update(bar.close)
      const s = state.emaSlow.update(bar.close)
      if (f === null || s === null) return 'HOLD'
      const crossUp = state.prevEmaFast !== null && state.prevEmaSlow !== null && state.prevEmaFast <= state.prevEmaSlow && f > s
      const crossDown = state.prevEmaFast !== null && state.prevEmaSlow !== null && state.prevEmaFast >= state.prevEmaSlow && f < s
      state.prevEmaFast = f
      state.prevEmaSlow = s
      if (crossUp) return 'ENTER_LONG'
      if (crossDown) return 'EXIT_LONG'
      return 'HOLD'
    }
    case 'RSI_MEAN_REVERSION': {
      const r = state.rsi.update(bar.close)
      if (r === null) return 'HOLD'
      if (r <= state.rsiOversold) return 'ENTER_LONG' // oversold → mean reversion long
      if (r >= state.rsiOverbought) return 'EXIT_LONG'  // overbought → exit
      return 'HOLD'
    }
    case 'MACD_MOMENTUM': {
      const m = state.macd.update(bar.close)
      if (m === null) return 'HOLD'
      if (m.cross === 1 && m.histogram > 0) return 'ENTER_LONG'
      if (m.cross === -1 && m.histogram < 0) return 'EXIT_LONG'
      return 'HOLD'
    }
    case 'BOLLINGER_BREAKOUT': {
      const b = state.bb.update(bar.close)
      if (b === null) {
        state.prevBands = null
        return 'HOLD'
      }
      // Compare the CLOSE against the PREVIOUS bar's bands so the current
      // bar is not part of the band it breaks (no self-inclusive breakout).
      const prev = state.prevBands
      state.prevBands = b
      if (prev && bar.close > prev.upper) return 'ENTER_LONG'
      if (prev && bar.close < prev.middle) return 'EXIT_LONG'
      return 'HOLD'
    }
    case 'DONCHIAN_BREAKOUT': {
      const d = state.donchian.update(bar)
      if (d === null) {
        state.prevChannel = null
        return 'HOLD'
      }
      // Breakout vs the PREVIOUS channel (channel must not include current bar)
      const prev = state.prevChannel
      state.prevChannel = d
      if (prev && bar.close > prev.upper) return 'ENTER_LONG'
      if (prev && bar.close < prev.lower) return 'EXIT_LONG'
      return 'HOLD'
    }
    default:
      return 'HOLD'
  }
}

// ============================================
// CORE ENGINE
// ============================================

interface OpenPosition {
  direction: 'BUY' | 'SELL'
  entryBar: number
  entryTime: Date
  entryPrice: number // slippage-adjusted fill
  shares: number
  lots: number
  sl: number
  tp: number
  commission: number
}

/**
 * Run a full backtest over the candle series.
 * Deterministic — same candles + params ⇒ same result.
 */
export function runBacktest(
  candles: BacktestCandle[],
  params: BacktestParams,
  opts?: { maxEquityPoints?: number }
): BacktestResult {
  const startedAt = new Date()
  const t0 = Date.now()
  const warnings: string[] = []
  const maxEquityPoints = opts?.maxEquityPoints ?? 2_000

  const trades: BacktestTradeRecord[] = []
  const equityCurve: EquityCurvePoint[] = []

  let equity = params.initialCapital
  let peakEquity = equity
  let maxDd = 0
  let maxDdAbs = 0
  let barsInPosition = 0

  const state = makeState(params)
  const atr = new Atr(params.atrPeriod)
  let position: OpenPosition | null = null
  let seq = 0

  const warmupNeeded = warmupBars(params.strategy, params)
  if (candles.length < warmupNeeded + 2) {
    warnings.push(`Insufficient candles: ${candles.length} provided, ~${warmupNeeded} needed for warm-up`)
  }

  const slippage = params.slippageTicks * params.tickSize

  const recordEquity = (time: Date | string) => {
    if (equityCurve.length < maxEquityPoints) {
      equityCurve.push({
        date: new Date(time).toISOString(),
        equity: Math.round(equity * 100) / 100,
        drawdown: Math.round(((peakEquity - equity) / peakEquity) * 10000) / 100,
      })
    }
  }

  const closePosition = (
    pos: OpenPosition,
    exitPrice: number,
    exitTime: Date | string,
    reason: BacktestTradeRecord['exitReason']
  ) => {
    // Apply slippage against the trader on exit
    const filledExit = pos.direction === 'BUY' ? exitPrice - slippage : exitPrice + slippage
    const grossPnl =
      pos.direction === 'BUY'
        ? (filledExit - pos.entryPrice) * pos.shares
        : (pos.entryPrice - filledExit) * pos.shares
    const netPnl = grossPnl - pos.commission // commission charged once at entry (includes exit estimate)
    equity += netPnl

    peakEquity = Math.max(peakEquity, equity)
    const dd = (peakEquity - equity) / peakEquity
    maxDd = Math.max(maxDd, dd)
    maxDdAbs = Math.max(maxDdAbs, peakEquity - equity)

    seq++
    trades.push({
      sequence: seq,
      direction: pos.direction,
      entryTime: new Date(pos.entryTime),
      exitTime: new Date(exitTime),
      entryPrice: Math.round(pos.entryPrice * 100) / 100,
      exitPrice: Math.round(filledExit * 100) / 100,
      shares: pos.shares,
      lotSize: pos.lots,
      pnl: Math.round(netPnl * 100) / 100,
      pnlPercent: Math.round((netPnl / Math.max(1, equity - netPnl)) * 10000) / 100,
      commission: Math.round(pos.commission * 100) / 100,
      exitReason: reason,
      equityAfter: Math.round(equity * 100) / 100,
      drawdownAfter: Math.round(dd * 10000) / 100,
    })
    recordEquity(exitTime)
  }

  // ---- main loop over CLOSED bars ----
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]
    const barTime = new Date(bar.openTime)

    // 1. Update ATR first (needed for new position sizing)
    atr.update(bar)

    // 2. If in position, check SL/TP intrabar (pessimistic: SL has priority)
    if (position) {
      barsInPosition++
      const pos = position
      if (pos.direction === 'BUY') {
        if (bar.low <= pos.sl) {
          closePosition(pos, pos.sl, barTime, 'SL')
          position = null
        } else if (bar.high >= pos.tp) {
          closePosition(pos, pos.tp, barTime, 'TP')
          position = null
        }
      } else {
        if (bar.high >= pos.sl) {
          closePosition(pos, pos.sl, barTime, 'SL')
          position = null
        } else if (bar.low <= pos.tp) {
          closePosition(pos, pos.tp, barTime, 'TP')
          position = null
        }
      }
    }

    // 3. Strategy signal evaluated on the closed bar
    const action = computeSignal(params.strategy, bar, state)

    if (position && (action === 'EXIT_LONG' || action === 'EXIT_SHORT')) {
      closePosition(position, bar.close, barTime, 'SIGNAL')
      position = null
    } else if (!position && (action === 'ENTER_LONG' || (action === 'ENTER_SHORT' && params.allowShort))) {
      // Only enter after indicator warm-up
      if (atr.ready && i >= warmupNeeded) {
        const direction: 'BUY' | 'SELL' = action === 'ENTER_LONG' || action === 'ENTER_SHORT' ? (action === 'ENTER_LONG' ? 'BUY' : 'SELL') : 'BUY'
        const notional = equity * params.positionPct
        const rawPrice = bar.close
        const fillPrice = direction === 'BUY' ? rawPrice + slippage : rawPrice - slippage
        const shares = Math.max(0, Math.floor(notional / Math.max(fillPrice, 0.01)))
        if (shares > 0) {
          const lots = shares / params.lotSize
          const commission = Math.max(params.commissionPerLot * lots, params.commissionPerLot) // round-trip estimate charged at entry
          const atrVal = atr.value
          const slDist = Math.max(params.slAtrMult * atrVal, 2 * params.tickSize)
          const tpDist = Math.max(params.tpAtrMult * atrVal, 2 * params.tickSize)
          position = {
            direction,
            entryBar: i,
            entryTime: barTime,
            entryPrice: fillPrice,
            shares,
            lots: Math.round(lots * 100) / 100,
            sl: direction === 'BUY' ? fillPrice - slDist : fillPrice + slDist,
            tp: direction === 'BUY' ? fillPrice + tpDist : fillPrice - tpDist,
            commission: Math.round(commission * 100) / 100,
          }
        }
      }
    }

    // 4. Mark-to-market equity sample (unrealized)
    if (equityCurve.length < maxEquityPoints && i % Math.max(1, Math.floor(candles.length / maxEquityPoints)) === 0) {
      recordEquity(barTime)
    }
  }

  // 5. Force-close at end of data
  if (position) {
    const last = candles[candles.length - 1]
    closePosition(position, last.close, new Date(last.openTime), 'END_OF_DATA')
    position = null
    warnings.push('Open position force-closed at end of data')
  }

  // ---- metrics ----
  const metrics = computeMetrics(trades, equityCurve, params, candles.length, barsInPosition, maxDd, maxDdAbs)

  return {
    metrics,
    trades,
    equityCurve,
    params,
    strategy: params.strategy,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    warnings,
  }
}

/** Estimated warm-up bars before signals become reliable. */
export function warmupBars(strategy: BacktestStrategyId, p: BacktestParams): number {
  switch (strategy) {
    case 'SMA_CROSSOVER': return p.slowPeriod + p.atrPeriod + 1
    case 'EMA_CROSSOVER': return p.slowPeriod + p.atrPeriod + 1
    case 'RSI_MEAN_REVERSION': return p.rsiPeriod * 2 + 1
    case 'MACD_MOMENTUM': return p.macdSlow + p.macdSignal + p.atrPeriod + 1
    case 'BOLLINGER_BREAKOUT': return p.bollingerPeriod + p.atrPeriod + 1
    case 'DONCHIAN_BREAKOUT': return p.donchianPeriod + p.atrPeriod + 1
    default: return 50
  }
}

// ============================================
// SYNTHETIC DATA GENERATOR (deterministic)
// ============================================

/** Deterministic PRNG (mulberry32) — same seed ⇒ same series. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash a string into a 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface SyntheticCandleOptions {
  symbol: string
  timeframe: string
  bars: number
  startPrice?: number
  /** Annualised-ish drift per bar fraction */
  drift?: number
  volatility?: number
  startDate?: Date
}

/**
 * Generate a deterministic synthetic candle series (random walk with drift,
  volatility clustering, and realistic OHLC bar construction).
 * Used when no real candle data is available so the engine still produces
 * a REAL simulation (strategy math runs on synthetic prices) instead of mock metrics.
 */
export function generateSyntheticCandles(opts: SyntheticCandleOptions): BacktestCandle[] {
  const { symbol, timeframe, bars } = opts
  const seed = hashSeed(`${symbol}:${timeframe}:${bars}`)
  const rand = mulberry32(seed)
  // Price range compatible with typical demo capital ($10k) — 1 lot stays affordable
  const startPrice = opts.startPrice ?? 50 + Math.floor(rand() * 450)
  const drift = opts.drift ?? 0.0003
  const baseVol = opts.volatility ?? 0.02

  const candles: BacktestCandle[] = []
  let price = startPrice
  let vol = baseVol
  let t = (opts.startDate ?? new Date(Date.now() - bars * 3_600_000)).getTime()

  // Rough bar duration by timeframe
  const tfMinutes: Record<string, number> = {
    M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440, W1: 10080,
  }
  const stepMs = (tfMinutes[timeframe.toUpperCase()] ?? 60) * 60_000

  for (let i = 0; i < bars; i++) {
    // Volatility clustering (GARCH-lite)
    vol = 0.9 * vol + 0.1 * baseVol * (0.5 + rand())
    const shock = (rand() * 2 - 1) * vol
    const ret = drift + shock
    const open = price
    const close = Math.max(1, open * (1 + ret))
    const wick = Math.abs(ret) * open * (0.5 + rand()) + open * 0.001
    const high = Math.max(open, close) + wick * rand()
    const low = Math.max(0.5, Math.min(open, close) - wick * rand())
    const volume = Math.floor(10_000 + rand() * 900_000)

    candles.push({ openTime: new Date(t), open, high, low, close, volume })
    price = close
    t += stepMs
  }
  return candles
}

// ============================================
// METRICS COMPUTATION (pure — unit tested)
// ============================================

export function computeMetrics(
  trades: BacktestTradeRecord[],
  equityCurve: EquityCurvePoint[],
  params: BacktestParams,
  totalBars: number,
  barsInPosition: number,
  maxDd: number,
  maxDdAbs: number
): BacktestMetrics {
  const initialCapital = params.initialCapital
  const finalCapital = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital + trades.reduce((s, t) => s + t.pnl, 0)
  const totalPnl = Math.round((finalCapital - initialCapital) * 100) / 100
  const totalTrades = trades.length
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl <= 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0

  // Consecutive streaks
  let maxConsecWins = 0, maxConsecLosses = 0, curW = 0, curL = 0
  for (const t of trades) {
    if (t.pnl > 0) { curW++; curL = 0 } else { curL++; curW = 0 }
    maxConsecWins = Math.max(maxConsecWins, curW)
    maxConsecLosses = Math.max(maxConsecLosses, curL)
  }

  // Per-trade returns for Sharpe/Sortino
  const returns = trades.map((t) => t.pnl / Math.max(1, initialCapital))
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const variance = returns.length > 1 ? returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1) : 0
  const std = Math.sqrt(variance)
  const downside = returns.filter((r) => r < 0)
  const downsideMean = downside.length > 0 ? downside.reduce((a, b) => a + b, 0) / downside.length : 0
  const downsideVar = downside.length > 1 ? downside.reduce((s, r) => s + (r - downsideMean) ** 2, 0) / (downside.length - 1) : 0
  const downsideStd = Math.sqrt(downsideVar)

  // Annualised Sharpe on per-trade returns scaled by trades per year approximation
  const tradesPerYear = params.barsPerYear / Math.max(1, totalBars / Math.max(1, totalTrades))
  const annualFactor = Math.sqrt(Math.max(1, tradesPerYear))
  const sharpe = std > 0 ? (meanRet / std) * annualFactor : null
  const sortino = downsideStd > 0 ? (meanRet / downsideStd) * annualFactor : null
  const annualReturn = totalPnl / initialCapital
  const calmar = maxDd > 0 ? annualReturn / maxDd : null

  const commissionTotal = trades.reduce((s, t) => s + t.commission, 0)

  return {
    initialCapital,
    finalCapital: Math.round(finalCapital * 100) / 100,
    totalPnl,
    totalPnlPct: Math.round((totalPnl / initialCapital) * 10000) / 100,
    totalTrades,
    winTrades: wins.length,
    lossTrades: losses.length,
    winRate: totalTrades > 0 ? Math.round((wins.length / totalTrades) * 10000) / 100 : 0,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    avgTradePnl: totalTrades > 0 ? Math.round((totalPnl / totalTrades) * 100) / 100 : 0,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? null : 0,
    expectancy: Math.round(((wins.length / Math.max(1, totalTrades)) * avgWin - (losses.length / Math.max(1, totalTrades)) * avgLoss) * 100) / 100,
    sharpeRatio: sharpe !== null ? Math.round(sharpe * 100) / 100 : null,
    sortinoRatio: sortino !== null ? Math.round(sortino * 100) / 100 : null,
    calmarRatio: calmar !== null && Number.isFinite(calmar) ? Math.round(calmar * 100) / 100 : null,
    maxDrawdown: Math.round(maxDd * 10000) / 100,
    maxDrawdownAbs: Math.round(maxDdAbs * 100) / 100,
    maxConsecWins,
    maxConsecLosses,
    commissionTotal: Math.round(commissionTotal * 100) / 100,
    totalBars,
    exposurePct: totalBars > 0 ? Math.round((barsInPosition / totalBars) * 10000) / 100 : 0,
  }
}
