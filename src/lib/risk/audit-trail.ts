/*
 * Risk Management Engine — PART 12/12: audit-trail.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 1788-1835): PHASE 3: AUDIT TRAIL LOGGER
 * (logAuditTrail).
 */

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"

// ============================================
// PHASE 3: AUDIT TRAIL LOGGER
// ============================================

/**
 * Log an audit trail entry for configuration changes and system actions.
 *
 * Creates an AuditTrail record in the database and logs to the trading logger at INFO level.
 */
export async function logAuditTrail(params: {
  action: string
  category: string
  fieldName?: string
  oldValue?: string
  newValue?: string
  reason?: string
  performedBy?: string
}): Promise<void> {
  try {
    await db.auditTrail.create({
      data: {
        action: params.action,
        category: params.category,
        fieldName: params.fieldName || null,
        oldValue: params.oldValue || null,
        newValue: params.newValue || null,
        reason: params.reason || null,
        performedBy: params.performedBy || "SYSTEM",
      },
    })

    logger.info("RISK_MANAGEMENT", `Audit trail: ${params.action}`, {
      metadata: {
        action: params.action,
        category: params.category,
        fieldName: params.fieldName,
        oldValue: params.oldValue,
        newValue: params.newValue,
        reason: params.reason,
        performedBy: params.performedBy,
      },
    })
  } catch (err) {
    logger.error("RISK_MANAGEMENT", "Failed to write audit trail entry", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }
}
