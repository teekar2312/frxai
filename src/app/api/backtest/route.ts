import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

// ---------- Timeframe normalisation ----------
// UI sends "1m", "5m", "1H", "1D" etc.  DB stores "M1", "M5", "H1", "D1"
const TF_MAP: Record<string, string> = {
  "1m": "M1", "5m": "M5", "15m": "M15",
  "30m": "M30", "1H": "H1", "4H": "H4",
  "1D": "D1", "1W": "W1",
}

function normalizeTf(tf: string): string {
  return TF_MAP[tf] ?? tf.toUpperCase()
}

// ---------- Validation ----------
interface BacktestPayload {
  symbol: string
  strategy: string
  timeframe: string
  startDate?: string
  endDate?: string
  initialCapital: number
  config?: Record<string, unknown>
  name?: string
}

function validatePayload(body: Record<string, unknown>): { ok: true; data: BacktestPayload } | { ok: false; error: string } {
  const symbol = typeof body.symbol === "string" && body.symbol.trim() ? body.symbol.trim() : ""
  const strategy = typeof body.strategy === "string" && body.strategy.trim() ? body.strategy.trim() : ""
  const timeframe = typeof body.timeframe === "string" && body.timeframe.trim() ? body.timeframe.trim() : ""

  if (!symbol) return { ok: false, error: "symbol is required" }
  if (!strategy) return { ok: false, error: "strategy is required" }
  if (!timeframe) return { ok: false, error: "timeframe is required" }

  const capital = typeof body.initialCapital === "number" ? body.initialCapital : 10000
  if (capital <= 0) return { ok: false, error: "initialCapital must be > 0" }

  let startDate: Date | undefined
  let endDate: Date | undefined

  if (body.startDate) {
    startDate = new Date(body.startDate as string)
    if (isNaN(startDate.getTime())) return { ok: false, error: "startDate is not a valid date" }
  }
  if (body.endDate) {
    endDate = new Date(body.endDate as string)
    if (isNaN(endDate.getTime())) return { ok: false, error: "endDate is not a valid date" }
  }
  if (startDate && endDate && startDate >= endDate) {
    return { ok: false, error: "startDate must be before endDate" }
  }

  return {
    ok: true,
    data: {
      symbol,
      strategy,
      timeframe,
      startDate: startDate ? startDate.toISOString() : undefined,
      endDate: endDate ? endDate.toISOString() : undefined,
      initialCapital: capital,
      config: typeof body.config === "object" && body.config ? (body.config as Record<string, unknown>) : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
    },
  }
}

// ---------- Technical helpers ----------

/** O(n) SMA for initial computation — kept for seeding running sums */
function sma(closes: number[], period: number): number {
  if (closes.length < period) return 0
  let sum = 0
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]
  return sum / period
}

/**
 * O(1) running ATR state. Call `update()` with each new bar to get the current ATR.
 * Seeds with a simple average of the first `period` true ranges.
 */
class RunningAtr {
  private trBuffer: number[] = []
  private trSum = 0
  private prevClose: number | null = null
  readonly period: number
  value = 0
  seeded = false

  constructor(period: number) {
    this.period = period
  }

  /** Process one bar and return the current ATR value. */
  update(bar: { high: number; low: number; close: number }): number {
    if (this.prevClose === null) {
      this.prevClose = bar.close
      return 0
    }

    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - this.prevClose),
      Math.abs(bar.low - this.prevClose),
    )
    this.prevClose = bar.close

    if (!this.seeded) {
      this.trBuffer.push(tr)
      this.trSum += tr
      if (this.trBuffer.length === this.period) {
        this.value = this.trSum / this.period
        this.seeded = true
      }
      return 0
    }

    // Running: subtract oldest TR, add newest
    this.trSum += tr - this.trBuffer.shift()!
    this.trBuffer.push(tr)
    this.value = this.trSum / this.period
    return this.value
  }
}

// ---------- Timeframe helpers ----------

/** Check if a timeframe is intraday (M1, M5, M15, M30, H1, H4) */
function isIntradayTf(tf: string): boolean {
  const t = tf.toUpperCase()
  return t === "M1" || t === "M5" || t === "M15" || t === "M30" || t === "H1" || t === "H4"
}

/** Approximate number of bars per year for Sharpe annualisation.
 * IDX trades 09:00-16:15 WIB = 435 min/day, ~250 trading days/year. */
