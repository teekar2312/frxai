import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    // Get today's DailyPerformance for base balance and daily P&L
    const todayStr = new Date().toISOString().split("T")[0]
    const todayPerf = await db.dailyPerformance.findUnique({
      where: { date: todayStr },
    })

    // Determine base balance from DailyPerformance, fallback to 10000
    let baseBalance = 10000
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

    // Get live trade data from DB for realistic aggregation
    const openTrades = await db.trade.findMany({
      where: { status: "OPEN" },
    })

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const closedToday = await db.trade.findMany({
      where: {
        status: "CLOSED",
        closeTime: { gte: todayStart },
      },
    })

    const allClosed = await db.trade.findMany({
      where: { status: "CLOSED" },
    })

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

    const wins = allClosed.filter((t) => t.pnl > 0).length
    const totalClosed = allClosed.length
    const winRate = totalClosed > 0 ? Math.round((wins / totalClosed) * 10000) / 100 : 0

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
      totalTrades: totalClosed,
      currency: "USD",
      accountNumber: "FX-2024-88421",
    }

    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    console.error("Error fetching account data:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch account data" },
      { status: 500 }
    )
  }
}
