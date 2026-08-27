import { NextRequest, NextResponse } from "next/server"
import { calculatePositionSize, getDailyPerformance, calculateRiskOfRuin } from "@/lib/money-management"
import logger from "@/lib/trading-logger"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get("action")

    // ---- Daily Performance ----
    if (action === "daily-performance") {
      const perf = await getDailyPerformance()
      return NextResponse.json({ success: true, data: perf })
    }

    // ---- Risk of Ruin ----
    if (action === "risk-of-ruin") {
      const closedTrades = await db.trade.findMany({
        where: { status: "CLOSED" },
        orderBy: { closeTime: "desc" },
        take: 100,
      })
      const wins = closedTrades.filter((t) => t.pnl > 0)
      const losses = closedTrades.filter((t) => t.pnl < 0)
      const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 50
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 50
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 25

      const ror = calculateRiskOfRuin({ winRate, avgWin, avgLoss, riskPerTrade: 0.5 })
      return NextResponse.json({
        success: true,
        data: {
          ...ror,
          sampleSize: closedTrades.length,
          winRate: Math.round(winRate * 100) / 100,
          avgWin: Math.round(avgWin * 100) / 100,
          avgLoss: Math.round(avgLoss * 100) / 100,
          rewardRiskRatio: avgLoss > 0 ? Math.round((avgWin / avgLoss) * 100) / 100 : 0,
        },
      })
    }

    // ---- Historical Performance ----
    if (action === "history") {
      const history = await db.dailyPerformance.findMany({
        orderBy: { date: "desc" },
        take: 30,
      })
      return NextResponse.json({ success: true, data: history })
    }

    // ---- Default: return today's performance ----
    const perf = await getDailyPerformance()
    return NextResponse.json({ success: true, data: perf })
  } catch (error) {
    logger.error("MONEY_MANAGEMENT", "Error in money management endpoint", {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to process request" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, symbol, direction, entryPrice, sl, equity, method, fixedDollarRisk } = body

    if (action === "calculate-size") {
      if (!symbol || !entryPrice || !equity) {
        return NextResponse.json(
          { success: false, error: "Missing: symbol, entryPrice, equity" },
          { status: 400 }
        )
      }
      const result = await calculatePositionSize({
        symbol,
        direction: direction || "BUY",
        entryPrice: Number(entryPrice),
        sl: sl ? Number(sl) : null,
        equity: Number(equity),
        method: method || "FIXED_FRACTIONAL",
        fixedDollarRisk: fixedDollarRisk ? Number(fixedDollarRisk) : undefined,
      })
      return NextResponse.json({ success: true, data: result })
    }

    if (action === "risk-of-ruin") {
      const { winRate, avgWin, avgLoss, riskPerTrade } = body
      if (winRate == null || avgWin == null || avgLoss == null) {
        return NextResponse.json(
          { success: false, error: "Missing: winRate, avgWin, avgLoss" },
          { status: 400 }
        )
      }
      const result = calculateRiskOfRuin({
        winRate: Number(winRate),
        avgWin: Number(avgWin),
        avgLoss: Number(avgLoss),
        riskPerTrade: Number(riskPerTrade || 0.5),
      })
      return NextResponse.json({ success: true, data: result })
    }

    return NextResponse.json(
      { success: false, error: "Unknown action. Use: calculate-size, risk-of-ruin" },
      { status: 400 }
    )
  } catch (error) {
    logger.error("MONEY_MANAGEMENT", "Error in money management POST", {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to process request" },
      { status: 500 }
    )
  }
}
