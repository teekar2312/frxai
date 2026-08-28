import { NextRequest, NextResponse } from "next/server"
import { processPriceUpdate } from "@/lib/trade-execution-engine"

/**
 * POST /api/execution/price-update
 * Receives a map of symbol→price and processes the full pipeline:
 * trailing stops → SL/TP triggers → partial close triggers
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prices } = body

    if (!prices || typeof prices !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Missing "prices" object in request body' },
        { status: 400 },
      )
    }

    const priceMap = new Map<string, number>(
      Object.entries(prices).map(([sym, price]) => [sym, Number(price)])
    )

    const result = await processPriceUpdate(priceMap)

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Error processing price update:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process price update' },
      { status: 500 },
    )
  }
}