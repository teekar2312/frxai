/*
 * Risk Management Engine — PART 2/12: internal-helpers.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 1456-1558): Internal helpers (calculateRiskScore,
 * getRiskLevel, generateRecommendations) — module-private before the split,
 * consumed by ./snapshot.ts.
 */

import type { ProactiveMarginZone, RiskConfigData, RiskSnapshot } from "./types"

// ---- Internal helpers ----

function calculateRiskScore(factors: {
  dailyPnlPercent: number
  marginUsagePercent: number
  currentDrawdown: number
  maxDrawdown: number
  config: RiskConfigData
  openPositionCount: number
  marginLevelPercent: number
}): number {
  let score = 0

  // Daily loss contribution (0-3 points)
  const dailyLossPct = Math.abs(Math.min(0, factors.dailyPnlPercent))
  score += Math.min(3, (dailyLossPct / factors.config.maxDailyLoss) * 3)

  // Margin usage (0-2 points)
  score += Math.min(2, (factors.marginUsagePercent / factors.config.maxMarginUsage) * 2)

  // Drawdown (0-3 points)
  score += Math.min(3, (factors.currentDrawdown / factors.config.maxDrawdown) * 3)

  // Margin level proximity to stop out (0-2 points)
  // Enhanced to account for 4-zone system
  if (factors.marginLevelPercent > 0) {
    if (factors.marginLevelPercent <= factors.config.stopOutLevel) {
      score += 2 // STOP_OUT
    } else if (factors.marginLevelPercent <= factors.config.marginCallLevel) {
      score += 2 // MARGIN_CALL
    } else if (factors.config.proactiveMcLevel60 && factors.marginLevelPercent <= 60) {
      score += 1.5 // PROACTIVE_60
    } else if (factors.config.proactiveMcLevel70 && factors.marginLevelPercent <= 70) {
      score += 0.75 // PROACTIVE_70
    }
  }

  return Math.min(10, Math.round(score * 10) / 10)
}

function getRiskLevel(score: number): RiskSnapshot["riskLevel"] {
  if (score <= 2) return "LOW"
  if (score <= 4) return "MODERATE"
  if (score <= 6) return "ELEVATED"
  if (score <= 8) return "HIGH"
  return "CRITICAL"
}

function generateRecommendations(ctx: {
  riskScore: number
  riskLevel: string
  dailyPnl: number
  dailyPnlPercent: number
  currentDrawdown: number
  marginUsagePercent: number
  config: RiskConfigData
  isDailyLimitReached: boolean
  isMarginCallWarning: boolean
  isStopOutWarning: boolean
  isTradingAllowed: boolean
  tradingBlockReason?: string
  proactiveMarginZone?: ProactiveMarginZone
}): string[] {
  const recs: string[] = []

  if (ctx.isStopOutWarning) {
    recs.push("CRITICAL: Stop out level reached. All positions at risk of forced closure.")
    recs.push("Immediately reduce positions or deposit additional funds.")
  } else if (ctx.isMarginCallWarning) {
    recs.push("WARNING: Margin call level reached. All new trades blocked.")
    recs.push("Consider reducing exposure on losing positions.")
  } else if (ctx.proactiveMarginZone === "PROACTIVE_70") {
    recs.push("CAUTION: Margin level in proactive warning zone (70%). Monitor closely.")
  } else if (ctx.proactiveMarginZone === "PROACTIVE_60") {
    recs.push("WARNING: Margin level in strong warning zone (60%). New positions reduced by 50%.")
    recs.push("Consider closing losing positions to free up margin.")
  }

  if (ctx.isDailyLimitReached) {
    recs.push(`Daily loss limit of ${ctx.config.maxDailyLoss}% reached. No new trades allowed today.`)
  } else if (ctx.dailyPnlPercent < -1) {
    recs.push("Daily losses are accumulating. Consider reducing position sizes.")
  }

  if (ctx.currentDrawdown > ctx.config.maxDrawdown * 0.8) {
    recs.push(`Drawdown (${ctx.currentDrawdown.toFixed(1)}%) approaching max limit (${ctx.config.maxDrawdown}%).`)
  }

  if (ctx.marginUsagePercent > ctx.config.maxMarginUsage * 0.7) {
    recs.push(`Margin usage is high (${ctx.marginUsagePercent.toFixed(1)}%). Avoid opening new positions.`)
  }

  if (ctx.riskLevel === "LOW" && ctx.isTradingAllowed) {
    recs.push("Risk levels are within acceptable parameters.")
    recs.push("Continue with standard position sizing.")
  }

  if (!ctx.isTradingAllowed && ctx.tradingBlockReason) {
    recs.push(`Trading blocked: ${ctx.tradingBlockReason}`)
  }

  return recs
}

// ---- Cross-part sharing (internal plumbing) ----
// calculateRiskScore / getRiskLevel / generateRecommendations were
// module-private before the split; they are consumed by ./snapshot.ts.
// Shared via export-list (not declaration-style) so the facade's re-exported
// declaration set stays identical to the pre-split module.

export { calculateRiskScore, getRiskLevel, generateRecommendations }
