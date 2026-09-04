/*
 * Risk Management Engine — PART 3/12: config.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 252-295): Core — getRiskConfig (load risk config
 * from DB, falling back to DEFAULT_CONFIG).
 */

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"
import { DEFAULT_CONFIG, type RiskConfigData } from "./types"

/**
 * Load risk config from DB, falling back to defaults.
 */
export async function getRiskConfig(): Promise<RiskConfigData> {
  try {
    const cfg = await db.riskConfig.findUnique({ where: { name: "default" } })
    if (cfg) {
      return {
        maxRiskPerTrade: cfg.maxRiskPerTrade,
        maxDailyLoss: cfg.maxDailyLoss,
        maxWeeklyLoss: cfg.maxWeeklyLoss,
        maxMonthlyLoss: cfg.maxMonthlyLoss,
        maxMarginUsage: cfg.maxMarginUsage,
        maxDrawdown: cfg.maxDrawdown,
        maxOpenPositions: cfg.maxOpenPositions,
        maxLotPerTrade: cfg.maxLotPerTrade,
        maxLotPerSymbol: cfg.maxLotPerSymbol,
        marginCallLevel: cfg.marginCallLevel,
        stopOutLevel: cfg.stopOutLevel,
        maxCorrelatedExposure: cfg.maxCorrelatedExposure,
        cooldownAfterLossMinutes: cfg.cooldownAfterLossMinutes,
        // Deep audit fields
        proactiveMcLevel70: cfg.proactiveMcLevel70,
        proactiveMcLevel60: cfg.proactiveMcLevel60,
        maxPortfolioRiskPct: cfg.maxPortfolioRiskPct,
        maxLeveragePerTrade: cfg.maxLeveragePerTrade,
        maxSingleStockPct: cfg.maxSingleStockPct,
        maxSectorPct: cfg.maxSectorPct,
        slippageTolerancePips: cfg.slippageTolerancePips,
        reserveCapitalPct: cfg.reserveCapitalPct,
        // Phase 3 fields
        gapRiskMaxPct: cfg.gapRiskMaxPct,
        gapRiskAlertPct: cfg.gapRiskAlertPct,
        highVolRiskReduction: cfg.highVolRiskReduction,
        lowVolRiskReduction: cfg.lowVolRiskReduction,
      }
    }
  } catch (err) {
    logger.error("RISK_MANAGEMENT", "Failed to load risk config from DB, using defaults", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }
  return { ...DEFAULT_CONFIG }
}
