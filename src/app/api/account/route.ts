import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"

export async function GET() {
  try {
    // Get today's DailyPerformance for base balance and daily P&L (WIB timezone)
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
    const todayPerf = await db.dailyPerformance.findUnique({
      where: { date: todayStr },
    })

    // Determine base balance from DailyPerformance; null signals no real data yet
    let baseBalance: number | null = null
    if (todayPerf) {
      baseBalance = todayPerf.startBalance
    } else {
      // Try to get the most recent performance record for the running balance
      const lastPerf = await db.dailyPerformance.findFirst({
        orderBy: { date: "desc" },
      })
      if (lastPerf) {
        baseBalance = lastPerf.endBalance
      }
    }
    const hasRealData = baseBalance !== null
    if (baseBalance === null) baseBalance = 0

    // Get live trade data from DB for realistic aggregation
    const openTrades = await db.trade.findMany({
      where: { status: "OPEN" },
    })

    // WIB midnight = 00:00 WIB = 17:00 UTC previous day
    const todayStart = new Date(todayStr + 'T00:00:00+07:00')

    const closedToday = await db.trade.findMany({
      where: {
        status: "CLOSED",
        closeTime: { gte: todayStart },
      },
    })

    // Lightweight count queries instead of loading all closed trades into memory
    const [totalClosedCount, winCount, todayWins, todayTotal] = await Promise.all([
      db.trade.count({ where: { status: "CLOSED" } }),
      db.trade.count({ where: { status: "CLOSED", pnl: { gt: 0 } } }),
      db.trade.count({ where: { status: "CLOSED", pnl: { gt: 0 }, closeTime: { gte: todayStart } } }),
      db.trade.count({ where: { status: "CLOSED", closeTime: { gte: todayStart } } }),
    ])
    const winRate = totalClosedCount > 0 ? Math.round((winCount / totalClosedCount) * 10000) / 100 : 0
    const winRateToday = todayTotal > 0 ? Math.round((todayWins / todayTotal) * 10000) / 100 : 0

    // Calculate totals from real data
    const totalOpenPnl = openTrades.reduce((sum, t) => sum + t.pnl, 0)
    const totalMarginUsed = openTrades.reduce((sum, t) => sum + t.margin, 0)
    const totalCommission = openTrades.reduce((sum, t) => sum + t.commission, 0)

    // Daily P&L: prefer DailyPerformance if available, otherwise compute from trades
    let dailyPnl: number
    if (todayPerf) {
      dailyPnl = todayPerf.totalPnl
    } else {
      const dailyClosedPnl = closedToday.reduce((sum, t) => sum + t.pnl, 0)
      dailyPnl = Math.round((totalOpenPnl + dailyClosedPnl - totalCommission) * 100) / 100
    }

    const totalTradesToday = closedToday.length + openTrades.length

    // Account calculations
    const currentBalance = Math.round(baseBalance * 100) / 100
    const equity = Math.round((currentBalance + totalOpenPnl) * 100) / 100
    const freeMargin = Math.max(0, Math.round((equity - totalMarginUsed) * 100) / 100)
    const marginLevel = totalMarginUsed > 0 ? Math.round((equity / totalMarginUsed) * 10000) / 100 : 0

    const account = {
      broker: "FINEX Indonesia",
      accountType: "Real",
      balance: currentBalance,
      equity,
      marginUsed: Math.round(totalMarginUsed * 100) / 100,
      freeMargin,
      marginLevel,
      leverage: "1:25",
      spread: "from 0.5 pip",
      commission: "$1/lot",
      dailyPnl,
      dailyPnlPercent: currentBalance > 0 ? Math.round((dailyPnl / currentBalance) * 10000) / 100 : 0,
      openPositions: openTrades.length,
      totalTradesToday,
      winRate,
      winRateToday,
      hasRealData,
      totalTrades: totalClosedCount,
      currency: "USD",
      accountNumber: "FX-2024-88421",
    }

    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    logger.error('API', 'Error fetching account data', { details: String(error) })
    return NextResponse.json(
      { success: false, error: "Failed to fetch account data" },
      { status: 500 }
    )
  }
}
