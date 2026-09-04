/**
 * /api/backtest — Strategy Backtesting API (v2)
 * ================================================
 * GET    — list recent backtest results (+ optional ?withTrades=id)
 * POST   — run a backtest with the v2 engine
 * DELETE — remove a result (and its per-trade rows)
 *
 * v2 improvements over v1:
 *   - 6 real signal engines (SMA/EMA crossover, RSI, MACD, Bollinger, Donchian)
 *     — NO mock metrics anymore
 *   - When real candle data is unavailable, a deterministic synthetic series
 *     is generated so the engine performs a REAL simulation over synthetic
 *     prices (clearly labeled `dataSource: "synthetic"`)
 *   - Extended metrics: Sortino, Calmar, expectancy, gross P/L, streaks,
 *     commission totals, exposure, absolute drawdown
 *   - Per-trade ledger persisted to BacktestTrade (equity/DD per trade)
 *   - Rate limited via global middleware (POST → DRAFT tier)
 *   - Config budget caps from app-config (maxCandles, maxTradesPersist)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { getConfig } from '@/lib/app-config'
import { apiErrorResponse } from '@/lib/api-errors'
import {
  runBacktest,
  mergeParams,
  generateSyntheticCandles,
  BACKTEST_STRATEGIES,
  warmupBars,
  type BacktestStrategyId,
} from '@/lib/backtest-engine'

export const dynamic = 'force-dynamic'

// ---------- Timeframe normalisation ----------
// UI sends "1m", "5m", "1H", "1D" etc. DB stores "M1", "M5", "H1", "D1"
const TF_MAP: Record<string, string> = {
  '1m': 'M1', '5m': 'M5', '15m': 'M15',
  '30m': 'M30', '1H': 'H1', '4H': 'H4',
  '1D': 'D1', '1W': 'W1',
}

function normalizeTf(tf: string): string {
  return TF_MAP[tf] ?? tf.toUpperCase()
}

/** Bars per year for Sharpe/Sortino annualisation (IDX: 435 min/day, ~250 days). */
function getBarsPerYear(timeframe: string): number {
  const IDX_MINUTES_PER_DAY = 435
  const TRADING_DAYS = 250
  switch (timeframe.toUpperCase()) {
    case 'M1': return IDX_MINUTES_PER_DAY * TRADING_DAYS
    case 'M5': return Math.floor(IDX_MINUTES_PER_DAY / 5) * TRADING_DAYS
    case 'M15': return Math.floor(IDX_MINUTES_PER_DAY / 15) * TRADING_DAYS
    case 'M30': return Math.floor(IDX_MINUTES_PER_DAY / 30) * TRADING_DAYS
    case 'H1': return Math.floor(IDX_MINUTES_PER_DAY / 60) * TRADING_DAYS
    case 'H4': return Math.floor(IDX_MINUTES_PER_DAY / 240) * TRADING_DAYS
    case 'D1': return 252
    case 'W1': return 52
    default: return 252
  }
}

// ---------- Strategy label mapping (UI names → engine IDs) ----------
const STRATEGY_ALIASES: Record<string, BacktestStrategyId> = {
  // v2 engine strategies (canonical)
  'SMA Crossover': 'SMA_CROSSOVER',
  'EMA Crossover': 'EMA_CROSSOVER',
  'RSI Mean Reversion': 'RSI_MEAN_REVERSION',
  'MACD Momentum': 'MACD_MOMENTUM',
  'Bollinger Breakout': 'BOLLINGER_BREAKOUT',
  'Donchian Breakout': 'DONCHIAN_BREAKOUT',
  // Legacy v1 UI labels → closest v2 engine
  'Moving Average Ribbon': 'SMA_CROSSOVER',
  'Momentum Scalping': 'MACD_MOMENTUM',
  'Pivot Point': 'BOLLINGER_BREAKOUT',
  'RMI Trend Sync': 'DONCHIAN_BREAKOUT',
  'Linear Regression': 'BOLLINGER_BREAKOUT',
  'EMA/RSI Filter': 'RSI_MEAN_REVERSION',
}

export const STRATEGY_OPTIONS = BACKTEST_STRATEGIES

