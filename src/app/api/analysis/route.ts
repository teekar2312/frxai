import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get("symbol")
    const limit = parseInt(searchParams.get("limit") ?? "10")

    const where: Record<string, unknown> = {}
    if (symbol) where.symbol = symbol

    const analyses = await db.aiAnalysis.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 50),
    })

    return NextResponse.json({ success: true, data: analyses })
  } catch (error) {
    console.error("Error fetching analysis:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch analysis" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { symbol, timeframe } = body

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Missing required field: symbol" },
        { status: 400 }
      )
    }

    const tf = timeframe ?? "H1"

    // Generate realistic mock AI analysis
    const conditions = ["TRENDING", "RANGE_BOUND", "HIGH_VOLATILITY", "LOW_VOLATILITY"]
    const directions = ["UP", "DOWN", "SIDEWAYS"]
    const marketCond = conditions[Math.floor(Math.random() * conditions.length)]
    const trendDir = directions[Math.floor(Math.random() * directions.length)]
    const confidence = Math.round((65 + Math.random() * 30) * 100) / 100
    const volatility = Math.round((0.5 + Math.random() * 3.5) * 100) / 100

    const volumeAnalysis =
      Math.random() > 0.5
        ? "Volume is above average, supporting current price movement. Institutional activity detected in recent sessions."
        : "Volume is below average, suggesting reduced market participation. Wait for volume confirmation before entry."

    const sentiment =
      trendDir === "UP"
        ? "BULLISH"
        : trendDir === "DOWN"
          ? "BEARISH"
          : "NEUTRAL"

    const recommendations = [
      {
        action: trendDir === "UP" ? "BUY" : trendDir === "DOWN" ? "SELL" : "HOLD",
        entry: Math.round((9000 + Math.random() * 2000) * 100) / 100,
        sl: Math.round((8500 + Math.random() * 1500) * 100) / 100,
        tp: Math.round((9500 + Math.random() * 2500) * 100) / 100,
        confidence: Math.round((confidence - 5 + Math.random() * 10) * 100) / 100,
        reason: `${marketCond} market with ${trendDir.toLowerCase()} bias on ${tf} timeframe`,
      },
    ]

    const factors = [
      {
        name: "Trend Strength",
        value: Math.round((0.3 + Math.random() * 0.7) * 100) / 100,
        impact: trendDir === "SIDEWAYS" ? "NEUTRAL" : "POSITIVE",
      },
      {
        name: "Volume Profile",
        value: Math.round((0.4 + Math.random() * 0.6) * 100) / 100,
        impact: Math.random() > 0.5 ? "POSITIVE" : "NEUTRAL",
      },
      {
        name: "Momentum",
        value: Math.round((0.2 + Math.random() * 0.8) * 100) / 100,
        impact: Math.random() > 0.4 ? "POSITIVE" : "NEGATIVE",
      },
      {
        name: "Support/Resistance",
        value: Math.round((0.5 + Math.random() * 0.5) * 100) / 100,
        impact: "NEUTRAL",
      },
      {
        name: "Market Sentiment",
        value: Math.round((0.3 + Math.random() * 0.7) * 100) / 100,
        impact: sentiment === "BULLISH" ? "POSITIVE" : sentiment === "BEARISH" ? "NEGATIVE" : "NEUTRAL",
      },
    ]

    const analysis = await db.aiAnalysis.create({
      data: {
        symbol,
        marketCondition: marketCond,
        confidence,
        timeframe: tf,
        trendDirection: trendDir,
        volatility,
        volumeAnalysis,
        sentiment,
        recommendations: JSON.stringify(recommendations),
        factors: JSON.stringify(factors),
      },
    })

    return NextResponse.json({ success: true, data: analysis }, { status: 201 })
  } catch (error) {
    console.error("Error creating analysis:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create analysis" },
      { status: 500 }
    )
  }
}