function getBarsPerYear(timeframe: string): number {
  const t = timeframe.toUpperCase()
  const IDX_MINUTES_PER_DAY = 435 // 09:00-16:15 WIB
  const TRADING_DAYS = 250
  switch (t) {
    case "M1":  return Math.floor(IDX_MINUTES_PER_DAY) * TRADING_DAYS       // ~108,750
    case "M5":  return Math.floor(IDX_MINUTES_PER_DAY / 5) * TRADING_DAYS    // ~21,750
    case "M15": return Math.floor(IDX_MINUTES_PER_DAY / 15) * TRADING_DAYS   // ~7,250
    case "M30": return Math.floor(IDX_MINUTES_PER_DAY / 30) * TRADING_DAYS   // ~3,625
    case "H1":  return Math.floor(IDX_MINUTES_PER_DAY / 60) * TRADING_DAYS   // ~1,812
    case "H4":  return Math.floor(IDX_MINUTES_PER_DAY / 240) * TRADING_DAYS  // ~453
    case "D1":  return 252              // trading days
    case "W1":  return 52
    default:    return 252
  }
}

// ---------- SimTrade interface ----------

interface SimTrade {
  entryBar: number
  exitBar: number
  direction: "LONG" | "SHORT"
  entryPrice: number
  exitPrice: number
  pnl: number
  commission: number
  sl: number
  tp: number
}

// ---------- Pip value for slippage ----------

/** For IDX stocks, 1 tick = Rp1 = 0.01 */
function getPipValue(): number {
  return 0.01
}

// =============================================
// SMA CROSSOVER ENGINE (with O(1) running SMA, slippage, intraday equity)
// =============================================

