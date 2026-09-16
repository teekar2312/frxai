// ============================================================
// FINEX AI TRADING SYSTEM — BACKTEST API
// POST /api/backtest → run a backtest, persist it, return BacktestDetail
// GET  /api/backtest → last 20 BacktestSummary rows
//
// Candle history: simulator candles (M1-aggregated). When the real
// data is too thin (H4/D1/W1/MN, or long `bars` requests) a
// deterministic synthetic series is generated (seeded per pair+tf,
// anchored to the real first open). The engine reuses the PURE
// indicator library + learned ModelStat weights so the weighted vote
// has exactly the same semantics as the live AI engine.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSimulator } from '@/lib/engine/simulator'
import { computeIndicatorSet } from '@/lib/engine/indicators'
import { gauss, hashSeed, mulberry32 } from '@/lib/engine/rng'
import { INDICATOR_IDS, PAIR_IDS, TIMEFRAME_IDS, getPairConfig, getTimeframeMinutes } from '@/lib/constants'
import type { BacktestDetail, BacktestSummary, BacktestTrade, Candle, Pair, Side, Timeframe } from '@/lib/types'

export const dynamic = 'force-dynamic'

const INITIAL_BALANCE = 10000
const WARMUP_BARS = 60 // indicator warm-up before the first tradable bar
const ENTRY_THRESHOLD = 25 // |score| gate — same as the live AI engine

const round2 = (v: number): number => Math.round(v * 100) / 100
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

function roundTo(v: number, digits: number): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

// ------------------------------------------------------------
// Deterministic synthetic history (for thin timeframes)
// - seed: hashSeed(pair+timeframe) → mulberry32 → same series every run
// - `bars` candles ending at the last real candle's time, stepping back tfMs
// - per-candle volatility = volPipsPerMin × √(minutes) pips (gaussian)
// - OHLC built from 4 sub-steps, small drift + gentle mean reversion,
//   volume = 50 + rng()*150
// - the whole series is rescaled multiplicatively so the final close
//   matches the first real candle's open (shape preserved)
// ------------------------------------------------------------
function synthesizeHistory(pair: Pair, tf: Timeframe, bars: number, real: Candle[]): Candle[] {
  const cfg = getPairConfig(pair)
  const minutes = getTimeframeMinutes(tf)
  const tfMs = minutes * 60000
  const rng = mulberry32(hashSeed(`${pair}${tf}`))
  const lastTime = real.length > 0 ? real[real.length - 1].time : Math.floor(Date.now() / tfMs) * tfMs
  const anchor = real.length > 0 ? real[0].open : cfg.basePrice

  const sigma = cfg.volPipsPerMin * Math.sqrt(minutes) * cfg.pipSize // per-candle stdev (price units)
  const n = Math.max(bars, 2)
  const startTime = lastTime - (n - 1) * tfMs

  let price = cfg.basePrice
  const raw: Candle[] = []
  for (let i = 0; i < n; i++) {
    const open = price
    const drift = gauss(rng) * sigma * 0.05 // small per-candle drift
    const pull = (cfg.basePrice - price) * 0.003 // gentle mean reversion keeps the walk bounded
    let high = open
    let low = open
    for (let s = 0; s < 4; s++) {
      price += drift / 4 + pull / 4 + gauss(rng) * (sigma / 2) // 4 sub-steps → σ per candle
      price = Math.max(price, cfg.pipSize * 10)
      high = Math.max(high, price)
      low = Math.min(low, price)
    }
    raw.push({ time: startTime + i * tfMs, open, high, low, close: price, volume: Math.round(50 + rng() * 150) })
  }

  // Rescale so the final close ≈ anchor (multiplicative → realistic shape kept)
  const factor = raw[n - 1].close !== 0 ? anchor / raw[n - 1].close : 1
  return raw.map((c) => {
    const o = roundTo(c.open * factor, cfg.digits)
    const h = roundTo(c.high * factor, cfg.digits)
    const l = roundTo(c.low * factor, cfg.digits)
    const cl = roundTo(c.close * factor, cfg.digits)
    return { time: c.time, open: o, high: Math.max(h, o, cl), low: Math.min(l, o, cl), close: cl, volume: c.volume }
  })
}

