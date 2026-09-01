import { NextRequest, NextResponse } from "next/server"
import { calculatePositionSize, getDailyPerformance, calculateRiskOfRuin, calculateDrawdownRecovery, calculateScalingFactor, getExchangeRateRisk } from "@/lib/money-management"
import logger from "@/lib/trading-logger"
import { db } from "@/lib/db"

const VALID_DIRECTIONS = ['BUY', 'SELL']
const VALID_METHODS = ['FIXED_FRACTIONAL', 'KELLY', 'ANTI_MARTINGALE', 'OPTIMAL_F']

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get("action")

    if (action === "daily-performance") {
      const perf = await getDailyPerformance()
      return NextResponse.json({ success: true, data: perf })
    }

    if (action === "risk-of-ruin") {
      const closedTrades = await db.trade.findMany({
        where: { status: "CLOSED" },
        orderBy: { closeTime: "desc" },
        take: 100,
      })

      if (closedTrades.length < 10) {
        return NextResponse.json({
          success: true,
          data: {
            probability: null,
            interpretation: 'Insufficient trade data (need 10+ trades)',
            recommendation: 'Trade at minimum risk until sufficient data is collected',
          },
        })
      }

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

    if (action === "drawdown-recovery") {
      const drawdown = parseFloat(searchParams.get("drawdown") || "10")
      const result = calculateDrawdownRecovery(drawdown)
      return NextResponse.json({ success: true, data: result })
    }

    if (action === "scaling-factor") {
      const factor = await calculateScalingFactor()
      return NextResponse.json({ success: true, data: { scalingFactor: factor } })
    }

    if (action === "exchange-rate-risk") {
      const risk = getExchangeRateRisk()
      return NextResponse.json({ success: true, data: risk })
    }

    if (action === "history") {
      const history = await db.dailyPerformance.findMany({
        orderBy: { date: "desc" },
        take: 30,
      })
      return NextResponse.json({ success: true, data: history })
    }

    // Default: today's performance with extras
    const perf = await getDailyPerformance()
    const factor = await calculateScalingFactor()
    return NextResponse.json({
      success: true,
      data: {
        ...perf,
        scalingFactor: factor,
        exchangeRateRisk: getExchangeRateRisk(),
      },
    })
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
    const { action, symbol, direction, entryPrice, sl, equity, method, fixedDollarRisk, scalingFactor } = body

    if (action === "calculate-size") {
      if (!symbol || !entryPrice || !equity) {
        return NextResponse.json(
          { success: false, error: "Missing: symbol, entryPrice, equity" },
          { status: 400 }
        )
      }

      const resolvedDirection = direction || "BUY"
      if (!VALID_DIRECTIONS.includes(resolvedDirection)) {
        return NextResponse.json({ success: false, error: 'direction must be BUY or SELL' }, { status: 400 })
      }

      const resolvedMethod = method || "FIXED_FRACTIONAL"
      if (!VALID_METHODS.includes(resolvedMethod)) {
        return NextResponse.json({ success: false, error: `method must be one of: ${VALID_METHODS.join(', ')}` }, { status: 400 })
      }

      const entryPriceNum = Number(entryPrice)
      if (!Number.isFinite(entryPriceNum) || entryPriceNum <= 0) {
        return NextResponse.json({ success: false, error: 'entryPrice must be a positive number' }, { status: 400 })
      }

      const result = await calculatePositionSize({
        symbol,
        direction: resolvedDirection,
        entryPrice: entryPriceNum,
        sl: sl ? Number(sl) : null,
        equity: Number(equity),
        method: resolvedMethod,
        fixedDollarRisk: fixedDollarRisk ? Number(fixedDollarRisk) : undefined,
        scalingFactor: scalingFactor ? Number(scalingFactor) : undefined,
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
