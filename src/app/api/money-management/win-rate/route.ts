import { NextResponse } from 'next/server'
import { calculateWinRateAdjustment } from '@/lib/money-management'
import logger from '@/lib/trading-logger'

export async function GET() {
  try {
    const result = await calculateWinRateAdjustment()
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    logger.error('MONEY_MANAGEMENT', 'Error calculating win rate adjustment', {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: 'Failed to calculate win rate adjustment' },
      { status: 500 },
    )
  }
}
