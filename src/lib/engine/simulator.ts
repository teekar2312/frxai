// ============================================================
// FINEX AI TRADING SYSTEM — DEMO SIMULATOR ENGINE
// Simulates MetaTrader 5 + FINEX Indonesia broker so the whole
// dashboard works without the real Python engine.
//
// In-memory: prices (bid/ask), M1 candles (1500/pair), day stats.
// Persisted (Prisma/SQLite): Settings, Account, Position, LogEntry,
// PriceAlert, NewsItem, ModelStat.
//
// Singleton on globalThis to survive Next.js HMR.
// ============================================================

import type { Position as PositionRow, Settings as SettingsRow } from '@prisma/client'
import { db } from '@/lib/db'
import {
  AI_PROVIDER_IDS,
  APP_VERSION,
  DEFAULT_SETTINGS,
  EVENTS_NOTIF,
  INDICATORS,
  INDICATOR_IDS,
  PAIRS,
  PAIR_IDS,
  RISK_LIMITS,
  SESSIONS,
  SESSION_IDS,
  TIMEFRAME_IDS,
  getIndicatorConfig,
  getPairConfig,
  getTimeframeMinutes,
  isSessionActive,
} from '@/lib/constants'
import type {
  AccountInfo,
  AiProviderId,
  Candle,
  ClosedTrade,
  EngineStatus,
  IndicatorReading,
  Pair,
  PositionView,
  PriceTick,
  SelectionMode,
  SessionId,
  SettingsData,
  Side,
  Timeframe,
} from '@/lib/types'
import { computeIndicatorSet, atrValue } from './indicators'
import { mulberry32, gauss, hashSeed } from './rng'
import { simulateEmailSend } from './email-sim'

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

const round2 = (v: number): number => Math.round(v * 100) / 100
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

function roundTo(v: number, digits: number): number {
  const f = Math.pow(10, digits)
  return Math.round(v * f) / f
}

function utcDayKey(t: number | Date): string {
  const d = typeof t === 'number' ? new Date(t) : t
  return d.toISOString().slice(0, 10)
}

/** Session-based volatility multiplier (London/NY overlap most volatile). */
function sessionMultiplier(d: Date): number {
  const lon = isSessionActive('london', d)
  const ny = isSessionActive('newyork', d)
  if (lon && ny) return 1.6
  if (lon || ny) return 1.0
  if (isSessionActive('sydney', d) || isSessionActive('tokyo', d)) return 0.7
  return 0.5
}

