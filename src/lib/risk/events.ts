/*
 * Risk Management Engine — PART 4/12: events.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 1401-1454): Core — logRiskEvent (risk event
 * persistence + v2 HIGH/CRITICAL notification dispatch via dynamic import).
 */

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"

/**
 * Log a risk event to the database.
 */
export async function logRiskEvent(params: {
  eventType: string
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  message: string
  details?: string
  actionTaken?: string
}): Promise<void> {
  try {
    await db.riskEvent.create({
      data: {
        eventType: params.eventType,
        severity: params.severity,
        message: params.message,
        details: params.details || null,
        actionTaken: params.actionTaken || null,
      },
    })
    logger.warn("RISK_MANAGEMENT", params.message, {
      details: params.details,
      metadata: {
        eventType: params.eventType,
        severity: params.severity,
        actionTaken: params.actionTaken,
      },
    })

    // v2: dispatch Telegram/Discord notification for HIGH/CRITICAL risk events
    if (params.severity === "HIGH" || params.severity === "CRITICAL") {
      try {
        const { notifyAsync } = await import("@/lib/notifier")
        notifyAsync({
          eventType: "RISK_EVENT",
          title: `Risk event: ${params.eventType}`,
          body: params.message,
          severity: params.severity === "CRITICAL" ? "CRITICAL" : "ERROR",
          fields: {
            event_type: params.eventType,
            severity: params.severity,
            action_taken: params.actionTaken ?? "NONE",
          },
        })
      } catch {
        // Notification dispatch must never break risk logging
      }
    }
  } catch (err) {
    logger.error("RISK_MANAGEMENT", "Failed to log risk event", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }
}
