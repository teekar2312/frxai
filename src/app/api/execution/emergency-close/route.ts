import { NextRequest, NextResponse } from "next/server"
import { emergencyCloseAll } from "@/lib/trade-execution-engine"

/**
 * POST /api/execution/emergency-close
 * Emergency close all open positions.
 * Body: { reason?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { reason } = body

    const result = await emergencyCloseAll(reason || 'MANUAL_EMERGENCY')

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Error in emergency close:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to emergency close' },
      { status: 500 },
    )
  }
}