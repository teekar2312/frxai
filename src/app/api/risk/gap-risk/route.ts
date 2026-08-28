import { NextRequest, NextResponse } from "next/server"
import { assessGapRisk } from "@/lib/risk-engine"

/**
 * GET /api/risk/gap-risk?symbol=BBCA&direction=BUY&entryPrice=9920&volatility=0.015
 * Assesses overnight gap risk for a proposed trade.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get("symbol")
    const direction = searchParams.get("direction")
    const entryPriceStr = searchParams.get("entryPrice")
    const volatilityStr = searchParams.get("volatility")

    if (!symbol || !direction || !entryPriceStr) {
      return NextResponse.json(
        { success: false, error: "Missing required params: symbol, direction, entryPrice" },
        { status: 400 },
      )
    }

    const entryPrice = parseFloat(entryPriceStr)
    if (isNaN(entryPrice) || entryPrice <= 0) {
      return NextResponse.json(
        { success: false, error: "entryPrice must be a positive number" },
        { status: 400 },
      )
    }

    const volatility = volatilityStr ? parseFloat(volatilityStr) : undefined
    if (volatilityStr && (isNaN(volatility!) || volatility! <= 0)) {
      return NextResponse.json(
        { success: false, error: "volatility must be a positive number" },
        { status: 400 },
      )
    }

    // Use a demo equity value (in production, read from account)
    const equity = 10000

    const result = await assessGapRisk({
      symbol,
      direction,
      entryPrice,
      equity,
      volatility,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Gap risk assessment failed" },
      { status: 500 },
    )
  }
}
