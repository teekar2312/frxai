import { NextRequest, NextResponse } from "next/server"
import { emergencyCloseAll } from "@/lib/trade-execution-engine"
import logger from "@/lib/trading-logger"
import { apiErrorResponse } from '@/lib/api-errors'

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
    logger.error('API', 'Error in emergency close', { details: String(error) })
    return apiErrorResponse(error, { route: 'POST /api/execution/emergency-close' })
  }
}