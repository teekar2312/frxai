/*
 * Risk Management Engine — PART 6/12: volatility-regime.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 1638-1687): PHASE 3: VOLATILITY REGIME DETECTION
 * (detectVolatilityRegime).
 */

import type { VolatilityRegimeResult } from "./types"

// ============================================
// PHASE 3: VOLATILITY REGIME DETECTION
// ============================================

/**
 * Detect the current volatility regime and return an appropriate risk multiplier.
 *
 * - HIGH_VOLATILITY: recentVol > avgVol * 1.5 → riskMultiplier = highVolRiskReduction (default 0.5)
 * - LOW_VOLATILITY:  recentVol < avgVol * 0.5 → riskMultiplier = lowVolRiskReduction (default 0.8)
 * - NORMAL:           otherwise                 → riskMultiplier = 1.0
 */
export function detectVolatilityRegime(params: {
  recentVolatility: number
  avgVolatility: number
}): VolatilityRegimeResult {
  const { recentVolatility, avgVolatility } = params

  // When no meaningful data, default to NORMAL
  if (avgVolatility <= 0 || recentVolatility <= 0) {
    return {
      regime: "NORMAL",
      riskMultiplier: 1.0,
      reason: "Insufficient volatility data; defaulting to NORMAL regime",
    }
  }

  const ratio = recentVolatility / avgVolatility

  if (ratio > 1.5) {
    return {
      regime: "HIGH_VOLATILITY",
      riskMultiplier: 0.5,
      reason: `Recent volatility (${(recentVolatility * 100).toFixed(2)}%) is ${(ratio).toFixed(1)}x above average (${(avgVolatility * 100).toFixed(2)}%). Reducing risk to 50%.`,
    }
  }

  if (ratio < 0.5) {
    return {
      regime: "LOW_VOLATILITY",
      riskMultiplier: 0.8,
      reason: `Recent volatility (${(recentVolatility * 100).toFixed(2)}%) is ${(1/ratio).toFixed(1)}x below average (${(avgVolatility * 100).toFixed(2)}%). Mild risk reduction to 80%.`,
    }
  }

  return {
    regime: "NORMAL",
    riskMultiplier: 1.0,
    reason: `Volatility ratio ${(ratio).toFixed(2)}x within normal bounds (0.5-1.5x). No adjustment needed.`,
  }
}
