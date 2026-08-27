import { NextResponse } from "next/server"
import { getRiskSnapshot, logRiskEvent, getRiskConfig } from "@/lib/risk-engine"
import logger from "@/lib/trading-logger"

export async function GET() {
  try {
    const snapshot = await getRiskSnapshot()

    // Check for auto-generating risk events on critical conditions
    if (snapshot.isStopOutWarning) {
      await logRiskEvent({
        eventType: "STOP_OUT_WARNING",
        severity: "CRITICAL",
        message: `Stop out level reached! Margin level: ${snapshot.marginLevelPercent}%`,
        details: `Equity: $${snapshot.equity}, Margin Used: $${snapshot.marginUsed}, Open Positions: ${snapshot.openPositions}`,
        actionTaken: "NOTIFICATION_SENT",
      })
    } else if (snapshot.isMarginCallWarning) {
      await logRiskEvent({
        eventType: "MARGIN_CALL_WARNING",
        severity: "HIGH",
        message: `Margin call approaching! Margin level: ${snapshot.marginLevelPercent}%`,
        details: `Equity: $${snapshot.equity}, Margin Used: $${snapshot.marginUsed}`,
        actionTaken: "NOTIFICATION_SENT",
      })
    } else if (snapshot.isDailyLimitReached) {
      await logRiskEvent({
        eventType: "DAILY_LIMIT_REACHED",
        severity: "HIGH",
        message: `Daily loss limit reached: $${Math.abs(snapshot.dailyPnl).toFixed(2)} (${Math.abs(snapshot.dailyPnlPercent).toFixed(2)}%)`,
        actionTaken: "TRADE_BLOCKED",
      })
    } else if (snapshot.dailyPnlPercent < -1.5) {
      await logRiskEvent({
        eventType: "DAILY_LIMIT_APPROACHING",
        severity: "MEDIUM",
        message: `Daily loss approaching limit: $${Math.abs(snapshot.dailyPnl).toFixed(2)} / $${snapshot.dailyLossLimit.toFixed(2)}`,
        actionTaken: "NONE",
      })
    }

    return NextResponse.json({ success: true, data: snapshot })
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
