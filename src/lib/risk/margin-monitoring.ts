/*
 * Risk Management Engine — PART 5/12: margin-monitoring.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 297-416): Core — proactive margin monitoring
 * (determineProactiveMarginZone, processProactiveMarginMonitoring).
 */

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"
import { logRiskEvent } from "./events"
import type { ProactiveMarginZone, RiskConfigData } from "./types"

/**
 * Determine the proactive margin zone based on margin level percentage.
 * Zone 1: PROACTIVE at 70% - warning, log event, continue trading
 * Zone 2: PROACTIVE at 60% - strong warning, reduce new position sizes by 50%, log event
 * Zone 3: MARGIN CALL at 50% - critical, block new trades
 * Zone 4: STOP OUT at 20% - fatal, emergency close all positions
 */
export function determineProactiveMarginZone(
  marginLevelPercent: number,
  config: RiskConfigData,
): ProactiveMarginZone {
  // When no margin is used, we're in SAFE zone
  if (marginLevelPercent === 0) {
    return "SAFE"
  }
  if (marginLevelPercent <= config.stopOutLevel) {
    return "STOP_OUT"
  }
  if (marginLevelPercent <= config.marginCallLevel) {
    return "MARGIN_CALL"
  }
  if (config.proactiveMcLevel60 && marginLevelPercent <= 60) {
    return "PROACTIVE_60"
  }
  if (config.proactiveMcLevel70 && marginLevelPercent <= 70) {
    return "PROACTIVE_70"
  }
  return "SAFE"
}

/**
 * Process proactive margin monitoring: log events for zone transitions.
 * Returns the zone and any actions taken.
 */
export async function processProactiveMarginMonitoring(
  marginLevelPercent: number,
  config: RiskConfigData,
): Promise<{ zone: ProactiveMarginZone; actionTaken: string }> {
  const zone = determineProactiveMarginZone(marginLevelPercent, config)
  let actionTaken = "NONE"

  // Check if we recently logged the same zone to avoid spam
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

  if (zone === "PROACTIVE_70") {
    const recent = await db.riskEvent.findFirst({
      where: {
        eventType: "PROACTIVE_MC_70",
        createdAt: { gte: fiveMinutesAgo },
      },
    })
    if (!recent) {
      await logRiskEvent({
        eventType: "PROACTIVE_MC_70",
        severity: "MEDIUM",
        message: `Proactive margin warning: margin level at ${marginLevelPercent.toFixed(1)}% (zone 70%)`,
        details: `Margin level has dropped below 70% threshold. Current level: ${marginLevelPercent.toFixed(1)}%. Trading continues but monitor closely.`,
        actionTaken: "NOTIFICATION_SENT",
      })
      logger.warn("RISK_MANAGEMENT", `Proactive MC 70% triggered: margin level at ${marginLevelPercent.toFixed(1)}%`)
    }
    actionTaken = "NOTIFICATION_SENT"
  } else if (zone === "PROACTIVE_60") {
    const recent = await db.riskEvent.findFirst({
      where: {
        eventType: "PROACTIVE_MC_60",
        createdAt: { gte: fiveMinutesAgo },
      },
    })
    if (!recent) {
      await logRiskEvent({
        eventType: "PROACTIVE_MC_60",
        severity: "HIGH",
        message: `Proactive margin strong warning: margin level at ${marginLevelPercent.toFixed(1)}% (zone 60%)`,
        details: `Margin level has dropped below 60% threshold. Current level: ${marginLevelPercent.toFixed(1)}%. New position sizes will be reduced by 50%.`,
        actionTaken: "REDUCED_SIZE",
      })
      logger.warn("RISK_MANAGEMENT", `Proactive MC 60% triggered: margin level at ${marginLevelPercent.toFixed(1)}%, sizes reduced 50%`)
    }
    actionTaken = "REDUCED_SIZE"
  } else if (zone === "MARGIN_CALL") {
    const recent = await db.riskEvent.findFirst({
      where: {
        eventType: "MARGIN_CALL_WARNING",
        createdAt: { gte: fiveMinutesAgo },
      },
    })
    if (!recent) {
      await logRiskEvent({
        eventType: "MARGIN_CALL_WARNING",
        severity: "CRITICAL",
        message: `Margin call level reached: margin level at ${marginLevelPercent.toFixed(1)}% (threshold: ${config.marginCallLevel}%)`,
        details: `Margin level has reached margin call threshold. All new trades blocked. Monitor for stop out.`,
        actionTaken: "TRADE_BLOCKED",
      })
      logger.critical("RISK_MANAGEMENT", `Margin call at ${marginLevelPercent.toFixed(1)}%: new trades blocked`)
    }
    actionTaken = "TRADE_BLOCKED"
  } else if (zone === "STOP_OUT") {
    const recent = await db.riskEvent.findFirst({
      where: {
        eventType: "STOP_OUT_WARNING",
        createdAt: { gte: fiveMinutesAgo },
      },
    })
    if (!recent) {
      await logRiskEvent({
        eventType: "STOP_OUT_WARNING",
        severity: "CRITICAL",
        message: `STOP OUT level reached: margin level at ${marginLevelPercent.toFixed(1)}% (threshold: ${config.stopOutLevel}%)`,
        details: `Margin level has reached stop out threshold. Emergency: all positions should be closed immediately.`,
        actionTaken: "ALL_POSITIONS_CLOSED",
      })
      logger.critical("RISK_MANAGEMENT", `STOP OUT at ${marginLevelPercent.toFixed(1)}%: emergency close all positions`)
    }
    actionTaken = "ALL_POSITIONS_CLOSED"
  }

  return { zone, actionTaken }
}
