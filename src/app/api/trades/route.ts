import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ success: true, data: trades })
  } catch (error) {
    console.error("Error fetching trades:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch trades" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      symbol,
      direction,
      lotSize,
      entryPrice,
      currentPrice,
      sl,
      tp,
      trailingStop,
      trailingDist,
      strategy,
      timeframe,
      marketCond,
      aiConfidence,
      leverage,
    } = body

    if (!symbol || !direction || lotSize == null || entryPrice == null) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: symbol, direction, lotSize, entryPrice" },
        { status: 400 }
      )
    }

    if (!["BUY", "SELL"].includes(direction)) {
      return NextResponse.json(
        { success: false, error: "direction must be BUY or SELL" },
        { status: 400 }
      )
    }

    const lev = leverage || 25
    const price = currentPrice || entryPrice
    const commission = lotSize * 1 // $1 per lot
    const contractValue = price * lotSize * 100000
    const margin = contractValue / lev

    const trade = await db.trade.create({
      data: {
        symbol,
        direction,
        lotSize,
        entryPrice,
        currentPrice: price,
        sl: sl ?? null,
        tp: tp ?? null,
        trailingStop: trailingStop ?? false,
        trailingDist: trailingDist ?? null,
        strategy: strategy ?? null,
        timeframe: timeframe ?? null,
        marketCond: marketCond ?? null,
        aiConfidence: aiConfidence ?? null,
        leverage: lev,
        commission,
        margin,
        pnl: 0,
        pnlPercent: 0,
      },
    })

    return NextResponse.json({ success: true, data: trade }, { status: 201 })
  } catch (error) {
    console.error("Error creating trade:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create trade" },
      { status: 500 }
    )
  }
}