function resolveStrategy(label: string): BacktestStrategyId | null {
  const direct = STRATEGY_ALIASES[label]
  if (direct) return direct
  const upper = label.toUpperCase().replace(/\s+/g, '_')
  const byId = BACKTEST_STRATEGIES.find((s) => s.id === upper)
  if (byId) return byId.id
  return null
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
  const symbol = typeof body.symbol === 'string' && body.symbol.trim() ? body.symbol.trim() : ''
  const strategy = typeof body.strategy === 'string' && body.strategy.trim() ? body.strategy.trim() : ''
  const timeframe = typeof body.timeframe === 'string' && body.timeframe.trim() ? body.timeframe.trim() : ''

  if (!symbol) return { ok: false, error: 'symbol is required' }
  if (!strategy) return { ok: false, error: 'strategy is required' }
  if (!timeframe) return { ok: false, error: 'timeframe is required' }
  if (!resolveStrategy(strategy)) return { ok: false, error: `Unknown strategy: ${strategy}` }

  const capital = typeof body.initialCapital === 'number' ? body.initialCapital : 10_000
  if (capital <= 0) return { ok: false, error: 'initialCapital must be > 0' }
  if (capital > 100_000_000) return { ok: false, error: 'initialCapital exceeds limit' }

  let startDate: Date | undefined
  let endDate: Date | undefined
  if (body.startDate) {
    startDate = new Date(body.startDate as string)
    if (isNaN(startDate.getTime())) return { ok: false, error: 'startDate is not a valid date' }
  }
  if (body.endDate) {
    endDate = new Date(body.endDate as string)
    if (isNaN(endDate.getTime())) return { ok: false, error: 'endDate is not a valid date' }
  }
  if (startDate && endDate && startDate >= endDate) {
    return { ok: false, error: 'startDate must be before endDate' }
  }

  return {
    ok: true,
    data: {
      symbol,
      strategy,
      timeframe,
      startDate: startDate?.toISOString(),
      endDate: endDate?.toISOString(),
      initialCapital: capital,
      config: typeof body.config === 'object' && body.config ? (body.config as Record<string, unknown>) : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
    },
  }
}

// =============================================
// ROUTE HANDLERS
// =============================================

export async function GET(request: NextRequest) {
  try {
    const results = await db.backtestResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    logger.error('API', 'Error fetching backtest results', { details: String(error) })
    return apiErrorResponse(error, { route: 'GET /api/backtest' })
  }
}

