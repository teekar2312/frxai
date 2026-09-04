/*
 * Risk Management Engine — PART 11/12: stale-resolver.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 1689-1723): PHASE 3: AUTO-RESOLVE STALE RISK
 * EVENTS (autoResolveStaleRiskEvents).
 */

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"

// ============================================
// PHASE 3: AUTO-RESOLVE STALE RISK EVENTS
// ============================================

/**
 * Auto-resolve risk events that have been unresolved for too long.
 *
 * Finds all RiskEvent where resolved=false AND createdAt < (now - maxAgeMinutes).
 * Sets resolved=true, resolvedAt=now, actionTaken includes "AUTO_RESOLVED".
 * Returns count of resolved events.
 */
export async function autoResolveStaleRiskEvents(maxAgeMinutes: number = 60): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000)

  const now = new Date()

  const result = await db.riskEvent.updateMany({
    where: {
      resolved: false,
      createdAt: { lt: cutoff },
    },
    data: {
      resolved: true,
      resolvedAt: now,
    },
  })

  if (result.count > 0) {
    logger.info("RISK_MANAGEMENT", `Auto-resolved ${result.count} stale risk events (max age: ${maxAgeMinutes}min)`, {
      metadata: { resolvedCount: result.count, maxAgeMinutes },
    })
  }

  return result.count
}
