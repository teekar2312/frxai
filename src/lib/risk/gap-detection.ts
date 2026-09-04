/*
 * Risk Management Engine — PART 8/12: gap-detection.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 1560-1636): PHASE 3: GAP RISK DETECTION
 * (assessGapRisk).
 */

import logger from "@/lib/trading-logger"
import { isMarketOpen } from "@/lib/mt5-connection"
import { getRiskConfig } from "./config"
import type { GapRiskResult } from "./types"

// ============================================
// PHASE 3: GAP RISK DETECTION
// ============================================

/**
 * Assess gap risk for a potential trade entry.
 *
 * Uses ATR-based gap estimation (volatility * 2.5 as max expected gap).
 * If entering near market close (within 30 min of 15:00 WIB), gap risk is increased by 50%.
 */
export async function assessGapRisk(params: {
  symbol: string
  direction: string
  entryPrice: number
  equity: number
  volatility?: number
}): Promise<GapRiskResult> {
  const config = await getRiskConfig()
  const vol = params.volatility ?? 0.01 // Default 1% daily volatility if not provided

  // ATR-based max expected gap = volatility * 2.5
  let estimatedMaxGapPct = vol * 2.5 * 100

  // If near market close (within 30 min of 15:00 WIB), increase gap risk by 50%
  const wibParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const wibHour = parseInt(wibParts.find(p => p.type === 'hour')?.value ?? '0')
  const wibMinute = parseInt(wibParts.find(p => p.type === 'minute')?.value ?? '0')
  const minutesSinceOpen = wibHour * 60 + wibMinute
  // Market closes at 15:00 WIB (900 minutes). Within 30 min = >= 870 minutes.
  const isNearClose = minutesSinceOpen >= 870 && minutesSinceOpen <= 900

  if (isNearClose) {
    estimatedMaxGapPct *= 1.5
    logger.info("RISK_MANAGEMENT", `Gap risk boosted near close for ${params.symbol}`, {
      metadata: { isNearClose: true, estimatedMaxGapPct },
    })
  }

  estimatedMaxGapPct = Math.round(estimatedMaxGapPct * 100) / 100

  // Risk amount = estimated gap % * entry price * typical 1 lot position
  const riskAmount = (estimatedMaxGapPct / 100) * params.entryPrice * 100000

  // Determine severity
  let severity = "LOW"
  let hasGapRisk = false
  let recommendation = "Acceptable gap risk"

  if (estimatedMaxGapPct > config.gapRiskMaxPct) {
    severity = "HIGH"
    hasGapRisk = true
    recommendation = "Avoid new positions near close"
  } else if (estimatedMaxGapPct > config.gapRiskAlertPct) {
    severity = "MEDIUM"
    hasGapRisk = true
    recommendation = "Reduce position size"
  }

  if (hasGapRisk && !isMarketOpen()) {
    // Outside market hours, any gap risk is elevated
    severity = "HIGH"
    recommendation = "Avoid new positions near close"
  }

  return {
    hasGapRisk,
    estimatedMaxGapPct,
    riskAmount: Math.round(riskAmount * 100) / 100,
    recommendation,
    severity,
  }
}
