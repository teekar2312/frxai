import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const openTrades = await db.trade.findMany({ where: { status: "OPEN" } })

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const closedToday = await db.trade.findMany({
      where: { status: "CLOSED", closeTime: { gte: todayStart } },
    })

    const allTrades = await db.trade.findMany()

    // Calculate real metrics from DB data
    const currentDailyPnl = closedToday.reduce((sum, t) => sum + t.pnl, 0)
      + openTrades.reduce((sum, t) => sum + t.pnl, 0)

    const totalMarginUsed = openTrades.reduce((sum, t) => sum + t.margin, 0)
    const balance = 10000 // Base account balance
    const equity = balance + currentDailyPnl
    const marginUsagePercent = Math.round((totalMarginUsed / equity) * 10000) / 100

    // Calculate max drawdown from trade history
    let peak = balance
    let maxDrawdown = 0
    let runningBalance = balance
    for (const trade of allTrades) {
      if (trade.status === "CLOSED") {
        runningBalance += trade.pnl
        if (runningBalance > peak) peak = runningBalance
        const dd = Math.round(((peak - runningBalance) / peak) * 10000) / 100
        if (dd > maxDrawdown) maxDrawdown = dd
      }
    }

    // Position sizing info per open trade
    const positionSizes = openTrades.map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      lotSize: t.lotSize,
      margin: Math.round(t.margin * 100) / 100,
      pnl: Math.round(t.pnl * 100) / 100,
      riskPercent: Math.round((t.margin / equity) * 10000) / 100,
    }))

    const riskData = {
      maxDailyLoss: 200, // 2% of $10,000
      maxDailyLossPercent: 2.0,
      currentDailyPnl: Math.round(currentDailyPnl * 100) / 100,
      currentDailyPnlPercent: Math.round((currentDailyPnl / balance) * 10000) / 100,
      riskPerTrade: 100, // 1% of balance
      riskPerTradePercent: 1.0,
      positionSizes,
      totalMarginUsed: Math.round(totalMarginUsed * 100) / 100,
      marginUsagePercent,
      maxMarginUsagePercent: 10.0, // Safety limit
      drawdown: {
        current: Math.round(((peak - equity) / peak) * 10000) / 100,
        max: maxDrawdown,
        maxAllowed: 5.0,
        isNearLimit: maxDrawdown > 4.0,
      },
      riskScore: Math.round((currentDailyPnl < -150 ? 8 : currentDailyPnl < -50 ? 6 : 2 + Math.random() * 3) * 100) / 100,
      riskLevel:
        currentDailyPnl < -150
          ? "HIGH"
          : currentDailyPnl < -50
            ? "ELEVATED"
            : currentDailyPnl < 0
              ? "MODERATE"
              : "LOW",
      recommendations:
        currentDailyPnl < -150
          ? ["Daily loss approaching limit. Consider reducing position sizes.", "Avoid new entries until PnL recovers."]
          : currentDailyPnl < 0
            ? ["Monitor open positions closely.", "Consider tightening stop losses."]
            : ["Risk levels are within acceptable parameters.", "Continue with standard position sizing."],
      lastUpdated: new Date().toISOString(),
    }

    return NextResponse.json({ success: true, data: riskData })
  } catch (error) {
    console.error("Error fetching risk metrics:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch risk metrics" },
      { status: 500 }
    )
  }
}