function runSmaCrossover(
  candles: { openTime: Date; high: number; low: number; close: number }[],
  capital: number,
  riskPerTradePct: number,
  slAtrMult: number,
  tpAtrMult: number,
  commissionPerLot: number,
  slippagePips: number,
  isIntraday: boolean,
): { trades: SimTrade[]; equityCurve: { date: string; equity: number }[] } {
  const FAST = 10
  const SLOW = 20
  const ATR_PERIOD = 14
  const POSITION_PCT = 0.10
  const LOT_SIZE = 100
  const pipValue = getPipValue()
  const MAX_EQUITY_POINTS = 2000

  const trades: SimTrade[] = []
  const equityCurve: { date: string; equity: number }[] = []
  let equity = capital
  let inPosition = false
  let posDirection: "LONG" | "SHORT" = "LONG"
  let posEntryBar = 0
  let posEntryPrice = 0
  let posSl = 0
  let posTp = 0
  let posShares = 0
  let posCommission = 0

  if (candles.length < SLOW + 1) {
    return { trades, equityCurve }
  }

  // ---- O(1) SMA using running sums ----
  let fastSum = 0
  for (let i = 0; i < FAST; i++) fastSum += candles[i].close
  let slowSum = 0
  for (let i = 0; i < SLOW; i++) slowSum += candles[i].close

  // ---- O(1) running ATR ----
  const runningAtr = new RunningAtr(ATR_PERIOD)
  // Pre-seed ATR from bars before the main loop
  for (let i = 0; i < SLOW; i++) runningAtr.update(candles[i])

  for (let i = SLOW; i < candles.length; i++) {
    // Update running sums: add new close, subtract old close
    const newClose = candles[i].close
    const oldFastClose = candles[i - FAST].close
    const oldSlowClose = candles[i - SLOW].close
    fastSum += newClose - oldFastClose
    slowSum += newClose - oldSlowClose

    const fastNow = fastSum / FAST
    const slowNow = slowSum / SLOW

    // For previous values, we need to look back one bar
    let prevFast: number
    let prevSlow: number
    if (i === SLOW) {
      const prevCloses = candles.slice(0, i).map((c) => c.close)
      prevFast = sma(prevCloses, FAST)
      prevSlow = sma(prevCloses, SLOW)
    } else {
      const prevFastSum = fastSum - newClose + oldFastClose
      const prevSlowSum = slowSum - newClose + oldSlowClose
      prevFast = prevFastSum / FAST
      prevSlow = prevSlowSum / SLOW
    }

    const currentAtr = runningAtr.update(candles[i])

    // Check exit for open position
    if (inPosition) {
      const bar = candles[i]
      let exitPrice: number | null = null
      if (posDirection === "LONG") {
        if (bar.low <= posSl) exitPrice = posSl
        else if (bar.high >= posTp) exitPrice = posTp
      } else {
        if (bar.high >= posSl) exitPrice = posSl
        else if (bar.low <= posTp) exitPrice = posTp
      }

      if (exitPrice !== null) {
        // Slippage on exit — worsen price in unfavorable direction
        if (posDirection === "LONG") {
          exitPrice -= slippagePips * pipValue
        } else {
          exitPrice += slippagePips * pipValue
        }

        const rawPnl = posDirection === "LONG"
          ? (exitPrice - posEntryPrice) * posShares
          : (posEntryPrice - exitPrice) * posShares
        const closeCommission = commissionPerLot * Math.ceil(posShares / LOT_SIZE)
        const roundTripCommission = posCommission + closeCommission
        const netPnl = rawPnl - roundTripCommission
        equity += netPnl

        trades.push({
          entryBar: posEntryBar,
          exitBar: i,
          direction: posDirection,
          entryPrice: Math.round(posEntryPrice * 10000) / 10000,
          exitPrice: Math.round(exitPrice * 10000) / 10000,
          pnl: Math.round(netPnl * 100) / 100,
          commission: Math.round(roundTripCommission * 100) / 100,
          sl: Math.round(posSl * 10000) / 10000,
          tp: Math.round(posTp * 10000) / 10000,
        })

        inPosition = false
      }
    }

    // Check entry signal (only if not in position)
    if (!inPosition && currentAtr > 0) {
      const buySignal = prevFast <= prevSlow && fastNow > slowNow
      const sellSignal = prevFast >= prevSlow && fastNow < slowNow

      if (buySignal || sellSignal) {
        const dir = buySignal ? "LONG" : "SHORT"
        let entryPrice = candles[i].close

        // Slippage on entry — worsen price in unfavorable direction
        if (dir === "LONG") {
          entryPrice += slippagePips * pipValue
        } else {
          entryPrice -= slippagePips * pipValue
        }

        const slDist = currentAtr * slAtrMult
        const tpDist = currentAtr * tpAtrMult

        const sl = dir === "LONG" ? entryPrice - slDist : entryPrice + slDist
        const tp = dir === "LONG" ? entryPrice + tpDist : entryPrice - tpDist

        const investAmount = equity * POSITION_PCT
        const shares = Math.max(1, Math.floor(investAmount / entryPrice))
        const openCommission = commissionPerLot * Math.ceil(shares / LOT_SIZE)

        posDirection = dir
        posEntryBar = i
        posEntryPrice = entryPrice
        posSl = sl
        posTp = tp
        posShares = shares
        posCommission = openCommission
        inPosition = true
      }
    }

    // Equity curve: include mark-to-market for open positions
    let markToMarketEquity = equity
    if (inPosition) {
      const unrealizedPnl = posDirection === "LONG"
        ? (candles[i].close - posEntryPrice) * posShares
        : (posEntryPrice - candles[i].close) * posShares
      markToMarketEquity = equity + unrealizedPnl
    }

    const dateStr = candles[i].openTime.toISOString().split("T")[0]
    if (isIntraday) {
      equityCurve.push({ date: dateStr, equity: Math.round(markToMarketEquity * 100) / 100 })
    } else {
      const lastDate = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].date : ""
      if (dateStr !== lastDate) {
        equityCurve.push({ date: dateStr, equity: Math.round(markToMarketEquity * 100) / 100 })
      }
    }
  }

  // Cap equity curve at MAX_EQUITY_POINTS by subsampling evenly
  if (equityCurve.length > MAX_EQUITY_POINTS) {
    const step = equityCurve.length / MAX_EQUITY_POINTS
    const sampled: { date: string; equity: number }[] = []
    for (let i = 0; i < MAX_EQUITY_POINTS; i++) {
      const idx = Math.min(Math.floor(i * step), equityCurve.length - 1)
      sampled.push(equityCurve[idx])
    }
    // Always include the last point
    if (sampled[sampled.length - 1] !== equityCurve[equityCurve.length - 1]) {
      sampled[sampled.length - 1] = equityCurve[equityCurve.length - 1]
    }
    return { trades, equityCurve: sampled }
  }

  return { trades, equityCurve }
}

// =============================================
// EMA CROSSOVER ENGINE (Improvement 1)
// =============================================

