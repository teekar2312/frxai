import { NextResponse } from "next/server"
import { getSessionState, checkAndRecordTransition, getTodaySessionPerformance, getRecentSessionEvents } from "@/lib/session-manager"
import logger from "@/lib/trading-logger"

/**
 * GET /api/sessions
 * Returns complete session state (IDX + Forex) with performance data.
 * Replaces the old hardcoded implementation.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const include = searchParams.get('include')

    // Check for and record any phase transition
    await checkAndRecordTransition()

    // Get full session state
    const sessionState = getSessionState()

    // Optionally include performance data and recent events
    let sessionPerformance = null
    let recentEvents = null

    if (include && (include.includes('performance') || include === 'all')) {
      sessionPerformance = await getTodaySessionPerformance()
    }

    if (include && (include.includes('events') || include === 'all')) {
      recentEvents = await getRecentSessionEvents(10)
    }

    return NextResponse.json({
      success: true,
      data: {
        // IDX session data
        idx: {
          phase: sessionState.idxForePhase,
          subSession: sessionState.idxSubSession,
          isOpen: sessionState.idxIsOpen,
          sessionName: sessionState.idxSessionName,
          timeToNextPhase: sessionState.timeToNextPhase,
          nextPhase: sessionState.nextPhase,
        },
        // Forex sessions (same data the old API returned)
        currentTime: sessionState.currentUtcTime,
        utcHour: sessionState.utcHour,
        isWeekend: sessionState.isWeekend,
        sessions: sessionState.forexSessions,
        overlaps: sessionState.overlaps,
        activeSessions: sessionState.activeForexSessions,
        activeOverlaps: sessionState.activeOverlaps,
        recommendation: sessionState.recommendation,
        // Phase 5: session performance
        ...(sessionPerformance ? { sessionPerformance } : {}),
        ...(recentEvents ? { recentEvents } : {}),
      },
    })
  } catch (error) {
    logger.error('API', 'Error fetching sessions', { details: String(error) })
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sessions' },
      { status: 500 }
    )
  }
}