function parseCsv(s: string | null | undefined): string[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

// ------------------------------------------------------------
// Runtime state shapes
// ------------------------------------------------------------
interface PairRuntime {
  pair: Pair
  bid: number
  ask: number
  anchor: number // slow-moving fair value the price reverts to
  dayOpen: number
  dayHigh: number
  dayLow: number
  day: string // YYYY-MM-DD UTC
  candles: Candle[] // M1, oldest → newest (last = forming candle)
  priceHistory: number[] // last ~120 closes (sparkline)
  spreadT: number // 0..1 wiggle between spreadMin/spreadMax
}

interface RtPosition {
  id: string
  ticket: string
  pair: Pair
  side: Side
  volume: number
  openPrice: number
  stopLoss: number | null
  takeProfit: number | null
  trailing: boolean
  trailingPips: number
  commission: number
  source: 'MANUAL' | 'AI' | 'ANALYSIS'
  signalIndicators: string[]
  signalTf: string | null
  openedAt: Date
  dirty: boolean // needs SL/TP/trailing flush to DB
}

interface WeightStat {
  weight: number
  wins: number
  losses: number
  samples: number
}

interface PendingClose {
  p: RtPosition
  reason: string
  price: number
  at: Date
}

// ------------------------------------------------------------
// Synthetic news pools (demo fundamental feed)
// ------------------------------------------------------------
interface NewsTemplate {
  category: string
  impact: 'HIGH' | 'MEDIUM' | 'LOW'
  headline: string
  summary: string
  sentiment: number
}

const NEWS_TEMPLATES: NewsTemplate[] = [
  // CENTRAL_BANK
  { category: 'CENTRAL_BANK', impact: 'HIGH', headline: 'Fed holds rates steady, signals one more hike this year', summary: 'The Federal Reserve kept the policy rate unchanged but retained a hawkish bias, pointing to sticky services inflation and a resilient labour market.', sentiment: 0.45 },
  { category: 'CENTRAL_BANK', impact: 'MEDIUM', headline: 'ECB officials split on timing of first rate cut', summary: 'Governing Council members voiced diverging views on easing timing, with hawks urging patience until wage growth cools further.', sentiment: -0.15 },
  { category: 'CENTRAL_BANK', impact: 'HIGH', headline: 'BOJ hints at policy normalization as inflation firms', summary: 'Bank of Japan board members discussed reducing monetary stimulus, fueling speculation of a shift away from negative rates.', sentiment: 0.5 },
  { category: 'CENTRAL_BANK', impact: 'MEDIUM', headline: 'BOE dove: premature to discuss rate cuts', summary: 'A Bank of England policymaker warned that market pricing of early cuts is overdone, citing persistent domestic inflation.', sentiment: 0.1 },
  // ECONOMIC
  { category: 'ECONOMIC', impact: 'HIGH', headline: 'NFP beats expectations: US adds 245K jobs vs 180K forecast', summary: 'Nonfarm payrolls surged past estimates while the unemployment rate held at 3.9%, strengthening the dollar across the board.', sentiment: 0.6 },
  { category: 'ECONOMIC', impact: 'HIGH', headline: 'US CPI cools to 2.8% year-over-year, below forecasts', summary: 'Headline inflation decelerated more than expected, reviving rate-cut bets and pressuring the greenback.', sentiment: -0.35 },
  { category: 'ECONOMIC', impact: 'MEDIUM', headline: 'US GDP revised up to 2.4% annualized growth', summary: 'Stronger consumer spending led to an upward revision of fourth-quarter growth, underscoring economic resilience.', sentiment: 0.4 },
  { category: 'ECONOMIC', impact: 'LOW', headline: 'US unemployment claims fall to 212K, labour market resilient', summary: 'Initial jobless claims dropped more than expected last week, remaining near historic lows.', sentiment: 0.3 },
  { category: 'ECONOMIC', impact: 'MEDIUM', headline: 'Eurozone PMI expands to 51.2, first growth in 7 months', summary: 'The composite PMI moved above 50 for the first time since mid-year, led by services and a stabilizing factory sector.', sentiment: 0.4 },
  { category: 'ECONOMIC', impact: 'MEDIUM', headline: 'UK retail sales drop 0.7%, missing estimates', summary: 'Poor December retail numbers raise recession fears and strengthen the case for BOE easing later this year.', sentiment: -0.45 },
  { category: 'ECONOMIC', impact: 'LOW', headline: 'US retail sales rise 0.6%, consumer spending stays strong', summary: 'Retail sales advanced more than expected, suggesting the consumer engine of the economy is still running hot.', sentiment: 0.35 },
  { category: 'ECONOMIC', impact: 'MEDIUM', headline: 'US ISM Manufacturing PMI slips to 47.4, contraction deepens', summary: 'Factory activity contracted for a fifth straight month as new orders weakened, weighing on risk sentiment.', sentiment: -0.3 },
  // GEOPOLITICS
  { category: 'GEOPOLITICS', impact: 'HIGH', headline: 'Middle East tensions escalate, safe-haven flows surge', summary: 'Escalating regional conflict drove investors into gold and the dollar, with equities under pressure worldwide.', sentiment: -0.6 },
  { category: 'GEOPOLITICS', impact: 'MEDIUM', headline: 'US announces new tariffs on imported goods', summary: 'Fresh tariff threats on strategic sectors reignited trade-war fears and hit risk currencies.', sentiment: -0.4 },
  { category: 'GEOPOLITICS', impact: 'LOW', headline: 'Ceasefire talks progress, risk sentiment improves', summary: 'Diplomatic channels reported constructive negotiations, easing demand for safe havens.', sentiment: 0.4 },
  // FISCAL
  { category: 'FISCAL', impact: 'LOW', headline: 'US Congress passes temporary spending bill, avoids shutdown', summary: 'Lawmakers agreed on a short-term funding extension, pushing contentious budget talks into next quarter.', sentiment: 0.25 },
  { category: 'FISCAL', impact: 'MEDIUM', headline: 'Eurozone fiscal stimulus package announced', summary: 'A new spending program focused on infrastructure and defense could lift regional growth expectations.', sentiment: 0.4 },
  // COMMODITY
  { category: 'COMMODITY', impact: 'HIGH', headline: 'Gold rallies to fresh record on rate-cut bets', summary: 'Bullion surged as softer inflation data strengthened the case for Fed easing, with central banks continuing to buy.', sentiment: 0.7 },
  { category: 'COMMODITY', impact: 'MEDIUM', headline: 'Oil slips as OPEC+ signals output increase', summary: 'Crude fell after the cartel hinted at unwinding voluntary cuts, easing supply concerns.', sentiment: -0.25 },
  { category: 'COMMODITY', impact: 'LOW', headline: 'Gold consolidates near all-time highs', summary: 'The metal is taking a breather after a strong rally, with ETF inflows accelerating.', sentiment: 0.2 },
  // SENTIMENT
  { category: 'SENTIMENT', impact: 'LOW', headline: 'Risk-on sentiment dominates as equities rally', summary: 'Global stocks climbed to fresh highs, denting demand for the dollar and the yen.', sentiment: 0.5 },
  { category: 'SENTIMENT', impact: 'LOW', headline: 'Market caution ahead of FOMC minutes', summary: 'Traders trimmed positions before the release of the latest Fed meeting minutes.', sentiment: -0.1 },
]

const BREAKING_TEMPLATES: NewsTemplate[] = [
  { category: 'BREAKING', impact: 'HIGH', headline: 'BREAKING: Flash crash hits currency markets in thin liquidity', summary: 'A sudden liquidity vacuum triggered stop cascades across major pairs; volatility spiked to multi-month highs.', sentiment: -0.8 },
  { category: 'BREAKING', impact: 'HIGH', headline: 'BREAKING: Surprise emergency central bank meeting scheduled', summary: 'An unscheduled policy meeting announcement sparked intense speculation of an imminent rate decision.', sentiment: -0.5 },
  { category: 'BREAKING', impact: 'HIGH', headline: 'BREAKING: Major bank intervenes, currency jumps', summary: 'Confirmed verbal intervention sent the currency sharply higher as shorts were squeezed out.', sentiment: 0.55 },
  { category: 'BREAKING', impact: 'HIGH', headline: 'BREAKING: Geopolitical event sparks flight to safety', summary: 'Breaking headlines drove an immediate bid into gold, the dollar and the franc.', sentiment: -0.65 },
]

// ------------------------------------------------------------
// Simulator
// ------------------------------------------------------------
export class Simulator {
  private rng: () => number
  private pairs = new Map<Pair, PairRuntime>()
  private settings: SettingsData
  private account = { balance: 10000, dailyStartBalance: 10000, day: utcDayKey(Date.now()) }
  private accountMeta = { currency: 'USD', server: 'FINEX Indonesia', login: 'FINEX-DEMO-10001' }
  private leverage = 500
  private weights = new Map<string, WeightStat>()
  private status = {
    autoTradeCount: 0,
    manualTradeCount: 0,
    lastAiDecision: null as string | null,
    dailyBlocked: 'NONE' as 'NONE' | 'LIMIT' | 'TARGET',
  }
  private latencyMs = 12
  private lastTickAt = Date.now()
  private lastAiCycleAt = 0
  private lastNewsAt = 0
  private lastBreakingAt = 0
  private lastLogPruneAt = Date.now()
  private throttle = new Map<string, number>()
  private pendingCloses: PendingClose[] = []
  private breakingQueue: { pair: Pair; at: number }[] = []
  private ready: Promise<void>
  private ticking: Promise<void> | null = null

  constructor() {
    this.rng = mulberry32((Date.now() ^ hashSeed('finex-demo-live')) >>> 0)
    this.settings = defaultSettingsData()
    this.ready = this.init().catch(() => undefined)
  }

  // ============================================================
  // INIT
  // ============================================================
  private async init(): Promise<void> {
    // Settings (create with schema defaults when missing)
    let srow = await db.settings.findUnique({ where: { id: 'main' } })
    if (!srow) srow = await db.settings.create({ data: { id: 'main' } })
    this.settings = this.parseSettingsRow(srow)

    // Account (create default row when missing)
    let arow = await db.account.findUnique({ where: { id: 'main' } })
    if (!arow) arow = await db.account.create({ data: { id: 'main' } })
    this.leverage = arow.leverage || 500
    this.accountMeta = { currency: arow.currency, server: arow.server, login: arow.login }
    this.account = {
      balance: arow.balance,
      dailyStartBalance: arow.dailyStartBalance,
      day: utcDayKey(Date.now()),
    }
    // Roll daily start if the stored anchor is from a previous day (+ daily report email)
    if (utcDayKey(arow.dailyStart) !== utcDayKey(Date.now())) {
      const startBal = arow.dailyStartBalance
      const dayPnl = arow.balance - startBal
      const dayPct = startBal > 0 ? (dayPnl / startBal) * 100 : 0
      this.account.dailyStartBalance = arow.balance
      await db.account.update({ where: { id: 'main' }, data: { dailyStartBalance: arow.balance } })
      await simulateEmailSend(
        'daily_report',
        `Laporan harian: ${dayPnl >= 0 ? '+' : ''}$${dayPnl.toFixed(2)} (${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%)`,
        `Ringkasan akun FINEX (demo) untuk hari sebelumnya:\nBalance awal: $${startBal.toFixed(2)}\nBalance akhir: $${arow.balance.toFixed(2)}\nPnL harian: ${dayPnl >= 0 ? '+' : ''}$${dayPnl.toFixed(2)} (${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%)`,
      )
    }

    // Status counters (ANALYSIS-signal trades count as user-initiated)
    this.status.autoTradeCount = await db.position.count({ where: { source: 'AI' } })
    this.status.manualTradeCount = await db.position.count({ where: { source: { in: ['MANUAL', 'ANALYSIS'] } } })

    // Self-learning weight cache
    const stats = await db.modelStat.findMany()
    for (const st of stats) {
      this.weights.set(st.indicator, { weight: st.weight, wins: st.wins, losses: st.losses, samples: st.samples })
    }

    // Seed price engine (deterministic per pair)
    for (const pc of PAIRS) this.pairs.set(pc.id, this.seedPair(pc))

    this.lastTickAt = Date.now()
    this.lastNewsAt = Date.now()
    await this.log('INFO', 'ENGINE', `Simulator engine started (DEMO) v${APP_VERSION} — ${PAIRS.length} pairs seeded with 1500 M1 candles`)
  }

  /** Deterministic 1500-minute M1 history ending at the current minute. */
  private seedPair(pc: { id: Pair; digits: number; pipSize: number; pipValuePerLot: number; contractSize: number; basePrice: number; volPipsPerMin: number; spreadMin: number; spreadMax: number }): PairRuntime {
    const rng = mulberry32(hashSeed(`finex-${pc.id}`) ^ 0x9e3779b9)
    const n = 1500
    const nowMin = Math.floor(Date.now() / 60000) * 60000
    const start = nowMin - (n - 1) * 60000
    let price = pc.basePrice * (1 + (rng() - 0.5) * 0.002)
    let anchor = price
    const candles: Candle[] = []
    for (let i = 0; i < n; i++) {
      const t = start + i * 60000
      const mult = sessionMultiplier(new Date(t))
      anchor += gauss(rng) * pc.volPipsPerMin * pc.pipSize * 0.25 * mult + (pc.basePrice - anchor) * 0.001
      const open = price
      let high = open
      let low = open
      for (let s = 0; s < 12; s++) {
        price += (anchor - price) * 0.03 + gauss(rng) * ((pc.volPipsPerMin * pc.pipSize) / Math.sqrt(12)) * mult
        high = Math.max(high, price)
        low = Math.min(low, price)
      }
      const volume = Math.round((30 + rng() * 120) * mult + (rng() < 0.05 ? 250 : 0))
      candles.push({ time: t, open, high, low, close: price, volume })
    }
    // Day stats from today's candles
    const todayKey = utcDayKey(Date.now())
    const today = candles.filter((c) => utcDayKey(c.time) === todayKey)
    const dayOpen = today.length ? today[0].open : price
    const dayHigh = today.length ? Math.max(...today.map((c) => c.high)) : price
    const dayLow = today.length ? Math.min(...today.map((c) => c.low)) : price
    const spread = pc.spreadMin + (pc.spreadMax - pc.spreadMin) * rng()
    return {
      pair: pc.id,
      bid: price,
      ask: price + spread * pc.pipSize,
      anchor,
      dayOpen,
      dayHigh,
      dayLow,
      day: todayKey,
      candles,
      priceHistory: candles.slice(-120).map((c) => c.close),
      spreadT: rng(),
    }
  }

  // ============================================================
  // TICK — advance the simulated market
  // ============================================================
  async tick(): Promise<void> {
    await this.ready
    if (this.ticking) {
      await this.ticking
      return
    }
    const p = this.doTick(Date.now()).finally(() => {
      this.ticking = null
    })
    this.ticking = p
    await p
  }

  private async doTick(now: number): Promise<void> {
    try {
      await this.tickInner(now)
    } catch (e) {
      await this.log('ERROR', 'ENGINE', `Tick error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async tickInner(now: number): Promise<void> {
    // Rate limit: skip if called less than 400ms after the last real tick
    if (now - this.lastTickAt < 400) return
    const elapsedMs = Math.min(Math.max(now - this.lastTickAt, 0), 300_000)
    this.lastTickAt = now
    this.latencyMs = Math.round(8 + this.rng() * 12)

    const steps = Math.min(Math.max(Math.floor(elapsedMs / 1000), 0), 300)
    let vt = now - elapsedMs

    // Snapshot open positions for intrabar SL/TP/trailing checks
    const rows = await db.position.findMany({ where: { status: 'OPEN' } })
    const open: RtPosition[] = []
    for (const row of rows) {
      const rt = toRtPosition(row)
      if (this.pairs.has(rt.pair)) open.push(rt)
    }

    for (let s = 0; s < steps; s++) {
      vt += 1000
      const mult = sessionMultiplier(new Date(vt))
      for (const rt of this.pairs.values()) {
        const cfg = getPairConfig(rt.pair)
        // Anchor drifts with a small random walk (+ slight pull to base price)
        rt.anchor += gauss(this.rng) * cfg.volPipsPerMin * cfg.pipSize * 0.05 * mult + (cfg.basePrice - rt.anchor) * 0.0002
        // Price step: mean reversion + noise, occasional news spike (0.5% ×3 vol)
        let volMult = mult
        const spike = this.rng() < 0.005
        if (spike) volMult *= 3
        const sigma = ((cfg.volPipsPerMin * cfg.pipSize) / Math.sqrt(60)) * volMult
        let price = rt.bid + (rt.anchor - rt.bid) * 0.02 + gauss(this.rng) * sigma
        price = Math.max(price, cfg.pipSize * 10)
        // Floating spread
        rt.spreadT = clamp(rt.spreadT + (this.rng() - 0.5) * 0.15, 0, 1)
        const spreadPips = cfg.spreadMin + (cfg.spreadMax - cfg.spreadMin) * rt.spreadT
        rt.bid = price
        rt.ask = price + spreadPips * cfg.pipSize
        // M1 candle update
        const minute = Math.floor(vt / 60000) * 60000
        const cur = rt.candles[rt.candles.length - 1]
        if (cur && cur.time === minute) {
          cur.high = Math.max(cur.high, price)
          cur.low = Math.min(cur.low, price)
          cur.close = price
          cur.volume += 1
        } else {
          if (cur) {
            rt.priceHistory.push(cur.close)
            if (rt.priceHistory.length > 120) rt.priceHistory.shift()
          }
          rt.candles.push({ time: minute, open: price, high: price, low: price, close: price, volume: 1 })
          if (rt.candles.length > 1500) rt.candles.splice(0, rt.candles.length - 1500)
        }
        // UTC day roll
        const dayKey = utcDayKey(vt)
        if (dayKey !== rt.day) {
          rt.day = dayKey
          rt.dayOpen = price
          rt.dayHigh = price
          rt.dayLow = price
        }
        rt.dayHigh = Math.max(rt.dayHigh, price)
        rt.dayLow = Math.min(rt.dayLow, price)
        // Sometimes a price spike becomes breaking news
        if (spike && this.rng() < 0.15) this.breakingQueue.push({ pair: rt.pair, at: vt })
      }
      // Intrabar SL/TP + trailing per step
      this.checkPositionsStep(open, vt)
    }

    // Flush trailing/SL modifications
    for (const p of open) {
      if (p.dirty) {
        await db.position
          .update({ where: { id: p.id }, data: { stopLoss: p.stopLoss, takeProfit: p.takeProfit, trailing: p.trailing, trailingPips: p.trailingPips } })
          .catch(() => undefined)
        p.dirty = false
      }
    }

    // Settle closes detected during the steps (SL/TP)
    for (const c of this.pendingCloses) await this.settleClose(c.p, c.reason, c.price, c.at)
    this.pendingCloses.length = 0

    // Account daily roll — reset day counters and send the daily report email
    const todayKey = utcDayKey(now)
    if (todayKey !== this.account.day) {
      const startBal = this.account.dailyStartBalance
      const dayPnl = this.account.balance - startBal
      const dayPct = startBal > 0 ? (dayPnl / startBal) * 100 : 0
      const closedToday = await db.position.count({ where: { status: 'CLOSED', closedAt: { gte: new Date(now - 86400_000) } } }).catch(() => 0)
      this.account.day = todayKey
      this.account.dailyStartBalance = this.account.balance
      await this.persistAccount()
      await this.log('INFO', 'SYSTEM', 'Daily roll — dailyStartBalance direset')
      this.status.dailyBlocked = 'NONE'
      await simulateEmailSend(
        'daily_report',
        `Laporan harian: ${dayPnl >= 0 ? '+' : ''}$${dayPnl.toFixed(2)} (${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%)`,
        `Ringkasan akun FINEX (demo) untuk hari sebelumnya:\nBalance awal: $${startBal.toFixed(2)}\nBalance akhir: $${this.account.balance.toFixed(2)}\nPnL harian: ${dayPnl >= 0 ? '+' : ''}$${dayPnl.toFixed(2)} (${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}%)\nPosisi ditutup (24 jam): ${closedToday}`,
      )
    }

    // Breaking news generated from volatility spikes
    for (const b of this.breakingQueue) await this.createBreakingNews(b.pair, b.at)
    this.breakingQueue.length = 0

    // Price alerts
    await this.checkAlerts(now)

    // Stop-out enforcement
    await this.enforceStopOut(open, now)

    // AI auto-trading cycle (every ~15s)
    if (this.settings.tradingMode === 'ai') {
      if (now - this.lastAiCycleAt >= 15_000) {
        this.lastAiCycleAt = now
        try {
          await this.runAiCycle(now)
        } catch (e) {
          await this.log('ERROR', 'AI', `AI cycle error: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } else if (this.status.dailyBlocked !== 'NONE') {
      this.status.dailyBlocked = 'NONE'
    }

    // Periodic synthetic news
    await this.maybeGenerateNews(now)

    // Occasional log table pruning (keep newest 2000)
    if (now - this.lastLogPruneAt > 300_000) {
      this.lastLogPruneAt = now
      try {
        const stale = await db.logEntry.findMany({ orderBy: { createdAt: 'desc' }, skip: 2000, select: { id: true } })
        if (stale.length > 0) await db.logEntry.deleteMany({ where: { id: { in: stale.map((x) => x.id) } } })
      } catch {
        /* non-critical */
      }
    }
  }

  /** SL / TP / trailing checks for one simulated second. */
  private checkPositionsStep(open: RtPosition[], vt: number): void {
    for (let i = open.length - 1; i >= 0; i--) {
      const p = open[i]
      const rt = this.pairs.get(p.pair)
      if (!rt) continue
      const cfg = getPairConfig(p.pair)
      const s = this.settings

      if (p.side === 'BUY') {
        if (p.stopLoss !== null && rt.bid <= p.stopLoss) {
          this.pendingCloses.push({ p, reason: 'SL', price: p.stopLoss, at: new Date(vt) })
          open.splice(i, 1)
          continue
        }
        if (p.takeProfit !== null && rt.bid >= p.takeProfit) {
          this.pendingCloses.push({ p, reason: 'TP', price: p.takeProfit, at: new Date(vt) })
          open.splice(i, 1)
          continue
        }
      } else {
        if (p.stopLoss !== null && rt.ask >= p.stopLoss) {
          this.pendingCloses.push({ p, reason: 'SL', price: p.stopLoss, at: new Date(vt) })
          open.splice(i, 1)
          continue
        }
        if (p.takeProfit !== null && rt.ask <= p.takeProfit) {
          this.pendingCloses.push({ p, reason: 'TP', price: p.takeProfit, at: new Date(vt) })
          open.splice(i, 1)
          continue
        }
      }

      // Trailing stop
      const profitPips = p.side === 'BUY' ? (rt.bid - p.openPrice) / cfg.pipSize : (p.openPrice - rt.ask) / cfg.pipSize
      if (!p.trailing && s.trailingMode === 'ai' && profitPips > 6) {
        p.trailing = true
        if (p.trailingPips <= 0) p.trailingPips = s.trailingStopPips
        p.dirty = true
      }
      if (p.trailing) {
        const tp = p.trailingPips > 0 ? p.trailingPips : s.trailingStopPips
        if (profitPips > tp) {
          if (p.side === 'BUY') {
            const newSL = roundTo(rt.bid - tp * cfg.pipSize, cfg.digits)
            if (p.stopLoss === null || newSL > p.stopLoss) {
              p.stopLoss = newSL
              p.dirty = true
            }
          } else {
            const newSL = roundTo(rt.ask + tp * cfg.pipSize, cfg.digits)
            if (p.stopLoss === null || newSL < p.stopLoss) {
              p.stopLoss = newSL
              p.dirty = true
            }
          }
        }
      }
    }
  }

  /** Realize profit into balance, update DB row, learning hook, log + email sim. */
  private async settleClose(p: RtPosition, reason: string, closePrice: number, closedAt: Date): Promise<void> {
    const cfg = getPairConfig(p.pair)
    const pips = p.side === 'BUY' ? (closePrice - p.openPrice) / cfg.pipSize : (p.openPrice - closePrice) / cfg.pipSize
    const totalCommission = round2(p.commission + p.volume) // $1/lot charged at open + $1/lot at close
    const profit = round2(pips * cfg.pipValuePerLot * p.volume - totalCommission)
    const res = await db.position
      .updateMany({
        where: { id: p.id, status: 'OPEN' },
        data: { status: 'CLOSED', closePrice, closedAt, reason, profit, pips: round2(pips), commission: totalCommission },
      })
      .catch(() => ({ count: 0 }))
    if (res.count === 0) return // already closed elsewhere
    this.account.balance = round2(this.account.balance + profit)
    await this.persistAccount()
    await this.log(
      'INFO',
      'TRADING',
      `CLOSE #${p.ticket} ${p.pair} ${p.side} ${p.volume} lots @${closePrice.toFixed(cfg.digits)} | ${pips >= 0 ? '+' : ''}${pips.toFixed(1)} pips | ${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(2)} | ${reason}`,
      `Entry ${p.openPrice.toFixed(cfg.digits)} · source ${p.source}${p.signalTf ? ` · tf ${p.signalTf}` : ''}`,
    )
    await simulateEmailSend(
      'trade_close',
      `Posisi ditutup: ${p.pair} ${p.side} (${reason})`,
      `Ticket ${p.ticket}\nClose ${closePrice.toFixed(cfg.digits)}\nPips ${pips.toFixed(1)}\nProfit $${profit.toFixed(2)}\nKomisi $${totalCommission.toFixed(2)}`,
    )
    // Self-learning (AI auto-trades AND analysis-signal trades that recorded agreeing indicators)
    if ((p.source === 'AI' || p.source === 'ANALYSIS') && p.signalIndicators.length > 0) {
      await this.learn(p.signalIndicators, profit > 0, pips)
    }
  }

  /** Update learned weights for the indicators that agreed on a closed AI trade. */
  private async learn(ids: string[], win: boolean, pips: number): Promise<void> {
    const factor = 0.5 + Math.min(Math.abs(pips), 20) / 20
    for (const id of ids) {
      const st = this.weights.get(id) ?? { weight: 1, wins: 0, losses: 0, samples: 0 }
      st.samples += 1
      if (win) st.wins += 1
      else st.losses += 1
      st.weight = round2(clamp(st.weight + (win ? 0.08 : -0.06) * factor, 0.2, 3.0))
      this.weights.set(id, st)
      await db.modelStat
        .upsert({
          where: { indicator: id },
          create: { indicator: id, weight: st.weight, wins: st.wins, losses: st.losses, samples: st.samples },
          update: { weight: st.weight, wins: st.wins, losses: st.losses, samples: st.samples },
        })
        .catch(() => undefined)
    }
  }

  /**
   * Quote-currency → USD conversion rate for margin math.
   * E.g. EURJPY notional is in JPY → divide by USDJPY to get USD.
   * Uses live engine prices with config basePrice fallbacks.
   */
  private quoteToUsd(pairId: string): number {
    const quote = pairId.slice(3).toUpperCase()
    if (quote === 'USD') return 1
    // Direct rate USD{quote} (USDJPY, USDCHF, USDCAD): 1 quote-ccy = 1 / rate USD
    const direct = this.pairs.get(`USD${quote}` as Pair)
    if (direct && direct.bid > 0) return 1 / direct.bid
    // Inverse rate {quote}USD (GBPUSD, AUDUSD, NZDUSD): 1 quote-ccy = rate USD
    const inverse = this.pairs.get(`${quote}USD` as Pair)
    if (inverse && inverse.bid > 0) return inverse.bid
    // Config fallbacks (engine not seeded yet)
    const dCfg = PAIRS.find((p) => p.id === `USD${quote}`)
    if (dCfg && dCfg.basePrice > 0) return 1 / dCfg.basePrice
    const iCfg = PAIRS.find((p) => p.id === `${quote}USD`)
    if (iCfg && iCfg.basePrice > 0) return iCfg.basePrice
    return 1
  }

  /** Close the worst position while margin level stays below the 20% stop-out. */
  private async enforceStopOut(open: RtPosition[], now: number): Promise<void> {
    let guard = 0
    while (guard++ < 10 && open.length > 0) {
      let floating = 0
      let margin = 0
      let worst: RtPosition | null = null
      let worstFloat = Infinity
      for (const p of open) {
        const rt = this.pairs.get(p.pair)
        if (!rt) continue
        const cfg = getPairConfig(p.pair)
        const cur = p.side === 'BUY' ? rt.bid : rt.ask
        const pips = p.side === 'BUY' ? (cur - p.openPrice) / cfg.pipSize : (p.openPrice - cur) / cfg.pipSize
        const fl = pips * cfg.pipValuePerLot * p.volume - p.commission
        floating += fl
        margin += (p.volume * cfg.contractSize * p.openPrice * this.quoteToUsd(p.pair)) / this.leverage
        if (fl < worstFloat) {
          worstFloat = fl
          worst = p
        }
      }
      const equity = this.account.balance + floating
      const marginLevel = margin > 0 ? (equity / margin) * 100 : 0
      if (!(marginLevel > 0 && marginLevel < 20)) break
      if (!worst) break
      const rt = this.pairs.get(worst.pair)
      if (!rt) break
      const closePrice = worst.side === 'BUY' ? rt.bid : rt.ask
      const idx = open.indexOf(worst)
      open.splice(idx, 1)
      await this.settleClose(worst, 'STOP_OUT', closePrice, new Date(now))
      await this.log('ERROR', 'RISK', 'STOP OUT level 20%', `Margin level ${marginLevel.toFixed(1)}% — posisi terburuk ditutup paksa`)
      await simulateEmailSend('error', 'STOP OUT level 20%', `Margin level turun ke ${marginLevel.toFixed(1)}%. Posisi #${worst.ticket} (${worst.pair}) ditutup paksa oleh server.`)
    }
  }

  /** Check ACTIVE price alerts against the latest bid/ask. */
  private async checkAlerts(now: number): Promise<void> {
    let alerts
    try {
      alerts = await db.priceAlert.findMany({ where: { status: 'ACTIVE' } })
    } catch {
      return
    }
    for (const a of alerts) {
      const rt = this.pairs.get(a.pair as Pair)
      if (!rt) continue
      const hit = a.condition === 'ABOVE' ? rt.ask >= a.price : rt.bid <= a.price
      if (!hit) continue
      await db.priceAlert.update({ where: { id: a.id }, data: { status: 'TRIGGERED', triggeredAt: new Date(now) } }).catch(() => undefined)
      await this.log('INFO', 'ALERT', `ALERT: ${a.pair} ${a.condition === 'ABOVE' ? '≥' : '≤'} ${a.price} terpicu`, a.note ?? undefined)
      await simulateEmailSend(
        'alert',
        `Alert terpicu: ${a.pair} ${a.condition} ${a.price}`,
        `Harga ${a.pair} menyentuh ${a.condition === 'ABOVE' ? 'di atas' : 'di bawah'} ${a.price}.\nBid ${rt.bid} / Ask ${rt.ask}${a.note ? `\nCatatan: ${a.note}` : ''}`,
      )
    }
  }

  // ============================================================
  // AI AUTO-TRADING CYCLE
  // ============================================================
  private async runAiCycle(now: number): Promise<void> {
    const s = this.settings
    const acct = await this.getAccount()

    // 1. Daily gates (anti-MC + target)
    const dailyPct = acct.dailyPnlPct
    if (dailyPct <= -s.dailyRiskLimit) {
      if (this.status.dailyBlocked !== 'LIMIT') {
        this.status.dailyBlocked = 'LIMIT'
        await this.log('WARN', 'RISK', `ANTI-MC: daily limit tercapai (${dailyPct.toFixed(2)}%), trading dihentikan`)
        await simulateEmailSend('daily_limit', 'Daily limit tercapai', `Daily PnL ${dailyPct.toFixed(2)}% mencapai batas -${s.dailyRiskLimit}%. AI trading dihentikan sampai roll harian berikutnya.`)
      }
      return
    }
    if (dailyPct >= s.dailyTarget) {
      if (this.status.dailyBlocked !== 'TARGET') {
        this.status.dailyBlocked = 'TARGET'
        await this.log('INFO', 'RISK', `Target harian tercapai (+${dailyPct.toFixed(2)}%), AI berhenti trading hari ini`)
        await simulateEmailSend('daily_limit', 'Target harian tercapai', `Daily PnL +${dailyPct.toFixed(2)}% mencapai target +${s.dailyTarget}%. AI berhenti trading hari ini.`)
      }
      return
    }
    this.status.dailyBlocked = 'NONE'

    // 2. Session gate (real UTC clock)
    if (s.sessionMode === 'manual') {
      if (!s.sessions.some((x) => isSessionActive(x))) {
        await this.throttledLog('ai-session', 'DEBUG', 'AI', 'AI skip: tidak ada sesi terpilih yang aktif')
        return
      }
    } else if (!SESSIONS.some((x) => isSessionActive(x.id))) {
      await this.throttledLog('ai-session', 'DEBUG', 'AI', 'AI skip: pasar tutup (tidak ada sesi aktif)')
      return
    }

    // 3. News gate — avoid HIGH impact news published in the last 15 minutes
    if (s.avoidNews) {
      const recent = await db.newsItem
        .count({ where: { impact: 'HIGH', publishedAt: { gte: new Date(now - 15 * 60_000) } } })
        .catch(() => 0)
      if (recent > 0) {
        await this.throttledLog('ai-news', 'INFO', 'AI', 'AI skip: hindari news besar (HIGH impact < 15 menit)')
        return
      }
    }

    // 4. Position gates
    const openRows = await db.position.findMany({ where: { status: 'OPEN' } })
    if (openRows.length >= s.maxPositions) return
    const busyPairs = new Set(openRows.map((r) => r.pair))

    // 5. Candidates
    let candidates: Pair[]
    if (s.pairMode === 'manual') {
      candidates = s.pairs.filter((p) => !busyPairs.has(p))
    } else {
      const scored = PAIRS.filter((p) => !busyPairs.has(p.id))
        .map((pc) => {
          const rt = this.pairs.get(pc.id)!
          const changePct = rt.dayOpen !== 0 ? Math.abs((rt.bid - rt.dayOpen) / rt.dayOpen) * 100 : 0
          const spreadPips = (rt.ask - rt.bid) / pc.pipSize
          const tight = pc.spreadMax > pc.spreadMin ? clamp((pc.spreadMax - spreadPips) / (pc.spreadMax - pc.spreadMin), 0, 1) : 0
          return { pair: pc.id, score: changePct * 8 + tight }
        })
        .sort((a, b) => b.score - a.score)
      candidates = scored.slice(0, 2).map((x) => x.pair)
    }
    if (candidates.length === 0) return

    // 6-8. Timeframe + indicator selection + weighted vote per candidate
    const indicatorIds = s.indicatorMode === 'manual' ? s.indicators : this.topIndicatorsByWeight(12)
    let best: { pair: Pair; score: number; readings: IndicatorReading[]; tf: Timeframe } | null = null
    for (const pair of candidates) {
      const cfg = getPairConfig(pair)
      let tf: Timeframe
      if (s.timeframeMode === 'manual') {
        tf = s.timeframes[0]
      } else {
        const m15 = this.getCandles(pair, 'M15', 100)
        const atr = atrValue(m15, 14)
        tf = atr !== null && atr / cfg.pipSize > 1.5 * cfg.volPipsPerMin ? 'M5' : 'M15'
      }
      const { score, readings } = this.computeSignals(pair, tf, indicatorIds)
      if (!best || Math.abs(score) > Math.abs(best.score)) best = { pair, score, readings, tf }
    }
    if (!best) return

    // 9. Weak signal gate
    if (Math.abs(best.score) < 25) {
      await this.throttledLog('ai-weak', 'DEBUG', 'AI', `AI skip: sinyal lemah (${best.pair} score ${best.score.toFixed(0)})`, undefined, 120_000)
      return
    }

    // 10. Direction + SL/TP sizing
    const side: Side = best.score > 0 ? 'BUY' : 'SELL'
    const cfg = getPairConfig(best.pair)
    let slPips = s.stopLossPips
    if (s.riskMode === 'ai') {
      const atrCandles = this.getCandles(best.pair, best.tf, 100)
      const atr = atrValue(atrCandles, 14)
      const atrPips = atr !== null ? atr / cfg.pipSize : 0
      slPips = Math.round(clamp(atrPips * 1.2, RISK_LIMITS.stopLossPips.min, RISK_LIMITS.stopLossPips.max))
    }
    const tpPips = Math.max(1, Math.round(slPips * s.takeProfitRatio))

    // 11. Lot sizing (risk-based) + margin reduction
    const riskUSD = (acct.equity * s.riskPerTrade) / 100
    let lots = round2(clamp(riskUSD / (slPips * cfg.pipValuePerLot), RISK_LIMITS.volume.min, RISK_LIMITS.volume.max))
    const rt = this.pairs.get(best.pair)!
    const refPrice = side === 'BUY' ? rt.ask : rt.bid
    if (refPrice > 0) {
      const maxAffordable =
        (acct.freeMargin * 0.8 * this.leverage) / (cfg.contractSize * refPrice * this.quoteToUsd(best.pair))
      if (lots > maxAffordable) lots = round2(clamp(maxAffordable, 0, RISK_LIMITS.volume.max))
    }
    if (lots < RISK_LIMITS.volume.min) {
      await this.throttledLog('ai-margin', 'DEBUG', 'AI', 'AI skip: margin tidak cukup untuk lot minimum')
      return
    }

    // 12. Open the position
    const agreeing = best.readings.filter((r) => r.signal === side).map((r) => r.id)
    try {
      const row = await this.placeOrder({
        pair: best.pair,
        side,
        volume: lots,
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        source: 'AI',
        comment: `AI|${s.aiProvider}|score=${best.score.toFixed(0)}|tf=${best.tf}`,
      })
      await db.position
        .update({ where: { id: row.id }, data: { signalScore: best.score, signalIndicators: agreeing.join(','), signalTf: best.tf } })
        .catch(() => undefined)
      const top = best.readings
        .filter((r) => r.signal !== 'NEUTRAL')
        .slice(0, 5)
        .map((r) => `${r.id}(${r.signal === 'BUY' ? '+1' : '-1'})`)
        .join(', ')
      const entry = side === 'BUY' ? rt.ask : rt.bid
      await this.log(
        'INFO',
        'AI',
        `AI OPEN ${best.pair} ${side} ${lots} lots @${entry.toFixed(cfg.digits)} | SL ${slPips}p TP ${tpPips}p | score ${best.score >= 0 ? '+' : ''}${best.score.toFixed(0)} | top: ${top || '—'}`,
      )
      this.status.lastAiDecision = `${new Date(now).toISOString().slice(11, 19)} UTC · ${best.pair} ${side} ${lots} lot · score ${best.score.toFixed(0)} (${best.tf})`
    } catch (e) {
      await this.log('WARN', 'AI', `AI open gagal: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private topIndicatorsByWeight(n: number): string[] {
    return INDICATOR_IDS.slice()
      .sort((a, b) => (this.weights.get(b)?.weight ?? 1) - (this.weights.get(a)?.weight ?? 1))
      .slice(0, n)
  }

  // ============================================================
  // SYNTHETIC NEWS
  // ============================================================
  private async maybeGenerateNews(now: number): Promise<void> {
    if (now - this.lastNewsAt < 90_000) return
    this.lastNewsAt = now
    if (this.rng() > 0.6) return // ~60% chance each attempt
    const tpl = NEWS_TEMPLATES[Math.floor(this.rng() * NEWS_TEMPLATES.length)]
    const sentiment = round2(clamp(tpl.sentiment + (this.rng() - 0.5) * 0.3, -1, 1))
    await db.newsItem
      .create({
        data: {
          source: 'SIM',
          headline: tpl.headline,
          summary: tpl.summary,
          url: null,
          sentiment,
          impact: tpl.impact,
          category: tpl.category,
          pairs: tpl.category === 'COMMODITY' ? 'XAUUSD' : 'EURUSD,USDJPY,GBPUSD,XAUUSD',
          publishedAt: new Date(now),
        },
      })
      .catch(() => undefined)
    await this.pruneNews()
  }

  private async createBreakingNews(pair: Pair, at: number): Promise<void> {
    if (at - this.lastBreakingAt < 5 * 60_000) return
    this.lastBreakingAt = at
    const tpl = BREAKING_TEMPLATES[Math.floor(this.rng() * BREAKING_TEMPLATES.length)]
    const sentiment = round2(clamp(tpl.sentiment + (this.rng() - 0.5) * 0.2, -1, 1))
    await db.newsItem
      .create({
        data: {
          source: 'SIM',
          headline: tpl.headline,
          summary: tpl.summary,
          url: null,
          sentiment,
          impact: 'HIGH',
          category: 'BREAKING',
          pairs: pair,
          publishedAt: new Date(at),
        },
      })
      .catch(() => undefined)
    await this.pruneNews()
  }

  private async pruneNews(): Promise<void> {
    try {
      const count = await db.newsItem.count()
      if (count <= 80) return
      const stale = await db.newsItem.findMany({ orderBy: { publishedAt: 'desc' }, skip: 80, select: { id: true } })
      if (stale.length > 0) await db.newsItem.deleteMany({ where: { id: { in: stale.map((x) => x.id) } } })
    } catch {
      /* non-critical */
    }
  }

  // ============================================================
  // ORDER METHODS
  // ============================================================
  async placeOrder(input: {
    pair: string
    side: Side
    volume?: number
    riskBased?: boolean
    stopLossPips?: number
    takeProfitPips?: number
    source?: 'MANUAL' | 'AI' | 'ANALYSIS'
    signalIndicators?: string[]
    comment?: string
  }): Promise<PositionRow> {
    await this.ready
    const s = this.settings
    if (!PAIR_IDS.includes(input.pair as Pair)) throw new Error(`Pair tidak dikenal: ${input.pair}`)
    if (input.side !== 'BUY' && input.side !== 'SELL') throw new Error('Side harus BUY atau SELL')
    const pair = input.pair as Pair
    const cfg = getPairConfig(pair)
    const rt = this.pairs.get(pair)
    if (!rt) throw new Error(`Pair ${pair} tidak tersedia`)

    const openCount = await db.position.count({ where: { status: 'OPEN' } })
    if (openCount >= s.maxPositions) throw new Error(`Maksimal ${s.maxPositions} posisi terbuka (atur di Settings)`)

    const slPips = Math.round(clamp(input.stopLossPips ?? s.stopLossPips, RISK_LIMITS.stopLossPips.min, RISK_LIMITS.stopLossPips.max))
    const tpPips = Math.max(1, Math.round(input.takeProfitPips ?? slPips * s.takeProfitRatio))
    const side = input.side
    const acct = await this.getAccount()

    let volume: number
    if (input.riskBased) {
      const riskUSD = (acct.equity * s.riskPerTrade) / 100
      volume = riskUSD / (slPips * cfg.pipValuePerLot)
    } else {
      volume = input.volume ?? 0.01
    }
    volume = round2(clamp(volume, RISK_LIMITS.volume.min, RISK_LIMITS.volume.max))

    const openPrice = side === 'BUY' ? rt.ask : rt.bid
    const requiredMargin = (volume * cfg.contractSize * openPrice * this.quoteToUsd(pair)) / this.leverage
    if (requiredMargin > acct.freeMargin * 0.9) {
      throw new Error(`Margin tidak cukup: butuh ~$${requiredMargin.toFixed(0)}, tersedia $${acct.freeMargin.toFixed(0)}`)
    }

    const stopLoss = roundTo(side === 'BUY' ? openPrice - slPips * cfg.pipSize : openPrice + slPips * cfg.pipSize, cfg.digits)
    const takeProfit = roundTo(side === 'BUY' ? openPrice + tpPips * cfg.pipSize : openPrice - tpPips * cfg.pipSize, cfg.digits)
    const ticket = String(Math.floor(100000000 + Math.random() * 899999999))
    const commission = round2(volume) // $1 per lot per side (open side)
    const source = input.source ?? 'MANUAL'

    const row = await db.position.create({
      data: {
        ticket,
        pair,
        side,
        volume,
        openPrice,
        stopLoss,
        takeProfit,
        trailing: false,
        trailingPips: 0,
        commission,
        status: 'OPEN',
        source,
        mode: 'DEMO',
        comment: input.comment ?? null,
        signalIndicators:
          (source === 'AI' || source === 'ANALYSIS') && input.signalIndicators && input.signalIndicators.length > 0
            ? input.signalIndicators.slice(0, 12).join(',')
            : null,
      },
    })

    if (source === 'AI') this.status.autoTradeCount += 1
    else this.status.manualTradeCount += 1

    await this.log(
      'INFO',
      'TRADING',
      `OPEN #${ticket} ${pair} ${side} ${volume} lots @${openPrice.toFixed(cfg.digits)} | SL ${slPips}p TP ${tpPips}p | ${source}`,
    )
    await simulateEmailSend(
      'trade_open',
      `Posisi dibuka: ${pair} ${side} ${volume} lot`,
      `Ticket ${ticket}\nEntry ${openPrice.toFixed(cfg.digits)}\nSL ${stopLoss.toFixed(cfg.digits)} (${slPips} pips)\nTP ${takeProfit.toFixed(cfg.digits)} (${tpPips} pips)\nKomisi $${commission.toFixed(2)}`,
    )
    return row
  }

  async closePosition(id: string, reason: string): Promise<void> {
    await this.ready
    const row = await db.position.findUnique({ where: { id } })
    if (!row || row.status !== 'OPEN') throw new Error('Posisi tidak ditemukan atau sudah ditutup')
    const rt = this.pairs.get(row.pair as Pair)
    if (!rt) throw new Error('Harga pair tidak tersedia')
    const closePrice = row.side === 'BUY' ? rt.bid : rt.ask
    await this.settleClose(toRtPosition(row), reason, closePrice, new Date())
  }

  async closeAll(reason: string): Promise<number> {
    await this.ready
    const rows = await db.position.findMany({ where: { status: 'OPEN' } })
    let n = 0
    for (const row of rows) {
      const rt = this.pairs.get(row.pair as Pair)
      if (!rt) continue
      const closePrice = row.side === 'BUY' ? rt.bid : rt.ask
      await this.settleClose(toRtPosition(row), reason, closePrice, new Date())
      n++
    }
    return n
  }

  async modifyPosition(id: string, patch: { stopLoss?: number | null; takeProfit?: number | null; trailing?: boolean }): Promise<void> {
    await this.ready
    const row = await db.position.findUnique({ where: { id } })
    if (!row || row.status !== 'OPEN') throw new Error('Posisi tidak ditemukan atau sudah ditutup')
    const data: { stopLoss?: number | null; takeProfit?: number | null; trailing?: boolean; trailingPips?: number } = {}
    if (patch.stopLoss !== undefined) data.stopLoss = patch.stopLoss
    if (patch.takeProfit !== undefined) data.takeProfit = patch.takeProfit
    if (patch.trailing !== undefined) {
      data.trailing = patch.trailing
      if (patch.trailing && (!row.trailingPips || row.trailingPips <= 0)) data.trailingPips = this.settings.trailingStopPips
    }
    await db.position.update({ where: { id }, data })
    await this.log(
      'INFO',
      'TRADING',
      `MODIFY #${row.ticket} ${row.pair} | SL ${patch.stopLoss !== undefined ? (patch.stopLoss ?? '—') : (row.stopLoss ?? '—')} | TP ${patch.takeProfit !== undefined ? (patch.takeProfit ?? '—') : (row.takeProfit ?? '—')} | trailing ${patch.trailing ?? row.trailing ? 'ON' : 'OFF'}`,
    )
  }

  // ============================================================
  // GETTERS
  // ============================================================
  getStatus(): EngineStatus {
    return {
      mode: this.settings.engineMode === 'live' ? 'LIVE' : 'DEMO',
      connected: true,
      aiTrading: this.settings.tradingMode === 'ai',
      autoTradeCount: this.status.autoTradeCount,
      manualTradeCount: this.status.manualTradeCount,
      lastTickAt: new Date(this.lastTickAt).toISOString(),
      marketOpen: true,
      activeSessions: SESSIONS.filter((s) => isSessionActive(s.id)).map((s) => s.id),
      latencyMs: this.latencyMs,
      version: APP_VERSION,
      lastAiDecision: this.status.lastAiDecision,
      dailyBlocked: this.status.dailyBlocked,
    }
  }

  async getAccount(): Promise<AccountInfo> {
    await this.ready
    const rows = await db.position.findMany({ where: { status: 'OPEN' } })
    let floating = 0
    let margin = 0
    for (const row of rows) {
      const rt = this.pairs.get(row.pair as Pair)
      if (!rt) continue
      const cfg = getPairConfig(row.pair)
      const cur = row.side === 'BUY' ? rt.bid : rt.ask
      const pips = row.side === 'BUY' ? (cur - row.openPrice) / cfg.pipSize : (row.openPrice - cur) / cfg.pipSize
      floating += pips * cfg.pipValuePerLot * row.volume - row.commission
      margin += (row.volume * cfg.contractSize * row.openPrice * this.quoteToUsd(row.pair)) / this.leverage
    }
    floating = round2(floating)
    const equity = round2(this.account.balance + floating)
    const freeMargin = round2(equity - margin)
    const marginLevel = margin > 0 ? (equity / margin) * 100 : 0
    const dailyPnl = round2(equity - this.account.dailyStartBalance)
    const dailyPnlPct = this.account.dailyStartBalance > 0 ? (dailyPnl / this.account.dailyStartBalance) * 100 : 0
    return {
      balance: round2(this.account.balance),
      equity,
      margin: round2(margin),
      freeMargin,
      marginLevel: Math.round(marginLevel * 10) / 10,
      floatingPnl: floating,
      dailyPnl,
      dailyPnlPct: Math.round(dailyPnlPct * 100) / 100,
      dailyStartBalance: round2(this.account.dailyStartBalance),
      dailyTargetPct: this.settings.dailyTarget,
      dailyLimitPct: this.settings.dailyRiskLimit,
      currency: this.accountMeta.currency,
      leverage: this.leverage,
      server: this.accountMeta.server,
      login: this.accountMeta.login,
      mode: this.settings.engineMode === 'live' ? 'LIVE' : 'DEMO',
      currencySymbol: '$',
    }
  }

  getPrices(): PriceTick[] {
    const out: PriceTick[] = []
    const updatedAt = new Date(this.lastTickAt).toISOString()
    for (const rt of this.pairs.values()) {
      const cfg = getPairConfig(rt.pair)
      const changePips = (rt.bid - rt.dayOpen) / cfg.pipSize
      const changePct = rt.dayOpen !== 0 ? ((rt.bid - rt.dayOpen) / rt.dayOpen) * 100 : 0
      out.push({
        pair: rt.pair,
        bid: rt.bid,
        ask: rt.ask,
        spread: Math.round(((rt.ask - rt.bid) / cfg.pipSize) * 10) / 10,
        changePct: Math.round(changePct * 100) / 100,
        changePips: Math.round(changePips * 10) / 10,
        dayHigh: rt.dayHigh,
        dayLow: rt.dayLow,
        digits: cfg.digits,
        updatedAt,
      })
    }
    return out
  }

  /** Aggregate in-memory M1 candles into the requested timeframe (newest last). */
  getCandles(pair: string, tf: string, limit = 200): Candle[] {
    const rt = this.pairs.get(pair as Pair)
    if (!rt) return []
    const maxLimit = Math.min(Math.max(Math.floor(limit) || 200, 1), 1000)
    const mins = getTimeframeMinutes(tf)
    const src = rt.candles
    if (mins <= 1) return src.slice(-maxLimit)
    const bucketMs = mins * 60000
    const out: Candle[] = []
    let cur: Candle | null = null
    for (const c of src) {
      const bt = Math.floor(c.time / bucketMs) * bucketMs
      if (!cur || cur.time !== bt) {
        cur = { time: bt, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
        out.push(cur)
      } else {
        cur.high = Math.max(cur.high, c.high)
        cur.low = Math.min(cur.low, c.low)
        cur.close = c.close
        cur.volume += c.volume
      }
    }
    return out.slice(-maxLimit)
  }

  async getPositions(): Promise<PositionView[]> {
    await this.ready
    const rows = await db.position.findMany({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } })
    const out: PositionView[] = []
    for (const row of rows) {
      const rt = this.pairs.get(row.pair as Pair)
      if (!rt) continue
      const cfg = getPairConfig(row.pair)
      const cur = row.side === 'BUY' ? rt.bid : rt.ask
      const pips = row.side === 'BUY' ? (cur - row.openPrice) / cfg.pipSize : (row.openPrice - cur) / cfg.pipSize
      out.push({
        id: row.id,
        ticket: row.ticket,
        pair: row.pair as Pair,
        side: row.side === 'SELL' ? 'SELL' : 'BUY',
        volume: row.volume,
        openPrice: row.openPrice,
        currentPrice: cur,
        stopLoss: row.stopLoss,
        takeProfit: row.takeProfit,
        trailing: row.trailing,
        trailingPips: row.trailingPips,
        profit: round2(pips * cfg.pipValuePerLot * row.volume - row.commission),
        pips: round2(pips),
        commission: row.commission,
        source: row.source === 'AI' ? 'AI' : row.source === 'ANALYSIS' ? 'ANALYSIS' : 'MANUAL',
        openedAt: row.openedAt.toISOString(),
        comment: row.comment,
      })
    }
    return out
  }

  async getClosedTrades(limit = 50): Promise<ClosedTrade[]> {
    await this.ready
    const rows = await db.position.findMany({
      where: { status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      take: Math.min(Math.max(Math.floor(limit) || 50, 1), 200),
    })
    return rows.map((r) => {
      const closedAt = r.closedAt ?? r.openedAt
      return {
        id: r.id,
        ticket: r.ticket,
        pair: r.pair as Pair,
        side: r.side === 'SELL' ? 'SELL' : 'BUY',
        volume: r.volume,
        openPrice: r.openPrice,
        closePrice: r.closePrice ?? r.openPrice,
        profit: r.profit,
        pips: r.pips,
        commission: r.commission,
        reason: r.reason ?? '—',
        source: r.source,
        openedAt: r.openedAt.toISOString(),
        closedAt: closedAt.toISOString(),
        durationSec: Math.max(0, Math.round((closedAt.getTime() - r.openedAt.getTime()) / 1000)),
      }
    })
  }

  async getSettings(): Promise<SettingsData> {
    await this.ready
    return { ...this.settings }
  }

  async saveSettings(s: SettingsData): Promise<void> {
    await this.ready
    const n = this.normalizeSettings(s)
    this.settings = n
    const data = {
      tradingMode: n.tradingMode,
      pairMode: n.pairMode,
      pairs: n.pairs.join(','),
      sessionMode: n.sessionMode,
      sessions: n.sessions.join(','),
      timeframeMode: n.timeframeMode,
      timeframes: n.timeframes.join(','),
      aiProvider: n.aiProvider,
      indicatorMode: n.indicatorMode,
      indicators: n.indicators.join(','),
      riskMode: n.riskMode,
      riskPerTrade: n.riskPerTrade,
      stopLossPips: n.stopLossPips,
      takeProfitRatio: n.takeProfitRatio,
      maxPositions: n.maxPositions,
      dailyRiskLimit: n.dailyRiskLimit,
      dailyTarget: n.dailyTarget,
      avoidNews: n.avoidNews,
      trailingMode: n.trailingMode,
      trailingStopPips: n.trailingStopPips,
      engineMode: n.engineMode,
      engineUrl: n.engineUrl,
      emailEnabled: n.emailEnabled,
      emailTo: n.emailTo,
      emailEvents: n.emailEvents.join(','),
    }
    await db.settings.upsert({ where: { id: 'main' }, update: data, create: { id: 'main', ...data } })
  }

  async getIndicatorReadings(pair: string, tf: string, ids?: string[]): Promise<IndicatorReading[]> {
    await this.ready
    const list = ids && ids.length > 0 ? ids : this.settings.indicators
    const candles = this.getCandles(pair, tf, 200)
    const set = computeIndicatorSet(list, candles)
    return list.map((id) => {
      const cfg = getIndicatorConfig(id)
      const calc = set[id]
      const w = this.weights.get(id)
      return {
        id,
        name: cfg.name,
        category: cfg.category,
        value: calc.display,
        signal: calc.signal,
        weight: w ? Math.round(w.weight * 100) / 100 : 1,
        detail: calc.detail,
      }
    })
  }

  /** Weighted indicator voting — synchronous, uses the in-memory weight cache. */
  computeSignals(pair: string, tf: string, ids: string[]): { score: number; readings: IndicatorReading[] } {
    const candles = this.getCandles(pair, tf, 200)
    const set = computeIndicatorSet(ids, candles)
    let num = 0
    let den = 0
    const readings: IndicatorReading[] = []
    for (const id of ids) {
      const cfg = getIndicatorConfig(id)
      const calc = set[id]
      const w = this.weights.get(id)?.weight ?? 1
      const sv = calc.signal === 'BUY' ? 1 : calc.signal === 'SELL' ? -1 : 0
      num += sv * w
      den += w
      readings.push({
        id,
        name: cfg.name,
        category: cfg.category,
        value: calc.display,
        signal: calc.signal,
        weight: Math.round(w * 100) / 100,
        detail: calc.detail,
      })
    }
    const score = den > 0 ? clamp((num / den) * 100, -100, 100) : 0
    return { score: Math.round(score), readings }
  }

  async log(level: LogLevel, category: string, message: string, details?: string): Promise<void> {
    try {
      await db.logEntry.create({ data: { level, category, message, details: details ?? null } })
    } catch {
      // logging must never break the engine
    }
  }

  private async throttledLog(key: string, level: LogLevel, category: string, message: string, details?: string, intervalMs = 60_000): Promise<void> {
    const now = Date.now()
    const last = this.throttle.get(key) ?? 0
    if (now - last < intervalMs) return
    this.throttle.set(key, now)
    await this.log(level, category, message, details)
  }

  // ============================================================
  // SETTINGS PERSISTENCE HELPERS
  // ============================================================
  private async persistAccount(): Promise<void> {
    await db.account
      .update({ where: { id: 'main' }, data: { balance: this.account.balance, dailyStartBalance: this.account.dailyStartBalance } })
      .catch(() => undefined)
  }

  private parseSettingsRow(row: SettingsRow): SettingsData {
    const mode = (v: string | null): SelectionMode => (v === 'ai' ? 'ai' : 'manual')
    const pairs = parseCsv(row.pairs).filter((p): p is Pair => PAIR_IDS.includes(p as Pair))
    const sessions = parseCsv(row.sessions).filter((x): x is SessionId => SESSION_IDS.includes(x as SessionId))
    const timeframes = parseCsv(row.timeframes).filter((x): x is Timeframe => TIMEFRAME_IDS.includes(x as Timeframe))
    const indicators = parseCsv(row.indicators).filter((x) => INDICATOR_IDS.includes(x))
    const emailEvents = parseCsv(row.emailEvents).filter((x) => EVENTS_NOTIF.some((e) => e.id === x))
    return {
      tradingMode: mode(row.tradingMode),
      pairMode: mode(row.pairMode),
      pairs: pairs.length ? pairs : ([...DEFAULT_SETTINGS.pairs] as Pair[]),
      sessionMode: mode(row.sessionMode),
      sessions: sessions.length ? sessions : ([...DEFAULT_SETTINGS.sessions] as SessionId[]),
      timeframeMode: mode(row.timeframeMode),
      timeframes: timeframes.length ? timeframes : ([...DEFAULT_SETTINGS.timeframes] as Timeframe[]),
      aiProvider: AI_PROVIDER_IDS.includes(row.aiProvider as AiProviderId) ? (row.aiProvider as AiProviderId) : 'zai',
      indicatorMode: mode(row.indicatorMode),
      indicators: indicators.length ? indicators : [...DEFAULT_SETTINGS.indicators],
      riskMode: mode(row.riskMode),
      riskPerTrade: clamp(row.riskPerTrade, RISK_LIMITS.riskPerTrade.min, RISK_LIMITS.riskPerTrade.max),
      stopLossPips: Math.round(clamp(row.stopLossPips, RISK_LIMITS.stopLossPips.min, RISK_LIMITS.stopLossPips.max)),
      takeProfitRatio: clamp(row.takeProfitRatio, RISK_LIMITS.takeProfitRatio.min, RISK_LIMITS.takeProfitRatio.max),
      maxPositions: Math.round(clamp(row.maxPositions, RISK_LIMITS.maxPositions.min, RISK_LIMITS.maxPositions.max)),
      dailyRiskLimit: clamp(row.dailyRiskLimit, RISK_LIMITS.dailyRiskLimit.min, RISK_LIMITS.dailyRiskLimit.max),
      dailyTarget: clamp(row.dailyTarget, RISK_LIMITS.dailyTarget.min, RISK_LIMITS.dailyTarget.max),
      avoidNews: row.avoidNews,
      trailingMode: mode(row.trailingMode),
      trailingStopPips: Math.round(clamp(row.trailingStopPips, RISK_LIMITS.trailingStopPips.min, RISK_LIMITS.trailingStopPips.max)),
      engineMode: row.engineMode === 'live' ? 'live' : 'demo',
      engineUrl: row.engineUrl && row.engineUrl.trim() ? row.engineUrl.trim() : DEFAULT_SETTINGS.engineUrl,
      emailEnabled: row.emailEnabled,
      emailTo: row.emailTo ?? '',
      emailEvents: emailEvents.length ? emailEvents : [...DEFAULT_SETTINGS.emailEvents],
    }
  }

  private normalizeSettings(input: SettingsData): SettingsData {
    const mode = (v: unknown): SelectionMode => (v === 'ai' ? 'ai' : 'manual')
    const num = (v: unknown, cur: number, lim: { min: number; max: number }): number => {
      const n = typeof v === 'number' && isFinite(v) ? v : cur
      return clamp(n, lim.min, lim.max)
    }
    const cur = this.settings
    const pairs = (Array.isArray(input.pairs) ? input.pairs : []).filter((p): p is Pair => PAIR_IDS.includes(p as Pair))
    const sessions = (Array.isArray(input.sessions) ? input.sessions : []).filter((x): x is SessionId => SESSION_IDS.includes(x as SessionId))
    const timeframes = (Array.isArray(input.timeframes) ? input.timeframes : []).filter((x): x is Timeframe => TIMEFRAME_IDS.includes(x as Timeframe))
    const indicators = (Array.isArray(input.indicators) ? input.indicators : []).filter((x) => INDICATOR_IDS.includes(x))
    const emailEvents = (Array.isArray(input.emailEvents) ? input.emailEvents : []).filter((x) => EVENTS_NOTIF.some((e) => e.id === x))
    return {
      tradingMode: mode(input.tradingMode),
      pairMode: mode(input.pairMode),
      pairs: pairs.length ? pairs : cur.pairs,
      sessionMode: mode(input.sessionMode),
      sessions: sessions.length ? sessions : cur.sessions,
      timeframeMode: mode(input.timeframeMode),
      timeframes: timeframes.length ? timeframes : cur.timeframes,
      aiProvider: AI_PROVIDER_IDS.includes(input.aiProvider as AiProviderId) ? (input.aiProvider as AiProviderId) : cur.aiProvider,
      indicatorMode: mode(input.indicatorMode),
      indicators: indicators.length ? indicators : cur.indicators,
      riskMode: mode(input.riskMode),
      riskPerTrade: num(input.riskPerTrade, cur.riskPerTrade, RISK_LIMITS.riskPerTrade),
      stopLossPips: Math.round(num(input.stopLossPips, cur.stopLossPips, RISK_LIMITS.stopLossPips)),
      takeProfitRatio: Math.round(num(input.takeProfitRatio, cur.takeProfitRatio, RISK_LIMITS.takeProfitRatio) * 10) / 10,
      maxPositions: Math.round(num(input.maxPositions, cur.maxPositions, RISK_LIMITS.maxPositions)),
      dailyRiskLimit: Math.round(num(input.dailyRiskLimit, cur.dailyRiskLimit, RISK_LIMITS.dailyRiskLimit) * 10) / 10,
      dailyTarget: Math.round(num(input.dailyTarget, cur.dailyTarget, RISK_LIMITS.dailyTarget) * 10) / 10,
      avoidNews: typeof input.avoidNews === 'boolean' ? input.avoidNews : cur.avoidNews,
      trailingMode: mode(input.trailingMode),
      trailingStopPips: Math.round(num(input.trailingStopPips, cur.trailingStopPips, RISK_LIMITS.trailingStopPips)),
      engineMode: input.engineMode === 'live' ? 'live' : 'demo',
      engineUrl: typeof input.engineUrl === 'string' && input.engineUrl.trim() ? input.engineUrl.trim() : cur.engineUrl,
      emailEnabled: typeof input.emailEnabled === 'boolean' ? input.emailEnabled : cur.emailEnabled,
      emailTo: typeof input.emailTo === 'string' ? input.emailTo : cur.emailTo,
      emailEvents,
    }
  }
}

// ------------------------------------------------------------
// Module-level helpers
// ------------------------------------------------------------
function toRtPosition(row: PositionRow): RtPosition {
  return {
    id: row.id,
    ticket: row.ticket,
    pair: row.pair as Pair,
    side: row.side === 'SELL' ? 'SELL' : 'BUY',
    volume: row.volume,
    openPrice: row.openPrice,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    trailing: row.trailing,
    trailingPips: row.trailingPips,
    commission: row.commission,
    source: row.source === 'AI' ? 'AI' : row.source === 'ANALYSIS' ? 'ANALYSIS' : 'MANUAL',
    signalIndicators: parseCsv(row.signalIndicators),
    signalTf: row.signalTf,
    openedAt: row.openedAt,
    dirty: false,
  }
}

function defaultSettingsData(): SettingsData {
  return {
    ...DEFAULT_SETTINGS,
    pairs: [...DEFAULT_SETTINGS.pairs] as Pair[],
    sessions: [...DEFAULT_SETTINGS.sessions] as SessionId[],
    timeframes: [...DEFAULT_SETTINGS.timeframes] as Timeframe[],
    indicators: [...DEFAULT_SETTINGS.indicators],
    emailEvents: [...DEFAULT_SETTINGS.emailEvents],
  }
}

// ------------------------------------------------------------
// Singleton (survives HMR via globalThis)
// ------------------------------------------------------------
const globalForSim = globalThis as unknown as {
  __finexSimulator?: Simulator
}

export function getSimulator(): Simulator {
  if (!globalForSim.__finexSimulator) {
    globalForSim.__finexSimulator = new Simulator()
  }
  return globalForSim.__finexSimulator
}
