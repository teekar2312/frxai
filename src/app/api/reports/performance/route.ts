import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const PERIOD_MAP: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
}

const VALID_GROUP_BY = ['symbol', 'strategy', 'session'] as const

function getSessionFromTime(date: Date): string {
  const hours = date.getHours()
  if (hours < 9) return 'PRE_MARKET'
  if (hours < 11) return 'MORNING'
  if (hours < 13) return 'MIDDAY_BREAK'
  if (hours < 15) return 'AFTERNOON'
  return 'AFTER_HOURS'
}

function getGroupKey(trade: { symbol: string; strategy: string | null; openTime: Date }, groupBy: string): string {
  switch (groupBy) {
    case 'symbol':
      return trade.symbol
    case 'strategy':
      return trade.strategy || 'Unknown'
    case 'session':
      return getSessionFromTime(trade.openTime)
    default:
      return trade.symbol
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '30d'
    const groupBy = searchParams.get('groupBy') || 'symbol'
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')

    if (!PERIOD_MAP[period] && !startDateStr) {
      return NextResponse.json(
        { success: false, error: 'Invalid period. Use 7d, 30d, 90d, or 1y' },
        { status: 400 },
      )
    }

    if (!VALID_GROUP_BY.includes(groupBy as typeof VALID_GROUP_BY[number])) {
      return NextResponse.json(
        { success: false, error: 'Invalid groupBy. Use symbol, strategy, or session' },
        { status: 400 },
      )
    }

    // Calculate date range
    let startDate: Date
    const endDate = endDateStr ? new Date(endDateStr) : new Date()

    if (startDateStr) {
      startDate = new Date(startDateStr)
    } else {
      const days = PERIOD_MAP[period]
      startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
      startDate.setHours(0, 0, 0, 0)
    }

    // Fetch all CLOSED trades in the date range (capped to prevent OOM)
    const trades = await db.trade.findMany({
      where: {
        status: 'CLOSED',
        closeTime: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { closeTime: 'asc' },
      take: 50000,
    })

    // Get initial balance before the period for equity-based drawdown
    const prePeriodPerf = await db.dailyPerformance.findFirst({
      where: { date: { lt: startDate.toISOString().slice(0, 10) } },
      orderBy: { date: 'desc' },
    })
    const initialBalance = prePeriodPerf ? prePeriodPerf.endBalance : (trades.length > 0 ? 10000 : 0)

    // === Overall metrics ===
    const totalTrades = trades.length
    const winTrades = trades.filter((t) => t.pnl > 0)
    const lossTrades = trades.filter((t) => t.pnl < 0)
    const winRate = totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
    const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0

    const totalWins = winTrades.reduce((sum, t) => sum + t.pnl, 0)
    const totalLosses = Math.abs(lossTrades.reduce((sum, t) => sum + t.pnl, 0))
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? null : 0

    const avgWin = winTrades.length > 0 ? totalWins / winTrades.length : 0
    const avgLoss = lossTrades.length > 0 ? totalLosses / lossTrades.length : 0

    // Max drawdown: compute from equity curve with percentage
    let peakEquity = initialBalance
    let maxDrawdown = 0
    let maxDrawdownAmount = 0
    let runningEquity = initialBalance
    for (const trade of trades) {
      runningEquity += trade.pnl
      if (runningEquity > peakEquity) peakEquity = runningEquity
      const dd = peakEquity > 0 ? ((peakEquity - runningEquity) / peakEquity) * 100 : 0
      const ddAmount = peakEquity - runningEquity
      if (dd > maxDrawdown) maxDrawdown = dd
      if (ddAmount > maxDrawdownAmount) maxDrawdownAmount = ddAmount
    }

    // Avg hold time in hours
    const holdTimes = trades
      .filter((t) => t.closeTime && t.openTime)
      .map((t) => (t.closeTime!.getTime() - t.openTime.getTime()) / (1000 * 60 * 60))
    const avgHoldHours = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0

    // Total commission and slippage
    const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0)
    const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0)

    const overall = {
      totalTrades,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgPnl: Math.round(avgPnl * 100) / 100,
      profitFactor: profitFactor === null ? null : Math.round(profitFactor * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxDrawdownAmount: Math.round(maxDrawdownAmount * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      avgHoldHours: Math.round(avgHoldHours * 100) / 100,
      totalCommission: Math.round(totalCommission * 100) / 100,
      totalSlippage: Math.round(totalSlippage * 100) / 100,
    }

    // === Grouped breakdown ===
    const groupMap = new Map<string, typeof trades>()
    for (const trade of trades) {
      const key = getGroupKey(trade, groupBy)
      const arr = groupMap.get(key) || []
      arr.push(trade)
      groupMap.set(key, arr)
    }

    const byGroup = Array.from(groupMap.entries())
      .map(([group, groupTrades]) => {
        const gTotal = groupTrades.length
        const gWins = groupTrades.filter((t) => t.pnl > 0).length
        const gWinRate = gTotal > 0 ? (gWins / gTotal) * 100 : 0
        const gTotalPnl = groupTrades.reduce((sum, t) => sum + t.pnl, 0)
        const gAvgPnl = gTotal > 0 ? gTotalPnl / gTotal : 0
        const gBestTrade = Math.max(...groupTrades.map((t) => t.pnl))
        const gWorstTrade = Math.min(...groupTrades.map((t) => t.pnl))

        return {
          group,
          totalTrades: gTotal,
          winRate: Math.round(gWinRate * 100) / 100,
          totalPnl: Math.round(gTotalPnl * 100) / 100,
          avgPnl: Math.round(gAvgPnl * 100) / 100,
          bestTrade: Math.round(gBestTrade * 100) / 100,
          worstTrade: Math.round(gWorstTrade * 100) / 100,
        }
      })
      .sort((a, b) => b.totalPnl - a.totalPnl)

    // === Daily P&L time series (computed from trades for consistency) ===
    const dailyMap = new Map<string, { pnl: number; wins: number; total: number }>()
    for (const trade of trades) {
      const day = trade.closeTime.toISOString().slice(0, 10)
      const entry = dailyMap.get(day) || { pnl: 0, wins: 0, total: 0 }
      entry.pnl += trade.pnl
      entry.total++
      if (trade.pnl > 0) entry.wins++
      dailyMap.set(day, entry)
    }

    const dailyPnl = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date,
        pnl: Math.round(d.pnl * 100) / 100,
        winRate: d.total > 0 ? Math.round((d.wins / d.total) * 10000) / 100 : 0,
        tradesClosed: d.total,
      }))

    return NextResponse.json({
      success: true,
      data: {
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        overall,
        byGroup,
        dailyPnl,
      },
    })
  } catch (error) {
    console.error('Performance report error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to generate performance report' },
      { status: 500 },
    )
  }
}