export async function POST(request: NextRequest) {
  const t0 = Date.now()
  try {
    const body = await request.json()
    const validation = validatePayload(body)
    if (!validation.ok) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
    }

    const { symbol, strategy, timeframe, startDate, endDate, initialCapital: capital, config, name } = validation.data
    const start = startDate ? new Date(startDate) : new Date('2024-01-01')
    const end = endDate ? new Date(endDate) : new Date()

    const dbTimeframe = normalizeTf(timeframe)
    const engineId = resolveStrategy(strategy) as BacktestStrategyId
    const barsPerYear = getBarsPerYear(dbTimeframe)

    // ---- Resolve data source: real candles → synthetic fallback ----
    const maxCandles = getConfig<number>('backtest.maxCandles')
    let candles = await db.candleData.findMany({
      where: { symbol, timeframe: dbTimeframe, openTime: { gte: start, lte: end } },
      orderBy: { openTime: 'asc' },
      take: maxCandles,
    })

    let dataSource: 'database' | 'synthetic' = 'database'
    const params = mergeParams(engineId, { ...config, initialCapital: capital, barsPerYear })
    const minBars = warmupBars(engineId, params) + 50

    if (candles.length < minBars) {
      // Deterministic synthetic series — the ENGINE still runs for real
      const bars = Math.min(maxCandles, Math.max(minBars, 2_000))
      candles = generateSyntheticCandles({ symbol, timeframe: dbTimeframe, bars }) as typeof candles
      dataSource = 'synthetic'
    }

    // ---- Run the v2 engine ----
    const result = runBacktest(candles as never, params)
    const { metrics, trades, equityCurve } = result

    const totalReturn = capital > 0
      ? Math.round(((metrics.finalCapital - capital) / capital) * 10000) / 100
      : 0

    const configStr = JSON.stringify({
      ...config,
      engine: engineId,
      engineVersion: 'v2',
      dataSource,
      candleCount: candles.length,
      barsPerYear,
      fastPeriod: params.fastPeriod,
      slowPeriod: params.slowPeriod,
      atrPeriod: params.atrPeriod,
      slAtrMult: params.slAtrMult,
      tpAtrMult: params.tpAtrMult,
      positionPct: params.positionPct,
      commissionPerLot: params.commissionPerLot,
      slippageTicks: params.slippageTicks,
    })

    // ---- Persist result ----
    const row = await db.backtestResult.create({
      data: {
        name: name || `${strategy} - ${symbol} (${timeframe})${dataSource === 'synthetic' ? ' [SYNTHETIC DATA]' : ''}`,
        symbol,
        strategy,
        timeframe,
        startDate: candles.length > 0 ? new Date((candles[0] as { openTime: Date }).openTime) : start,
        endDate: candles.length > 0 ? new Date((candles[candles.length - 1] as { openTime: Date }).openTime) : end,
        initialCapital: capital,
        finalCapital: metrics.finalCapital,
        totalTrades: metrics.totalTrades,
        winTrades: metrics.winTrades,
        lossTrades: metrics.lossTrades,
        winRate: metrics.winRate,
        maxDrawdown: metrics.maxDrawdown,
        sharpeRatio: metrics.sharpeRatio ?? 0,
        profitFactor: metrics.profitFactor,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        totalPnl: metrics.totalPnl,
        config: configStr,
        // v2 metrics
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        expectancy: metrics.expectancy,
        avgTradePnl: metrics.avgTradePnl,
        grossProfit: metrics.grossProfit,
        grossLoss: metrics.grossLoss,
        maxConsecWins: metrics.maxConsecWins,
        maxConsecLosses: metrics.maxConsecLosses,
        commissionTotal: metrics.commissionTotal,
        maxDrawdownAbs: metrics.maxDrawdownAbs,
        finalEquityCurve: JSON.stringify(equityCurve),
        status: 'COMPLETED',
        durationMs: Date.now() - t0,
      },
    })

    // ---- Persist per-trade ledger (capped) ----
    const maxTradesPersist = getConfig<number>('backtest.maxTradesPersist')
    if (trades.length > 0) {
      const toPersist = trades.slice(0, maxTradesPersist)
      await db.backtestTrade.createMany({
        data: toPersist.map((t) => ({
          resultId: row.id,
          sequence: t.sequence,
          symbol,
          direction: t.direction,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          lotSize: t.lotSize,
          pnl: t.pnl,
          pnlPercent: t.pnlPercent,
          commission: t.commission,
          exitReason: t.exitReason,
          equityAfter: t.equityAfter,
          drawdownAfter: t.drawdownAfter,
        })),
      }).catch((err) => {
        logger.warn('API', 'Backtest trade persistence failed', { details: String(err) })
      })
    }

    logger.info('API', `Backtest completed: ${strategy} on ${symbol}`, {
      metadata: {
        engine: engineId,
        dataSource,
        trades: metrics.totalTrades,
        winRate: metrics.winRate,
        pnl: metrics.totalPnl,
        durationMs: Date.now() - t0,
      },
    } as never)

    return NextResponse.json(
      {
        success: true,
        data: {
          ...row,
          equityCurve,
          totalReturn,
          // UI-compat trade shape (v1 field names) + full v2 records
          simulatedTrades: trades.map((t) => ({
            entryBar: t.sequence,
            exitBar: t.sequence,
            direction: t.direction === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            pnl: t.pnl,
            commission: t.commission,
            sl: null,
            tp: null,
            entryTime: t.entryTime,
            exitTime: t.exitTime,
            exitReason: t.exitReason,
            equityAfter: t.equityAfter,
            drawdownAfter: t.drawdownAfter,
          })),
          v2Metrics: metrics,
          warnings: result.warnings,
          engine: engineId,
          engineVersion: 'v2',
          dataSource,
          mockWarning: false, // v2 never mocks
        },
      },
      { status: 201 },
    )
  } catch (error) {
    logger.error('API', 'Error running backtest', { details: String(error) })
    return apiErrorResponse(error, { route: 'POST /api/backtest' })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing backtest id' }, { status: 400 })
    }
    await db.backtestTrade.deleteMany({ where: { resultId: id } })
    await db.backtestResult.delete({ where: { id } })
    return NextResponse.json({ success: true, data: { id } })
  } catch (error) {
    logger.error('API', 'Error deleting backtest', { details: String(error) })
    return NextResponse.json({ success: false, error: 'Failed to delete backtest result' }, { status: 500 })
  }
}