function runEmaCrossover(
  candles: { openTime: Date; high: number; low: number; close: number }[],
  capital: number,
  _riskPerTradePct: number,
  slAtrMult: number,
  tpAtrMult: number,
  commissionPerLot: number,
  slippagePips: number,
  isIntraday: boolean,
): { trades: SimTrade[]; equityCurve: { date: string; equity: number }[] } {
  const FAST_PERIOD = 12
  const SLOW_PERIOD = 26
  const ATR_PERIOD = 14
  const POSITION_PCT = 0.10
  const LOT_SIZE = 100
  const pipValue = getPipValue()
  const MAX_EQUITY_POINTS = 2000

  const trades: SimTrade[] = []
  const equityCurve: { date: string; equity: number }[] = []
  let equity = capital
  let inPosition = false
  let posDirection: "LONG" | "SHORT" = "LONG"
  let posEntryBar = 0
   let posEntryPrice = 0
  let posSl = 0
  let posTp = 0
  let posShares = 0
  let posCommission = 0

  if (candles.length < SLOW_PERIOD + 1) {
    return { trades, equityCurve }
  }

  // EMA calculation: EMA_today = close * k + EMA_yesterday * (1 - k), where k = 2 / (period + 1)
  const fastK = 2 / (FAST_PERIOD + 1)
  const slowK = 2 / (SLOW_PERIOD + 1)

  // Seed EMA with SMA of the first `period` closes
  let fastEma = 0
  for (let i = 0; i < FAST_PERIOD; i++) fastEma += candles[i].close
  fastEma /= FAST_PERIOD

  let slowEma = 0
  for (let i = 0; i < SLOW_PERIOD; i++) slowEma += candles[i].close
  slowEma /= SLOW_PERIOD

  // Advance fastEma from bar FAST_PERIOD to SLOW_PERIOD-1 so both EMAs
  // are properly converged before the main signal loop starts at SLOW_PERIOD.
  for (let i = FAST_PERIOD; i < SLOW_PERIOD; i++) {
    fastEma = candles[i].close * fastK + fastEma * (1 - fastK)
  }

  // Track previous EMA values for crossover detection
  let prevFastEma = fastEma
  let prevSlowEma = slowEma

  // O(1) running ATR
  const runningAtr = new RunningAtr(ATR_PERIOD)
  for (let i = 0; i < SLOW_PERIOD; i++) runningAtr.update(candles[i])

  // Now iterate: at bar i, compute EMA, then check signal
  for (let i = SLOW_PERIOD; i < candles.length; i++) {
    prevFastEma = fastEma
    prevSlowEma = slowEma

    // Update EMAs with current close
    fastEma = candles[i].close * fastK + fastEma * (1 - fastK)
    slowEma = candles[i].close * slowK + slowEma * (1 - slowK)

    const currentAtr = runningAtr.update(candles[i])

    // Check exit for open position
    if (inPosition) {
      const bar = candles[i]
      let exitPrice: number | null = null
      if (posDirection === "LONG") {
        if (bar.low <= posSl) exitPrice = posSl
        else if (bar.high >= posTp) exitPrice = posTp
      } else {
        if (bar.high >= posSl) exitPrice = posSl
        else if (bar.low <= posTp) exitPrice = posTp
      }

      if (exitPrice !== null) {
        // Slippage on exit
        if (posDirection === "LONG") {
          exitPrice -= slippagePips * pipValue
        } else {
          exitPrice += slippagePips * pipValue
        }

        const rawPnl = posDirection === "LONG"
          ? (exitPrice - posEntryPrice) * posShares
          : (posEntryPrice - exitPrice) * posShares
        const closeCommission = commissionPerLot * Math.ceil(posShares / LOT_SIZE)
        const roundTripCommission = posCommission + closeCommission
        const netPnl = rawPnl - roundTripCommission
        equity += netPnl

        trades.push({
          entryBar: posEntryBar,
          exitBar: i,
          direction: posDirection,
          entryPrice: Math.round(posEntryPrice * 10000) / 10000,
          exitPrice: Math.round(exitPrice * 10000) / 10000,
          pnl: Math.round(netPnl * 100) / 100,
          commission: Math.round(roundTripCommission * 100) / 100,
          sl: Math.round(posSl * 10000) / 10000,
          tp: Math.round(posTp * 10000) / 10000,
        })

        inPosition = false
      }
    }

    // Check entry signal
    if (!inPosition && currentAtr > 0) {
      const buySignal = prevFastEma <= prevSlowEma && fastEma > slowEma
      const sellSignal = prevFastEma >= prevSlowEma && fastEma < slowEma

      if (buySignal || sellSignal) {
        const dir = buySignal ? "LONG" : "SHORT"
        let entryPrice = candles[i].close

        // Slippage on entry
        if (dir === "LONG") {
          entryPrice += slippagePips * pipValue
        } else {
          entryPrice -= slippagePips * pipValue
        }

        const slDist = currentAtr * slAtrMult
        const tpDist = currentAtr * tpAtrMult

        const sl = dir === "LONG" ? entryPrice - slDist : entryPrice + slDist
        const tp = dir === "LONG" ? entryPrice + tpDist : entryPrice - tpDist

        const investAmount = equity * POSITION_PCT
        const shares = Math.max(1, Math.floor(investAmount / entryPrice))
        const openCommission = commissionPerLot * Math.ceil(shares / LOT_SIZE)

        posDirection = dir
        posEntryBar = i
        posEntryPrice = entryPrice
        posSl = sl
        posTp = tp
        posShares = shares
        posCommission = openCommission
        inPosition = true
      }
    }

    // Equity curve: include mark-to-market for open positions
    let markToMarketEquity = equity
    if (inPosition) {
      const unrealizedPnl = posDirection === "LONG"
        ? (candles[i].close - posEntryPrice) * posShares
        : (posEntryPrice - candles[i].close) * posShares
      markToMarketEquity = equity + unrealizedPnl
    }

    const dateStr = candles[i].openTime.toISOString().split("T")[0]
    if (isIntraday) {
      equityCurve.push({ date: dateStr, equity: Math.round(markToMarketEquity * 100) / 100 })
    } else {
      const lastDate = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].date : ""
      if (dateStr !== lastDate) {
        equityCurve.push({ date: dateStr, equity: Math.round(markToMarketEquity * 100) / 100 })
      }
    }
  }

  // Cap equity curve at MAX_EQUITY_POINTS
  if (equityCurve.length > MAX_EQUITY_POINTS) {
    const step = equityCurve.length / MAX_EQUITY_POINTS
    const sampled: { date: string; equity: number }[] = []
    for (let i = 0; i < MAX_EQUITY_POINTS; i++) {
      const idx = Math.min(Math.floor(i * step), equityCurve.length - 1)
      sampled.push(equityCurve[idx])
    }
    if (sampled[sampled.length - 1] !== equityCurve[equityCurve.length - 1]) {
      sampled[sampled.length - 1] = equityCurve[equityCurve.length - 1]
    }
    return { trades, equityCurve: sampled }
  }

  return { trades, equityCurve }
}

