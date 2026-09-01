import { NextRequest, NextResponse } from "next/server"
import { processPriceUpdate } from "@/lib/trade-execution-engine"

/**
 * POST /api/execution/price-update
 * Receives a map of symbol→price and processes the full pipeline:
 * trailing stops → SL/TP triggers → partial close triggers → price alert evaluation
 * 
 * NOTE: `previousPricesMap` is in-memory and resets on server restart.
 * CROSS_UP/CROSS_DOWN alerts will not fire on the first price update after restart
 * because there are no previous prices to compare against. This is acceptable
 * because the alerts will be evaluated on subsequent price updates.
 */

let previousPricesMap: Map<string, number> = new Map()

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

    // Validate all price values are finite positive numbers
    const entries = Object.entries(prices).map(([sym, price]) => [sym, Number(price)] as const)
    if (entries.some(([, p]) => !Number.isFinite(p) || p <= 0)) {
      return NextResponse.json(
        { success: false, error: 'All price values must be finite positive numbers' },
        { status: 400 },
      )
    }
    const priceMap = new Map(entries)

    const result = await processPriceUpdate(priceMap, previousPricesMap)

    // Save current prices as previous for next call (after pipeline so crossing detection works)
    previousPricesMap = new Map(priceMap)

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        alertsTriggered: result.triggeredAlerts.length,
      },
    })
  } catch (error) {
    console.error('Error processing price update:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process price update' },
      { status: 500 },
    )
  }
}