// ------------------------------------------------------------
// POST — run a backtest
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // --- validate pair + timeframe ---
    const pairRaw = typeof body.pair === 'string' ? body.pair.toUpperCase().trim() : ''
    if (!PAIR_IDS.includes(pairRaw as Pair)) {
      return NextResponse.json({ error: `Pair tidak valid: ${pairRaw || '—'} (pilihan: ${PAIR_IDS.join(', ')})` }, { status: 400 })
    }
    const tfRaw = typeof body.timeframe === 'string' ? body.timeframe.toUpperCase().trim() : ''
    if (!TIMEFRAME_IDS.includes(tfRaw as Timeframe)) {
      return NextResponse.json({ error: `Timeframe tidak valid: ${tfRaw || '—'} (pilihan: ${TIMEFRAME_IDS.join(', ')})` }, { status: 400 })
    }
    const pair = pairRaw as Pair
    const timeframe = tfRaw as Timeframe

    // Defaults come from the live engine settings (also awaits simulator ready)
    const sim = getSimulator()
    const settings = await sim.getSettings()

    const bars = Math.round(clamp(Number(body.bars) || 500, 100, 3000))

    let indicators: string[]
    if (Array.isArray(body.indicators)) {
      const valid = body.indicators.filter((x): x is string => typeof x === 'string' && INDICATOR_IDS.includes(x))
      if (body.indicators.length > 0 && valid.length === 0) {
        return NextResponse.json({ error: `Tidak ada indikator yang valid (pilihan: ${INDICATOR_IDS.slice(0, 8).join(', ')}, ...)` }, { status: 400 })
      }
      indicators = valid.length > 0 ? valid : [...settings.indicators]
    } else {
      indicators = [...settings.indicators]
    }

    const numOr = (v: unknown, d: number): number => {
      const n = Number(v)
      return Number.isFinite(n) ? n : d
    }
    const riskPerTrade = round2(clamp(numOr(body.riskPerTrade, settings.riskPerTrade), 0.5, 1))
    const stopLossPips = Math.round(clamp(numOr(body.stopLossPips, settings.stopLossPips), 5, 15))
    const takeProfitRatio = Math.round(clamp(numOr(body.takeProfitRatio, settings.takeProfitRatio), 1, 3) * 10) / 10

    // --- candle history: real first, synthetic fallback ---
    const real = sim.getCandles(pair, timeframe, Math.min(bars + 50, 1000))
    const candles = real.length >= bars * 0.6 ? real.slice(-bars) : synthesizeHistory(pair, timeframe, bars, real)
    if (candles.length < 30) {
      return NextResponse.json({ error: 'Data candle tidak cukup untuk backtest' }, { status: 400 })
    }

    // Learned indicator weights (same semantics as simulator.computeSignals)
    const statRows = await db.modelStat.findMany().catch(() => [])
    const weights = new Map<string, number>()
    for (const st of statRows) weights.set(st.indicator, st.weight)

    // --- backtest engine ---
    const cfg = getPairConfig(pair)
    const halfSpread = (cfg.spreadMin * cfg.pipSize) / 2 // half-spread cost applied at entry
    const tpPips = Math.max(1, Math.round(stopLossPips * takeProfitRatio))

    let balance = INITIAL_BALANCE
    let peak = INITIAL_BALANCE
    let maxDrawdown = 0
    let maxDrawdownPct = 0
    const trades: BacktestTrade[] = []
    const equityCurve: { time: number; equity: number; drawdown: number }[] = []

    interface OpenPos {
      side: Side
      entry: number
      entryTime: number
      volume: number
      sl: number
      tp: number
    }
    let open: OpenPos | null = null

    const closeAt = (exitPrice: number, reason: string, exitTime: number): void => {
      if (!open) return
      const p = open
      const pips = p.side === 'BUY' ? (exitPrice - p.entry) / cfg.pipSize : (p.entry - exitPrice) / cfg.pipSize
      // Commission: $1/lot per side × 2 sides = $2/lot round-trip.
      // Charged in FULL at exit (single deduction — keeps equity math simple;
      // the net effect on trade profit is identical to charging per side).
      const profit = round2(pips * cfg.pipValuePerLot * p.volume - 2 * p.volume)
      balance = round2(balance + profit)
      if (balance > peak) peak = balance
      const dd = round2(peak - balance)
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0
      if (dd > maxDrawdown) maxDrawdown = dd
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct
      trades.push({
        n: trades.length + 1,
        side: p.side,
        entryTime: p.entryTime,
        exitTime,
        entry: p.entry,
        exit: roundTo(exitPrice, cfg.digits),
        pips: round2(pips),
        profit,
        reason,
        balance,
      })
      equityCurve.push({ time: exitTime, equity: balance, drawdown: dd })
      open = null
    }

    const warmup = candles.length >= 75 ? WARMUP_BARS : Math.max(10, Math.floor(candles.length / 2))
    equityCurve.push({ time: candles[Math.min(warmup, candles.length - 1)].time, equity: balance, drawdown: 0 })

    for (let i = warmup; i < candles.length; i++) {
      const c = candles[i]

      // 1) Manage the open position against this bar's high/low.
      //    SL is checked first — pessimistic assumption when one candle
      //    spans both levels. A position opened at bar i's close is only
      //    checked from bar i+1 onward (no look-ahead).
      if (open) {
        if (open.side === 'BUY') {
          if (c.low <= open.sl) closeAt(open.sl, 'SL', c.time)
          else if (c.high >= open.tp) closeAt(open.tp, 'TP', c.time)
        } else {
          if (c.high >= open.sl) closeAt(open.sl, 'SL', c.time)
          else if (c.low <= open.tp) closeAt(open.tp, 'TP', c.time)
        }
      }

      // 2) Entry: weighted indicator vote on candles up to and including i
      //    (only computed while flat — the score is only needed for entries).
      if (!open) {
        const set = computeIndicatorSet(indicators, candles.slice(0, i + 1))
        let num = 0
        let den = 0
        for (const id of indicators) {
          const w = weights.get(id) ?? 1
          const sv = set[id].signal === 'BUY' ? 1 : set[id].signal === 'SELL' ? -1 : 0
          num += sv * w
          den += w
        }
        const score = den > 0 ? clamp((num / den) * 100, -100, 100) : 0
        if (Math.abs(score) >= ENTRY_THRESHOLD) {
          const side: Side = score > 0 ? 'BUY' : 'SELL'
          // BUY fills at ask (close + half spread), SELL at bid (close − half spread)
          const entry = roundTo(side === 'BUY' ? c.close + halfSpread : c.close - halfSpread, cfg.digits)
          const riskUSD = (balance * riskPerTrade) / 100
          const volume = round2(clamp(riskUSD / (stopLossPips * cfg.pipValuePerLot), 0.01, 50))
          open = {
            side,
            entry,
            entryTime: c.time,
            volume,
            sl: roundTo(side === 'BUY' ? entry - stopLossPips * cfg.pipSize : entry + stopLossPips * cfg.pipSize, cfg.digits),
            tp: roundTo(side === 'BUY' ? entry + tpPips * cfg.pipSize : entry - tpPips * cfg.pipSize, cfg.digits),
          }
        }
      }
    }

    // Close whatever is still open at the last bar (end-of-data)
    if (open) {
      const last = candles[candles.length - 1]
      closeAt(open.side === 'BUY' ? last.close - halfSpread : last.close + halfSpread, 'EOD', last.time)
    }

    // --- statistics ---
    const totalTrades = trades.length
    const wins = trades.filter((t) => t.profit > 0).length
    const losses = totalTrades - wins
    const winRate = totalTrades > 0 ? round2((wins / totalTrades) * 100) : 0
    let grossWin = 0
    let grossLoss = 0
    for (const t of trades) {
      if (t.profit > 0) grossWin += t.profit
      else grossLoss += Math.abs(t.profit)
    }
    grossWin = round2(grossWin)
    grossLoss = round2(grossLoss)
    const profitFactor = grossLoss > 0 ? round2(grossWin / grossLoss) : grossWin > 0 ? 99.99 : 0
    const netProfit = round2(balance - INITIAL_BALANCE)
    const netProfitPct = round2((netProfit / INITIAL_BALANCE) * 100)
    const avgTrade = totalTrades > 0 ? round2(netProfit / totalTrades) : 0
    const bestTrade = totalTrades > 0 ? round2(Math.max(...trades.map((t) => t.profit))) : 0
    const worstTrade = totalTrades > 0 ? round2(Math.min(...trades.map((t) => t.profit))) : 0
    // Expectancy = average P/L per trade. By construction
    // (win% × avgWin − loss% × avgLoss) ≡ netProfit / totalTrades.
    const expectancy = avgTrade
    let sharpe = 0
    if (totalTrades >= 2) {
      const profits = trades.map((t) => t.profit)
      const mean = profits.reduce((a, b) => a + b, 0) / totalTrades
      const variance = profits.reduce((a, b) => a + (b - mean) * (b - mean), 0) / totalTrades
      const std = Math.sqrt(variance)
      if (std > 1e-9) sharpe = round2((mean / std) * Math.sqrt(Math.min(totalTrades, 252)))
    }

    // --- persist ---
    const row = await db.backtest.create({
      data: {
        pair,
        timeframe,
        indicators: indicators.join(','),
        bars: candles.length,
        initialBalance: INITIAL_BALANCE,
        finalBalance: round2(balance),
        netProfit,
        netProfitPct,
        totalTrades,
        wins,
        losses,
        winRate,
        profitFactor,
        maxDrawdown: round2(maxDrawdown),
        maxDrawdownPct: round2(maxDrawdownPct),
        avgTrade,
        bestTrade,
        worstTrade,
        expectancy,
        sharpe,
        riskPerTrade,
        stopLossPips,
        takeProfitRatio,
        equityCurveJson: JSON.stringify(equityCurve),
        tradesJson: JSON.stringify(trades.slice(-500)),
      },
    })

    await sim.log('INFO', 'ENGINE', `Backtest ${pair} ${timeframe}: ${totalTrades} trades, net ${netProfit.toFixed(2)}`)

    const detail: BacktestDetail = {
      id: row.id,
      pair,
      timeframe,
      indicators,
      bars: candles.length,
      netProfit,
      netProfitPct,
      totalTrades,
      wins,
      losses,
      winRate,
      profitFactor,
      maxDrawdownPct: round2(maxDrawdownPct),
      createdAt: row.createdAt.toISOString(),
      initialBalance: INITIAL_BALANCE,
      finalBalance: round2(balance),
      maxDrawdown: round2(maxDrawdown),
      avgTrade,
      bestTrade,
      worstTrade,
      expectancy,
      sharpe,
      riskPerTrade,
      stopLossPips,
      takeProfitRatio,
      equityCurve,
      trades: trades.slice(-200),
    }
    return NextResponse.json(detail)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Backtest gagal dijalankan' }, { status: 500 })
  }
}

// ------------------------------------------------------------
// GET — last 20 backtest summaries
// ------------------------------------------------------------
export async function GET() {
  try {
    const rows = await db.backtest.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })
    const out: BacktestSummary[] = rows.map((r) => ({
      id: r.id,
      pair: r.pair as Pair,
      timeframe: r.timeframe as Timeframe,
      indicators: r.indicators ? r.indicators.split(',').map((x) => x.trim()).filter(Boolean) : [],
      bars: r.bars,
      netProfit: r.netProfit,
      netProfitPct: r.netProfitPct,
      totalTrades: r.totalTrades,
      wins: r.wins,
      losses: r.losses,
      winRate: r.winRate,
      profitFactor: r.profitFactor,
      maxDrawdownPct: r.maxDrawdownPct,
      createdAt: r.createdAt.toISOString(),
    }))
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal memuat riwayat backtest' }, { status: 500 })
  }
}
