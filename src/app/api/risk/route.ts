import { NextResponse } from "next/server"
import { getRiskSnapshot, logRiskEvent } from "@/lib/risk-engine"
import logger from "@/lib/trading-logger"
import { db } from "@/lib/db"

/**
 * Deep Audit Fix #1: Risk Event Deduplication
 * Prevents flooding the database with duplicate risk events on every poll.
 * Uses a time-window dedup: same eventType within THROTTLE_WINDOW_MS won't create a new event.
 */
const RISK_EVENT_THROTTLE_MS = 60_000 // 60 seconds
const lastRiskEventTime = new Map<string, number>()

async function logThrottledRiskEvent(params: {
  eventType: string
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  message: string
  details?: string
  actionTaken?: string
}) {
  const now = Date.now()
  const lastTime = lastRiskEventTime.get(params.eventType) || 0

  if (now - lastTime < RISK_EVENT_THROTTLE_MS) {
    // Skip - already logged recently
    return
  }

  lastRiskEventTime.set(params.eventType, now)
  await logRiskEvent(params)
}

export async function GET() {
  try {
    const snapshot = await getRiskSnapshot()

    // Auto-generate risk events for critical conditions (throttled)
    if (snapshot.isStopOutWarning) {
      await logThrottledRiskEvent({
        eventType: "STOP_OUT_WARNING",
        severity: "CRITICAL",
        message: `Stop out level reached! Margin level: ${snapshot.marginLevelPercent}%`,
        details: `Equity: $${snapshot.equity}, Margin Used: $${snapshot.marginUsed}, Open Positions: ${snapshot.openPositions}`,
        actionTaken: "NOTIFICATION_SENT",
      })
    } else if (snapshot.isMarginCallWarning) {
      await logThrottledRiskEvent({
        eventType: "MARGIN_CALL_WARNING",
        severity: "HIGH",
        message: `Margin call approaching! Margin level: ${snapshot.marginLevelPercent}%`,
        details: `Equity: $${snapshot.equity}, Margin Used: $${snapshot.marginUsed}`,
        actionTaken: "NOTIFICATION_SENT",
      })
    } else if (snapshot.isDailyLimitReached) {
      await logThrottledRiskEvent({
        eventType: "DAILY_LIMIT_REACHED",
        severity: "HIGH",
        message: `Daily loss limit reached: $${Math.abs(snapshot.dailyPnl).toFixed(2)} (${Math.abs(snapshot.dailyPnlPercent).toFixed(2)}%)`,
        actionTaken: "TRADE_BLOCKED",
      })
    } else if (snapshot.dailyPnlPercent < -1.5) {
      await logThrottledRiskEvent({
        eventType: "DAILY_LIMIT_APPROACHING",
        severity: "MEDIUM",
        message: `Daily loss approaching limit: $${Math.abs(snapshot.dailyPnl).toFixed(2)} / $${snapshot.dailyLossLimit.toFixed(2)}`,
        actionTaken: "NONE",
      })
    }

    // Proactive margin zone events (throttled)
    if (snapshot.proactiveMarginZone === "PROACTIVE_70") {
      await logThrottledRiskEvent({
        eventType: "PROACTIVE_MC_70",
        severity: "MEDIUM",
        message: `Proactive: Margin level at ${snapshot.marginLevelPercent}% (70% warning zone)`,
        details: `Free margin: $${snapshot.freeMargin}, Scaling factor: ${snapshot.scalingFactor}`,
        actionTaken: "NONE",
      })
    } else if (snapshot.proactiveMarginZone === "PROACTIVE_60") {
      await logThrottledRiskEvent({
        eventType: "PROACTIVE_MC_60",
        severity: "HIGH",
        message: `Proactive: Margin level at ${snapshot.marginLevelPercent}% (60% critical zone). Position sizes reduced 50%.`,
        details: `Free margin: $${snapshot.freeMargin}, Scaling factor: ${snapshot.scalingFactor}`,
        actionTaken: "REDUCED_SIZE",
      })
    }

    // Deep Audit: Include recent resolved risk events
    const recentRiskEvents = await db.riskEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    })

    return NextResponse.json({
      success: true,
      data: {
        ...snapshot,
        recentRiskEvents,
      },
    })
  } catch (error) {
    logger.error("RISK_MANAGEMENT", "Failed to generate risk snapshot", {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to fetch risk metrics" },
      { status: 500 }
    )
  }
}