// ---------- Metrics computation ----------

function computeMetrics(
  trades: SimTrade[],
  capital: number,
  equityCurve: { date: string; equity: number }[],
  timeframe: string,
) {
  const totalTrades = trades.length
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const winTrades = wins.length
  const lossTrades = losses.length
  const winRate = totalTrades > 0 ? Math.round((winTrades / totalTrades) * 10000) / 100 : 0

  const avgWin = wins.length > 0
    ? Math.round((wins.reduce((s, t) => s + t.pnl, 0) / wins.length) * 100) / 100
    : 0
  const avgLoss = losses.length > 0
      ? Math.round((losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length) * 100) / 100
      : 0

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? null : 0

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const finalCapital = Math.round((capital + totalPnl) * 100) / 100

  // Max drawdown from equity curve
  let peak = capital
  let maxDd = 0
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity
    const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0
    if (dd > maxDd) maxDd = dd
  }
  const maxDrawdown = Math.round(maxDd * 100) / 100

  // Improvement 4: Sharpe ratio from equity curve, annualized by timeframe
  if (equityCurve.length < 2) {
    return {
      totalTrades, winTrades, lossTrades, winRate,
      avgWin, avgLoss, profitFactor, totalPnl,
      finalCapital, maxDrawdown, sharpeRatio: 0,
    }
  }

  // Build returns array from equity curve points
  const returns: number[] = []
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity
    const curr = equityCurve[i].equity
    if (prev > 0) {
      returns.push((curr - prev) / prev)
    }
  }

  if (returns.length < 2) {
    return {
      totalTrades, winTrades, lossTrades, winRate,
      avgWin, avgLoss, profitFactor, totalPnl,
      finalCapital, maxDrawdown, sharpeRatio: 0,
    }
  }

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const stdReturn = Math.sqrt(
    returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length,
  )

  // Annualize based on bars per year for this timeframe
  const barsPerYear = getBarsPerYear(timeframe)
  const sharpeRatio = stdReturn > 0
    ? Math.round((avgReturn / stdReturn) * Math.sqrt(barsPerYear) * 100) / 100
    : 0

  return {
    totalTrades, winTrades, lossTrades, winRate,
    avgWin, avgLoss, profitFactor, totalPnl,
    finalCapital, maxDrawdown, sharpeRatio,
  }
}

