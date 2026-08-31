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

function sma(closes: number[], period: number): number {
  if (closes.length < period) return 0
  let sum = 0
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]
  return sum / period
}

function atr(bars: { high: number; low: number; close: number }[], period: number): number {
  if (bars.length < period + 1) return 0
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high
    const l = bars[i].low
    const pc = bars[i - 1].close
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
  }
  // simple average of last `period` TRs
  const slice = trs.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

// ---------- Backtest engine (SMA Crossover) ----------

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

function runSmaCrossover(
  candles: { openTime: Date; high: number; low: number; close: number }[],
  capital: number,
  riskPerTradePct: number,
  slAtrMult: number,
  tpAtrMult: number,
  commissionPerLot: number,
): { trades: SimTrade[]; equityCurve: { date: string; equity: number }[] } {
  const FAST = 10
  const SLOW = 20
  const ATR_PERIOD = 14
  const POSITION_PCT = 0.10 // use 10% of equity per trade
  const LOT_SIZE = 100

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

  for (let i = SLOW; i < candles.length; i++) {
    const closes = candles.slice(0, i + 1).map((c) => c.close)
    const fastNow = sma(closes, FAST)
    const slowNow = sma(closes, SLOW)
    const prevFast = sma(closes.slice(0, -1), FAST)
    const prevSlow = sma(closes.slice(0, -1), SLOW)

    const currentAtr = atr(
      candles.slice(0, i + 1).map((c) => ({ high: c.high, low: c.low, close: c.close })),
      ATR_PERIOD,
    )

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
        const rawPnl = posDirection === "LONG"
          ? (exitPrice - posEntryPrice) * posShares
          : (posEntryPrice - exitPrice) * posShares
        const roundTripCommission = posCommission + (commissionPerLot * Math.ceil(posShares / LOT_SIZE))
        const netPnl = rawPnl - roundTripCommission
        equity += netPnl

        trades.push({
          entryBar: posEntryBar,
          exitBar: i,
          direction: posDirection,
          entryPrice: posEntryPrice,
          exitPrice,
          pnl: netPnl,
          commission: roundTripCommission,
          sl: posSl,
          tp: posTp,
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
        const entryPrice = candles[i].close
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

    // Record equity curve point
    const dateStr = candles[i].openTime.toISOString().split("T")[0]
    // Avoid duplicate dates (intraday candles share the same date)
    const lastDate = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].date : ""
    if (dateStr !== lastDate) {
      equityCurve.push({ date: dateStr, equity: Math.round(equity * 100) / 100 })
    }
  }

  return { trades, equityCurve }
}

// ---------- Metrics computation ----------

function computeMetrics(trades: SimTrade[], capital: number) {
  const totalTrades = trades.length
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl <= 0)
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
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 99.99 : 0

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const finalCapital = Math.round((capital + totalPnl) * 100) / 100

  // Max drawdown from equity curve
  let peak = capital
  let maxDd = 0
  let runningEquity = capital
  for (const t of trades) {
    runningEquity += t.pnl
    if (runningEquity > peak) peak = runningEquity
    const dd = peak > 0 ? ((peak - runningEquity) / peak) * 100 : 0
    if (dd > maxDd) maxDd = dd
  }
  const maxDrawdown = Math.round(maxDd * 100) / 100

  // Sharpe ratio (annualised, assuming daily bars)
  if (trades.length < 2) {
    return {
      totalTrades, winTrades, lossTrades, winRate,
      avgWin, avgLoss, profitFactor, totalPnl,
      finalCapital, maxDrawdown, sharpeRatio: 0,
    }
  }

  // Build daily returns array from equity curve
  const dailyEquity = [capital]
  for (const t of trades) {
    dailyEquity.push(dailyEquity[dailyEquity.length - 1] + t.pnl)
  }
  const returns: number[] = []
  for (let i = 1; i < dailyEquity.length; i++) {
    if (dailyEquity[i - 1] !== 0) {
      returns.push((dailyEquity[i] - dailyEquity[i - 1]) / dailyEquity[i - 1])
    }
  }

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const stdReturn = Math.sqrt(
    returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length,
  )
  const sharpeRatio = stdReturn > 0
    ? Math.round((avgReturn / stdReturn) * Math.sqrt(252) * 100) / 100
    : 0

  return {
    totalTrades, winTrades, lossTrades, winRate,
    avgWin, avgLoss, profitFactor, totalPnl,
    finalCapital, maxDrawdown, sharpeRatio,
  }
}

// ---------- Mock fallback ----------

function generateMockResult(symbol: string, strategy: string, timeframe: string, capital: number, start: Date, end: Date, config: Record<string, unknown>) {
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
    config: JSON.stringify(config ?? {}),
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
    let usedMock = false
    let configStr = JSON.stringify(config ?? {})

    if (candles.length >= 25) {
      // Run real backtest engine
      const { trades, equityCurve: ec } = runSmaCrossover(
        candles,
        capital,
        riskPerTrade,
        slAtrMult,
        tpAtrMult,
        commissionPerLot,
      )
      equityCurve = ec
      metrics = computeMetrics(trades, capital)
      configStr = JSON.stringify({
        ...config,
        engine: "SMA_CROSSOVER",
        fastPeriod: 10,
        slowPeriod: 20,
        atrPeriod: 14,
        slAtrMult,
        tpAtrMult,
        commissionPerLot,
        candleCount: candles.length,
        simulatedTrades: trades.length,
      })
    } else {
      // Fallback to mock when insufficient data
      usedMock = true
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
      configStr = JSON.stringify({ ...config, engine: "MOCK", reason: `Insufficient candle data (${candles.length} bars)` })
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

    return NextResponse.json(
      { success: true, data: { ...result, equityCurve, totalReturn } },
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
