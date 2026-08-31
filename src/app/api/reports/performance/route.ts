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

    // Fetch all CLOSED trades in the date range
    const trades = await db.trade.findMany({
      where: {
        status: 'CLOSED',
        closeTime: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { closeTime: 'asc' },
    })

    // Fetch DailyPerformance for the date range
    const startDateStrFmt = startDate.toISOString().slice(0, 10)
    const endDateStrFmt = endDate.toISOString().slice(0, 10)

    const dailyPerf = await db.dailyPerformance.findMany({
      where: {
        date: {
          gte: startDateStrFmt,
          lte: endDateStrFmt,
        },
      },
      orderBy: { date: 'asc' },
    })

    // === Overall metrics ===
    const totalTrades = trades.length
    const winTrades = trades.filter((t) => t.pnl > 0)
    const lossTrades = trades.filter((t) => t.pnl < 0)
    const winRate = totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
    const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0

    const totalWins = winTrades.reduce((sum, t) => sum + t.pnl, 0)
    const totalLosses = Math.abs(lossTrades.reduce((sum, t) => sum + t.pnl, 0))
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0

    const avgWin = winTrades.length > 0 ? totalWins / winTrades.length : 0
    const avgLoss = lossTrades.length > 0 ? totalLosses / lossTrades.length : 0

    // Max drawdown: iterate chronologically, track cumulative PnL and peak
    let peakEquity = 0
    let maxDrawdown = 0
    let runningPnl = 0
    for (const trade of trades) {
      runningPnl += trade.pnl
      if (runningPnl > peakEquity) {
        peakEquity = runningPnl
      }
      const dd = peakEquity - runningPnl
      if (dd > maxDrawdown) {
        maxDrawdown = dd
      }
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
      profitFactor: profitFactor === Infinity ? -1 : Math.round(profitFactor * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
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

    // === Daily P&L time series ===
    const dailyPnl = dailyPerf.map((d) => ({
      date: d.date,
      pnl: Math.round(d.totalPnl * 100) / 100,
      pnlPercent: Math.round(d.pnlPercent * 100) / 100,
      winRate: d.tradesClosed > 0 ? Math.round((d.winTrades / d.tradesClosed) * 10000) / 100 : 0,
      tradesClosed: d.tradesClosed,
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