// ---------- Mock fallback ----------

function generateMockResult(
  symbol: string,
  strategy: string,
  timeframe: string,
  capital: number,
  start: Date,
  end: Date,
  config: Record<string, unknown>,
) {
  const totalTrades = Math.floor(80 + Math.random() * 220)
  const winRate = Math.round((42 + Math.random() * 23) * 100) / 100
  const winTrades = Math.round(totalTrades * (winRate / 100))
  const lossTrades = totalTrades - winTrades
  const avgWin = Math.round((30 + Math.random() * 120) * 100) / 100
  const avgLoss = Math.round((15 + Math.random() * 60) * 100) / 100
  const profitFactor = Math.round(((winTrades * avgWin) / Math.max(lossTrades * avgLoss, 0.01)) * 100) / 100
  const grossProfit = winTrades * avgWin
  const grossLoss = lossTrades * avgLoss
  const netProfit = grossProfit - grossLoss
  const finalCapital = Math.round((capital + netProfit) * 100) / 100
  const maxDrawdown = Math.round((5 + Math.random() * 20) * 100) / 100
  const sharpeRatio = Math.round((-0.5 + Math.random() * 3.5) * 100) / 100

  const daysDiff = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
  const equityCurve: { date: string; equity: number }[] = []
  let equity = capital
  for (let i = 0; i <= Math.min(daysDiff, 365); i++) {
    equity += (netProfit / Math.min(daysDiff, 365)) * (0.8 + Math.random() * 0.4)
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
    equityCurve.push({
      date: d.toISOString().split("T")[0],
      equity: Math.round(equity * 100) / 100,
    })
  }

  return {
    totalTrades, winTrades, lossTrades, winRate,
    avgWin, avgLoss, profitFactor, totalPnl: netProfit,
    finalCapital, maxDrawdown, sharpeRatio, equityCurve,
    config: JSON.stringify({ ...config, engine: "MOCK", reason: `Insufficient candle data (mock generated)` }),
    mockWarning: true,
  }
}

// =============================================
// ROUTE HANDLERS
// =============================================

