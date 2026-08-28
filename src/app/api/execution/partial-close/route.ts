import { NextRequest, NextResponse } from "next/server"
import { executePartialClose, calculatePartialCloseLevels } from "@/lib/trade-execution-engine"
import { db } from "@/lib/db"

/**
 * GET /api/execution/partial-close?tradeId=xxx
 * Returns the calculated partial close levels for a trade.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const tradeId = searchParams.get('tradeId')

    if (!tradeId) {
      return NextResponse.json(
        { success: false, error: 'Missing tradeId parameter' },
        { status: 400 },
      )
    }

    const trade = await db.trade.findUnique({ where: { id: tradeId } })
    if (!trade) {
      return NextResponse.json(
        { success: false, error: 'Trade not found' },
        { status: 404 },
      )
    }

    const levels = calculatePartialCloseLevels(trade)
    return NextResponse.json({ success: true, data: { tradeId, levels } })
  } catch (error) {
    console.error('Error calculating partial close levels:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to calculate partial close levels' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/execution/partial-close
 * Execute a partial close on a trade.
 * Body: { tradeId: string, closePercentage: number, reason?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, closePercentage, reason } = body

    if (!tradeId || closePercentage == null) {
      return NextResponse.json(
        { success: false, error: 'Missing tradeId or closePercentage' },
        { status: 400 },
      )
    }

    if (closePercentage <= 0 || closePercentage > 100) {
      return NextResponse.json(
        { success: false, error: 'closePercentage must be between 0 and 100' },
        { status: 400 },
      )
    }

    const result = await executePartialClose(tradeId, closePercentage, reason)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 422 },
      )
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Error executing partial close:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to execute partial close' },
      { status: 500 },
    )
  }
}