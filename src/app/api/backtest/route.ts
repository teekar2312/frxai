import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const results = await db.backtestResult.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    })
    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    console.error("Error fetching backtest results:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch backtest results" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { symbol, strategy, timeframe, startDate, endDate, initialCapital, config } = body

    if (!symbol || !strategy || !timeframe) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: symbol, strategy, timeframe" },
        { status: 400 }
      )
    }

    const capital = initialCapital ?? 10000
    const start = startDate ? new Date(startDate) : new Date("2024-01-01")
    const end = endDate ? new Date(endDate) : new Date()

    // Generate realistic mock backtest results
    const totalTrades = Math.floor(80 + Math.random() * 220)
    const winRate = Math.round((42 + Math.random() * 23) * 100) / 100
    const winTrades = Math.round(totalTrades * (winRate / 100))
    const lossTrades = totalTrades - winTrades

    const avgWin = Math.round((30 + Math.random() * 120) * 100) / 100
    const avgLoss = Math.round((15 + Math.random() * 60) * 100) / 100
    const profitFactor = Math.round(((winTrades * avgWin) / Math.max(lossTrades * avgLoss, 0.01)) * 100) / 100

    const grossProfit = winTrades * avgWin
    const grossLoss = lossTrades * avgLoss
    const netProfit = grossProfit - grossLoss
    const finalCapital = Math.round((capital + netProfit) * 100) / 100
    const totalReturn = Math.round((netProfit / capital) * 10000) / 100

    const maxDrawdown = Math.round((5 + Math.random() * 20) * 100) / 100
    const sharpeRatio = Math.round((-0.5 + Math.random() * 3.5) * 100) / 100

    const configStr = config ? JSON.stringify(config) : JSON.stringify({ riskPerTrade: 2, maxPositions: 3 })

    const result = await db.backtestResult.create({
      data: {
        name: `${strategy} - ${symbol} (${timeframe})`,
        symbol,
        strategy,
        timeframe,
        startDate: start,
        endDate: end,
        initialCapital: capital,
        finalCapital,
        totalTrades,
        winTrades,
        lossTrades,
        winRate,
        maxDrawdown,
        sharpeRatio,
        profitFactor,
        avgWin,
        avgLoss,
        totalPnl: netProfit,
        config: configStr,
      },
    })

    // Build equity curve mock data (array of {date, equity} points)
    const daysDiff = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
    const equityCurve: { date: string; equity: number }[] = []
    let equity = capital
    for (let i = 0; i <= Math.min(daysDiff, 365); i++) {
      equity += (netProfit / Math.min(daysDiff, 365)) * (0.8 + Math.random() * 0.4)
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
      equityCurve.push({
        date: d.toISOString().split("T")[0],
        equity: Math.round(equity * 100) / 100,
      })
    }

    return NextResponse.json(
      { success: true, data: { ...result, equityCurve, totalReturn } },
      { status: 201 }
    )
  } catch (error) {
    console.error("Error running backtest:", error)
    return NextResponse.json(
      { success: false, error: "Failed to run backtest" },
      { status: 500 }
    )
  }
}