export async function GET() {
  try {
    const results = await db.backtestResult.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    })
    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    console.error("Error fetching backtest results:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch backtest results" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validation = validatePayload(body)
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 },
      )
    }

    const { symbol, strategy, timeframe, startDate, endDate, initialCapital: capital, config, name } = validation.data
    const start = startDate ? new Date(startDate) : new Date("2024-01-01")
    const end = endDate ? new Date(endDate) : new Date()

    const dbTimeframe = normalizeTf(timeframe)
    const riskPerTrade = (config?.riskPerTrade as number) ?? 2
    const slAtrMult = (config?.slAtrMult as number) ?? 2
    const tpAtrMult = (config?.tpAtrMult as number) ?? 3
    const commissionPerLot = 1 // $1/lot per side per FINEX specs
    const slippagePips = (config?.slippagePips as number) ?? 0.5 // 0.5 pips per FINEX specs
    const isIntraday = isIntradayTf(dbTimeframe)

    // ---------- Query real candle data ----------
    const candles = await db.candleData.findMany({
      where: {
        symbol,
        timeframe: dbTimeframe,
        openTime: { gte: start, lte: end },
      },
      orderBy: { openTime: "asc" },
    })

    let metrics: ReturnType<typeof computeMetrics>
    let equityCurve: { date: string; equity: number }[] = []
    let simulatedTrades: SimTrade[] = []
    let usedMock = false
    let mockWarning = false
    let configStr = JSON.stringify(config ?? {})
    let engineName = ""

    if (candles.length >= 25) {
      // ---- Improvement 2: Strategy dispatch ----
      let engineResult: { trades: SimTrade[]; equityCurve: { date: string; equity: number }[] }

      if (strategy === "EMA Crossover") {
        // Improvement 1: EMA Crossover engine
        engineResult = runEmaCrossover(
          candles, capital, riskPerTrade, slAtrMult, tpAtrMult,
          commissionPerLot, slippagePips, isIntraday,
        )
        engineName = "EMA_CROSSOVER"
        configStr = JSON.stringify({
          ...config, engine: engineName,
          fastPeriod: 12, slowPeriod: 26, atrPeriod: 14,
          slAtrMult, tpAtrMult, commissionPerLot, slippagePips,
          candleCount: candles.length,
        })
      } else if (strategy === "SMA Crossover" || strategy === "Moving Average Ribbon") {
        engineResult = runSmaCrossover(
          candles, capital, riskPerTrade, slAtrMult, tpAtrMult,
          commissionPerLot, slippagePips, isIntraday,
        )
        engineName = "SMA_CROSSOVER"
        configStr = JSON.stringify({
          ...config, engine: engineName,
          fastPeriod: 10, slowPeriod: 20, atrPeriod: 14,
          slAtrMult, tpAtrMult, commissionPerLot, slippagePips,
          candleCount: candles.length,
        })
      } else {
        // Fallback: run SMA Crossover but mark as fallback
        engineResult = runSmaCrossover(
          candles, capital, riskPerTrade, slAtrMult, tpAtrMult,
          commissionPerLot, slippagePips, isIntraday,
        )
        engineName = "SMA_CROSSOVER_FALLBACK"
        configStr = JSON.stringify({
          ...config, engine: engineName,
          requestedStrategy: strategy,
          fastPeriod: 10, slowPeriod: 20, atrPeriod: 14,
          slAtrMult, tpAtrMult, commissionPerLot, slippagePips,
          candleCount: candles.length,
        })
      }

      simulatedTrades = engineResult.trades
      equityCurve = engineResult.equityCurve
      metrics = computeMetrics(simulatedTrades, capital, equityCurve, dbTimeframe)
    } else {
      // Fallback to mock when insufficient data
      usedMock = true
      mockWarning = true
      const mock = generateMockResult(symbol, strategy, timeframe, capital, start, end, config ?? {})
      metrics = {
        totalTrades: mock.totalTrades,
        winTrades: mock.winTrades,
        lossTrades: mock.lossTrades,
        winRate: mock.winRate,
        avgWin: mock.avgWin,
        avgLoss: mock.avgLoss,
        profitFactor: mock.profitFactor,
        totalPnl: mock.totalPnl,
        finalCapital: mock.finalCapital,
        maxDrawdown: mock.maxDrawdown,
        sharpeRatio: mock.sharpeRatio,
      }
      equityCurve = mock.equityCurve
      configStr = JSON.stringify({ ...config, engine: "MOCK", reason: `Insufficient candle data (${candles.length} bars, need >= 25)` })
    }

    const totalReturn = capital > 0
      ? Math.round(((metrics.finalCapital - capital) / capital) * 10000) / 100
      : 0

    const result = await db.backtestResult.create({
      data: {
        name: name || `${strategy} - ${symbol} (${timeframe})${usedMock ? " [MOCK]" : ""}`,
        symbol,
        strategy,
        timeframe,
        startDate: start,
        endDate: end,
        initialCapital: capital,
        finalCapital: metrics.finalCapital,
        totalTrades: metrics.totalTrades,
        winTrades: metrics.winTrades,
        lossTrades: metrics.lossTrades,
        winRate: metrics.winRate,
        maxDrawdown: metrics.maxDrawdown,
        sharpeRatio: metrics.sharpeRatio,
        profitFactor: metrics.profitFactor,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        totalPnl: metrics.totalPnl,
        config: configStr,
      },
    })

    // Improvement 3: Return simulated trades in API response
    // Improvement: Mark mock results clearly
    return NextResponse.json(
      {
        success: true,
        data: {
          ...result,
          equityCurve,
          totalReturn,
          simulatedTrades,
          mockWarning,
          engine: usedMock ? "MOCK" : engineName,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("Error running backtest:", error)
    return NextResponse.json(
      { success: false, error: "Failed to run backtest" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing backtest id" },
        { status: 400 },
      )
    }
    await db.backtestResult.delete({ where: { id } })
    return NextResponse.json({ success: true, data: { id } })
  } catch (error) {
    console.error("Error deleting backtest:", error)
    return NextResponse.json(
      { success: false, error: "Failed to delete backtest result" },
      { status: 500 },
    )
  }
}
