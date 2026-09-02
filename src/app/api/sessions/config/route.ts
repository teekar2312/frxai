import { NextResponse } from 'next/server'
import {
  getSessionTradingConfig,
  updateSessionTradingConfig,
  getActiveOverlapSessions,
} from '@/lib/session-manager'
import logger from '@/lib/trading-logger'

/**
 * GET /api/sessions/config
 * Returns the current session trading configuration with active overlap status.
 */
export async function GET() {
  try {
    const config = await getSessionTradingConfig()
    const activeOverlaps = await getActiveOverlapSessions()

    return NextResponse.json({
      success: true,
      data: {
        config,
        activeOverlaps,
      },
    })
  } catch (error) {
    logger.error('API', 'Error fetching session config', { details: String(error) })
    return NextResponse.json(
      { success: false, error: 'Failed to fetch session config' },
      { status: 500 },
    )
  }
}

/**
 * PUT /api/sessions/config
 * Update session trading configuration (enable/disable specific sessions/overlaps).
 *
 * Body:
 * {
 *   idxSessions?: Array<{ key: string; enabled: boolean }>,
 *   forexOverlaps?: Array<{ key: string; enabled: boolean }>
 * }
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { idxSessions, forexOverlaps } = body

    // Validate input structure
    if (idxSessions && !Array.isArray(idxSessions)) {
      return NextResponse.json(
        { success: false, error: 'idxSessions must be an array' },
        { status: 400 },
      )
    }
    if (forexOverlaps && !Array.isArray(forexOverlaps)) {
      return NextResponse.json(
        { success: false, error: 'forexOverlaps must be an array' },
        { status: 400 },
      )
    }

    // Validate each item has key and enabled
    for (const item of idxSessions ?? []) {
      if (typeof item.key !== 'string' || typeof item.enabled !== 'boolean') {
        return NextResponse.json(
          { success: false, error: 'Each idxSession must have { key: string, enabled: boolean }' },
          { status: 400 },
        )
      }
    }
    for (const item of forexOverlaps ?? []) {
      if (typeof item.key !== 'string' || typeof item.enabled !== 'boolean') {
        return NextResponse.json(
          { success: false, error: 'Each forexOverlap must have { key: string, enabled: boolean }' },
          { status: 400 },
        )
      }
    }

    const updated = await updateSessionTradingConfig({ idxSessions, forexOverlaps })

    return NextResponse.json({
      success: true,
      data: updated,
    })
  } catch (error) {
    logger.error('API', 'Error updating session config', { details: String(error) })
    return NextResponse.json(
      { success: false, error: 'Failed to update session config' },
      { status: 500 },
    )
  }
}
