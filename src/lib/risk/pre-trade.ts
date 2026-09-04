/*
 * Risk Management Engine — PART 10/12: pre-trade.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 785-1399): Core — preTradeCheck (pre-trade risk
 * validation: volatility multiplier, gap risk, loss limits, lot/margin/
 * leverage/concentration/reserve caps, sentiment filter).
 */

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"
import { isMarketOpen } from "@/lib/mt5-connection"
import { getRiskConfig } from "./config"
import { getRiskSnapshot } from "./snapshot"
import { logRiskEvent } from "./events"
import { detectVolatilityRegime } from "./volatility-regime"
import { assessGapRisk } from "./gap-detection"
import { calculateCorrelationMatrix } from "./correlation"
import { MIN_LOT, SYMBOL_SECTORS, type GapRiskResult, type PreTradeCheck } from "./types"

/**
 * Pre-trade risk validation. Call this BEFORE creating any trade.
 *
 * Checks (in order):
 *  0. Phase 4: Volatility regime risk multiplier
 *  0b. Phase 4: Gap risk assessment (blocks on HIGH severity)
 *  1. Trading allowed? (global block)
 *  1b. Phase 4: Weekly loss limit check
 *  1c. Phase 4: Monthly loss limit check
 *  1d. Proactive 60% zone: reduce sizes 50%
 *  2. Position limit
 *  3. Lot size limits (per trade, per symbol)
 *  4. Minimum lot check
 *  5. Calculate risk amount (including slippage)
 *  6. Risk per trade limit + apply volatility multiplier to lot size
 *  7. No stop loss warning
 *  8. Correlation risk (sector) + Phase 4: Correlation matrix check
 *  9. Margin usage after trade
 * 10. Cooldown after loss
 * 11. Portfolio-level risk cap
 * 12. Leverage utilization cap
 * 13. Single stock concentration limit
 * 14. Sector concentration limit
 * 15. Reserve capital check
 */
export async function preTradeCheck(params: {
  symbol: string
  direction: string
  lotSize: number
  entryPrice: number
  sl?: number | null
  tp?: number | null
  strategy?: string | null
  aiConfidence?: number | null
  expectedSlippage?: number | null
  // --- Phase 4 fields ---
  equity?: number
  volatility?: number
  avgVolatility?: number
}): Promise<PreTradeCheck> {
  const config = await getRiskConfig()
  const snapshot = await getRiskSnapshot()
  const warnings: string[] = []
  let positionSizeReduction = 0

  // Market open check
  if (!isMarketOpen()) {
    return {
      approved: false,
      reason: 'Market is currently closed',
      suggestedLotSize: 0,
      riskAmount: 0,
      riskPercent: 0,
      warnings: [],
      volatilityMultiplier: 1.0,
    }
  }

  // Phase 4: Volatility regime risk multiplier
  let volatilityMultiplier = 1.0
  try {
    const volResult = detectVolatilityRegime({
      recentVolatility: params.volatility ?? 0.015,
      avgVolatility: params.avgVolatility ?? 0.015,
    })
    volatilityMultiplier = volResult.riskMultiplier
    if (volatilityMultiplier < 1.0) {
      logger.warn('RISK_MANAGEMENT', `Volatility regime adjustment: ${volResult.regime} (${volatilityMultiplier}x risk)`, {
        metadata: { symbol: params.symbol, regime: volResult.regime, multiplier: volatilityMultiplier },
      })
    }
  } catch { /* non-critical, default 1.0 */ }

  // Phase 4: Gap risk check
  let gapRiskResult: GapRiskResult | null = null
  try {
    gapRiskResult = await assessGapRisk({
      symbol: params.symbol,
      direction: params.direction,
      entryPrice: params.entryPrice,
      equity: params.equity || 0,
      volatility: params.volatility,
    })
    if (gapRiskResult.hasGapRisk && gapRiskResult.severity === 'HIGH') {
      return {
        approved: false,
        reason: `Gap risk too high (${gapRiskResult.estimatedMaxGapPct}% estimated). ${gapRiskResult.recommendation}.`,
        riskAmount: gapRiskResult.riskAmount,
        riskPercent: 0,
        suggestedLotSize: 0,
        warnings,
        positionSizeReduction: 1,
        volatilityMultiplier,
        gapRisk: gapRiskResult,
      }
    }
  } catch { /* non-critical */ }

  // ---- 1. Trading allowed? (global block) ----
  if (!snapshot.isTradingAllowed) {
    return {
      approved: false,
      reason: snapshot.tradingBlockReason || "Trading is currently blocked by risk controls",
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // Phase 4: Weekly loss limit check
  if (snapshot.weeklyPnlPercent < 0 && Math.abs(snapshot.weeklyPnlPercent) >= config.maxWeeklyLoss) {
    return {
      approved: false,
      reason: `Weekly loss limit reached: ${Math.abs(snapshot.weeklyPnlPercent).toFixed(2)}% / ${config.maxWeeklyLoss}%`,
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0,
      warnings,
      positionSizeReduction: 1,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // Phase 4: Monthly loss limit check
  if (snapshot.monthlyPnlPercent < 0 && Math.abs(snapshot.monthlyPnlPercent) >= config.maxMonthlyLoss) {
    return {
      approved: false,
      reason: `Monthly loss limit reached: ${Math.abs(snapshot.monthlyPnlPercent).toFixed(2)}% / ${config.maxMonthlyLoss}%`,
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0,
      warnings,
      positionSizeReduction: 1,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 1b. Proactive 60% zone: reduce new position sizes by 50% ----
  if (snapshot.proactiveMarginZone === "PROACTIVE_60") {
    positionSizeReduction = 0.5
    warnings.push("Margin level in PROACTIVE_60 zone: new position sizes reduced by 50%")
    logger.warn("RISK_MANAGEMENT", `PROACTIVE_60 zone: reducing ${params.symbol} position size by 50%`, {
      symbol: params.symbol,
      metadata: { marginLevelPercent: snapshot.marginLevelPercent },
    })
  }

  // ---- 2. Position limit ----
  if (snapshot.openPositions >= config.maxOpenPositions) {
    return {
      approved: false,
      reason: `Max open positions reached (${config.maxOpenPositions})`,
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 3. Lot size limits ----
  if (params.lotSize > config.maxLotPerTrade) {
    return {
      approved: false,
      reason: `Lot size ${params.lotSize} exceeds max per trade (${config.maxLotPerTrade})`,
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // 3b. Check total lot per symbol
  const sameSymbolTrades = snapshot.positions.filter((p) => p.symbol === params.symbol)
  const totalSymbolLots = sameSymbolTrades.reduce((s, p) => s + p.lotSize, 0) + params.lotSize
  if (totalSymbolLots > config.maxLotPerSymbol) {
    return {
      approved: false,
      reason: `Total lot for ${params.symbol} (${totalSymbolLots}) would exceed max (${config.maxLotPerSymbol})`,
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 4. Minimum lot check (FINEX: 0.01) ----
  if (params.lotSize < 0.01) {
    return {
      approved: false,
      reason: "Minimum lot size is 0.01",
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0.01,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 4b. SL direction validation ----
  if (params.sl) {
    if (params.direction === 'BUY' && params.sl >= params.entryPrice) {
      return {
        approved: false,
        reason: 'Invalid stop-loss: must be below entry price for BUY',
        suggestedLotSize: 0,
        riskAmount: 0,
        riskPercent: 0,
        warnings,
        volatilityMultiplier,
        gapRisk: gapRiskResult ?? undefined,
      }
    }
    if (params.direction === 'SELL' && params.sl <= params.entryPrice) {
      return {
        approved: false,
        reason: 'Invalid stop-loss: must be above entry price for SELL',
        suggestedLotSize: 0,
        riskAmount: 0,
        riskPercent: 0,
        warnings,
        volatilityMultiplier,
        gapRisk: gapRiskResult ?? undefined,
      }
    }
  }

  // ---- 5. Calculate risk amount (including slippage) ----
  let riskAmount = 0
  if (params.sl) {
    riskAmount = params.direction === "BUY"
      ? (params.entryPrice - params.sl) * params.lotSize * 100000
      : (params.sl - params.entryPrice) * params.lotSize * 100000
    riskAmount = Math.abs(riskAmount)
  }

  // 5b. Slippage modeling: if expected slippage exceeds tolerance, add to risk
  let slippageCost = 0
  if (params.expectedSlippage != null && params.expectedSlippage > 0) {
    if (params.expectedSlippage > config.slippageTolerancePips) {
      slippageCost = (params.expectedSlippage * params.lotSize * 100000) / params.entryPrice
      riskAmount += slippageCost
      warnings.push(
        `Expected slippage (${params.expectedSlippage.toFixed(1)} pips) exceeds tolerance (${config.slippageTolerancePips} pips). Added $${slippageCost.toFixed(2)} to risk amount.`,
      )
      await logRiskEvent({
        eventType: "SLIPPAGE_WARNING",
        severity: "MEDIUM",
        message: `High slippage expected for ${params.symbol}: ${params.expectedSlippage.toFixed(1)} pips (tolerance: ${config.slippageTolerancePips})`,
        details: `Slippage cost $${slippageCost.toFixed(2)} added to risk. Total risk for this trade: $${riskAmount.toFixed(2)}.`,
        actionTaken: "NONE",
      })
    } else {
      // Even within tolerance, include small slippage cost in risk
      slippageCost = (params.expectedSlippage * params.lotSize * 100000) / params.entryPrice
      riskAmount += slippageCost
    }
  }

  let riskPercent = snapshot.equity > 0 ? (riskAmount / snapshot.equity) * 100 : 0

  // ---- 6. Risk per trade limit ----
  const maxRiskDollar = (config.maxRiskPerTrade / 100) * snapshot.equity
  let suggestedLotSize = params.lotSize

  if (riskAmount > maxRiskDollar && params.sl) {
    // Calculate safe lot size
    const pipRisk = params.direction === "BUY"
      ? params.entryPrice - (params.sl || 0)
      : (params.sl || 0) - params.entryPrice
    if (pipRisk > 0) {
      suggestedLotSize = Math.max(0.01, Math.floor((maxRiskDollar / (pipRisk * 100000)) * 100) / 100)
    }
    warnings.push(`Risk $${riskAmount.toFixed(2)} exceeds max $${maxRiskDollar.toFixed(2)} (${config.maxRiskPerTrade}%)`)
  }

  // Phase 4: Apply volatility regime multiplier to suggested lot size
  suggestedLotSize = Math.max(MIN_LOT, suggestedLotSize * volatilityMultiplier)

  // ---- 7. No stop loss? ----
  if (!params.sl) {
    // SL-less trades: enforce strict maximum
    const noSlMaxRisk = config.maxRiskPerTrade * 0.5 // Half of normal max risk
    const noSlMaxLot = Math.max(1, Math.floor((snapshot.equity * noSlMaxRisk / 100) / (100000 * params.entryPrice) * 100) / 100)
    if (suggestedLotSize > noSlMaxLot) {
      suggestedLotSize = Math.max(0.01, noSlMaxLot)
      warnings.push(`No stop-loss provided: lot size capped to ${noSlMaxLot} (${noSlMaxRisk}% risk)`)
    }
    riskAmount = suggestedLotSize * 100000 * params.entryPrice * (noSlMaxRisk / 100)
    riskPercent = noSlMaxRisk
  }

  // ---- 8. Correlation risk (existing sector check) ----
  const sector = SYMBOL_SECTORS[params.symbol]
  if (sector) {
    const sectorExposure = snapshot.positions
      .filter((p) => SYMBOL_SECTORS[p.symbol] === sector)
      .reduce((s, p) => s + p.margin, 0)
    const newMargin = (params.entryPrice * suggestedLotSize * 100000) / 25
    const sectorExposurePct = ((sectorExposure + newMargin) / snapshot.equity) * 100
    if (sectorExposurePct > config.maxCorrelatedExposure) {
      warnings.push(`Sector (${sector}) exposure would be ${sectorExposurePct.toFixed(1)}% (max ${config.maxCorrelatedExposure}%)`)
    }
  }

  // Phase 4: Correlation matrix check
  const correlationResult = calculateCorrelationMatrix(
    snapshot.positions.map(p => ({ symbol: p.symbol, sector: SYMBOL_SECTORS[p.symbol] || 'Unknown', margin: p.margin, pnl: p.pnl }))
  )
  const highCorrSectors = correlationResult.sectors.filter(s => s.correlationGroup === 'HIGH_CORRELATION')
  if (highCorrSectors.length > 0) {
    const topSector = highCorrSectors[0]
    if (topSector.exposure > config.maxCorrelatedExposure) {
      return {
        approved: false,
        reason: `Sector ${topSector.sector} has HIGH correlation risk: ${topSector.exposure}% exposure exceeds ${config.maxCorrelatedExposure}% limit`,
        riskAmount: 0,
        riskPercent: 0,
        suggestedLotSize: 0,
        warnings,
        positionSizeReduction: 1,
        volatilityMultiplier,
        gapRisk: gapRiskResult ?? undefined,
      }
    }
  }

  // ---- 9. Margin usage after trade ----
  const newMargin = (params.entryPrice * suggestedLotSize * 100000) / 25
  const projectedMarginUsage = ((snapshot.marginUsed + newMargin) / snapshot.equity) * 100
  if (projectedMarginUsage > config.maxMarginUsage) {
    return {
      approved: false,
      reason: `Margin usage would be ${projectedMarginUsage.toFixed(1)}% (max ${config.maxMarginUsage}%)`,
      riskAmount,
      riskPercent,
      suggestedLotSize: 0,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 10. Cooldown after loss ----
  if (config.cooldownAfterLossMinutes > 0) {
    const recentLosses = await db.trade.findMany({
      where: {
        status: "CLOSED",
        pnl: { lt: 0 },
        closeTime: { gte: new Date(Date.now() - config.cooldownAfterLossMinutes * 60 * 1000) },
      },
    })
    if (recentLosses.length >= 3) {
      return {
        approved: false,
        reason: `Cooldown active: ${recentLosses.length} losses in last ${config.cooldownAfterLossMinutes} min`,
        riskAmount,
        riskPercent,
        suggestedLotSize: 0,
        warnings: ["Multiple recent losses detected. Waiting for cooldown period."],
        volatilityMultiplier,
        gapRisk: gapRiskResult ?? undefined,
      }
    }
  }

  // ---- 11. Portfolio-level risk cap ----
  const currentPortfolioRisk = snapshot.positions.reduce((s, p) => s + p.riskAmount, 0)
  const projectedTotalRisk = currentPortfolioRisk + riskAmount
  const projectedPortfolioRiskPct = (projectedTotalRisk / snapshot.equity) * 100
  if (projectedPortfolioRiskPct > config.maxPortfolioRiskPct) {
    await logRiskEvent({
      eventType: "PORTFOLIO_RISK_CAP",
      severity: "HIGH",
      message: `Portfolio risk cap would be exceeded: ${projectedPortfolioRiskPct.toFixed(2)}% (max ${config.maxPortfolioRiskPct}%)`,
      details: `Current portfolio risk: $${currentPortfolioRisk.toFixed(2)} (${((currentPortfolioRisk / snapshot.equity) * 100).toFixed(2)}%). New trade risk: $${riskAmount.toFixed(2)} (${riskPercent.toFixed(2)}%). Combined: $${projectedTotalRisk.toFixed(2)} (${projectedPortfolioRiskPct.toFixed(2)}%).`,
      actionTaken: "TRADE_BLOCKED",
    })
    return {
      approved: false,
      reason: `Portfolio risk would be ${projectedPortfolioRiskPct.toFixed(2)}% (max ${config.maxPortfolioRiskPct}% of equity)`,
      riskAmount,
      riskPercent,
      suggestedLotSize: 0,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 12. Leverage utilization cap ----
  const effectiveLeverage = (params.entryPrice * suggestedLotSize * 100000) / snapshot.equity
  if (effectiveLeverage > config.maxLeveragePerTrade) {
    // Suggest smaller lot size
    const safeLotForLeverage = (config.maxLeveragePerTrade * snapshot.equity) / (params.entryPrice * 100000)
    const suggestedLotFromLeverage = Math.max(0.01, Math.floor(safeLotForLeverage * 100) / 100)
    await logRiskEvent({
      eventType: "LEVERAGE_CAP",
      severity: "HIGH",
      message: `Leverage cap exceeded for ${params.symbol}: ${effectiveLeverage.toFixed(1)}x (max ${config.maxLeveragePerTrade}x)`,
      details: `Entry ${params.entryPrice} x ${suggestedLotSize} lots = ${effectiveLeverage.toFixed(1)}x leverage. Suggested max lot: ${suggestedLotFromLeverage}.`,
      actionTaken: "TRADE_BLOCKED",
    })
    return {
      approved: false,
      reason: `Effective leverage ${effectiveLeverage.toFixed(1)}x exceeds max ${config.maxLeveragePerTrade}x. Suggested lot size: ${suggestedLotFromLeverage}`,
      riskAmount,
      riskPercent,
      suggestedLotSize: suggestedLotFromLeverage,
      warnings: [`Leverage ${effectiveLeverage.toFixed(1)}x exceeds cap ${config.maxLeveragePerTrade}x. Reduce lot to ${suggestedLotFromLeverage}.`],
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 13. Single stock concentration limit ----
  const sameSymbolMargin = sameSymbolTrades.reduce((s, p) => s + p.margin, 0)
  const tradeMargin = (params.entryPrice * suggestedLotSize * 100000) / 25
  const totalSymbolMargin = sameSymbolMargin + tradeMargin
  const singleStockPct = (totalSymbolMargin / snapshot.equity) * 100
  if (singleStockPct > config.maxSingleStockPct) {
    await logRiskEvent({
      eventType: "CONCENTRATION_LIMIT",
      severity: "HIGH",
      message: `Single stock concentration exceeded for ${params.symbol}: ${singleStockPct.toFixed(2)}% (max ${config.maxSingleStockPct}%)`,
      details: `Current margin in ${params.symbol}: $${sameSymbolMargin.toFixed(2)}. New trade margin: $${tradeMargin.toFixed(2)}. Total: $${totalSymbolMargin.toFixed(2)} = ${singleStockPct.toFixed(2)}% of equity.`,
      actionTaken: "TRADE_BLOCKED",
    })
    return {
      approved: false,
      reason: `Single stock ${params.symbol} concentration would be ${singleStockPct.toFixed(2)}% (max ${config.maxSingleStockPct}% of equity)`,
      riskAmount,
      riskPercent,
      suggestedLotSize: 0,
      warnings,
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- 14. Sector concentration limit ----
  if (sector) {
    const sectorMarginUsed = snapshot.sectorExposure.find((se) => se.sector === sector)?.marginUsed || 0
    const totalSectorMargin = sectorMarginUsed + tradeMargin
    const sectorPct = (totalSectorMargin / snapshot.equity) * 100
    if (sectorPct > config.maxSectorPct) {
      await logRiskEvent({
        eventType: "CONCENTRATION_LIMIT",
        severity: "HIGH",
        message: `Sector concentration exceeded for ${sector}: ${sectorPct.toFixed(2)}% (max ${config.maxSectorPct}%)`,
        details: `Current sector (${sector}) margin: $${sectorMarginUsed.toFixed(2)}. New trade margin: $${tradeMargin.toFixed(2)}. Total: $${totalSectorMargin.toFixed(2)} = ${sectorPct.toFixed(2)}% of equity.`,
        actionTaken: "TRADE_BLOCKED",
      })
      return {
        approved: false,
        reason: `Sector ${sector} concentration would be ${sectorPct.toFixed(2)}% (max ${config.maxSectorPct}% of equity)`,
        riskAmount,
        riskPercent,
        suggestedLotSize: 0,
        warnings,
        volatilityMultiplier,
        gapRisk: gapRiskResult ?? undefined,
      }
    }
  }

  // ---- 15. Reserve capital check ----
  const requiredReserve = (config.reserveCapitalPct / 100) * snapshot.equity
  const freeMarginAfterTrade = snapshot.freeMargin - tradeMargin
  if (freeMarginAfterTrade < requiredReserve) {
    const currentReservePct = (snapshot.freeMargin / snapshot.equity) * 100
    return {
      approved: false,
      reason: `Insufficient reserve capital: $${freeMarginAfterTrade.toFixed(2)} remaining (need ${config.reserveCapitalPct}% = $${requiredReserve.toFixed(2)}). Current reserve: ${currentReservePct.toFixed(1)}%.`,
      riskAmount,
      riskPercent,
      suggestedLotSize: 0,
      warnings: [`Reserve capital requirement: ${config.reserveCapitalPct}% of equity ($${requiredReserve.toFixed(2)}).`],
      volatilityMultiplier,
      gapRisk: gapRiskResult ?? undefined,
    }
  }

  // ---- Apply position size reduction from PROACTIVE_60 zone ----
  if (positionSizeReduction > 0) {
    suggestedLotSize = Math.max(0.01, Math.round(suggestedLotSize * (1 - positionSizeReduction) * 100) / 100)
    // Recalculate risk amount with reduced lot
    if (params.sl) {
      riskAmount = params.direction === "BUY"
        ? (params.entryPrice - params.sl) * suggestedLotSize * 100000
        : (params.sl - params.entryPrice) * suggestedLotSize * 100000
      riskAmount = Math.abs(riskAmount) + slippageCost
    }
  }

  // ---- Apply dynamic scaling factor ----
  if (snapshot.scalingFactor > 1.0) {
    const scaledLot = Math.max(0.01, Math.round(suggestedLotSize * snapshot.scalingFactor * 100) / 100)
    if (scaledLot > suggestedLotSize) {
      warnings.push(
        `Dynamic risk scaling applied: lot increased from ${suggestedLotSize} to ${scaledLot} (factor: ${snapshot.scalingFactor})`,
      )
      suggestedLotSize = scaledLot
    }
  } else if (snapshot.scalingFactor < 1.0) {
    const scaledLot = Math.max(0.01, Math.round(suggestedLotSize * snapshot.scalingFactor * 100) / 100)
    if (scaledLot < suggestedLotSize) {
      warnings.push(
        `Dynamic risk scaling applied: lot reduced from ${suggestedLotSize} to ${scaledLot} (factor: ${snapshot.scalingFactor})`,
      )
      suggestedLotSize = scaledLot
    }
  }

  // ---- Re-validate after scaling ----
  if (suggestedLotSize > 0) {
    const CONTRACT_SIZE = 100000
    const leverage = 25
    const scaledNotional = suggestedLotSize * CONTRACT_SIZE * params.entryPrice
    const scaledMargin = scaledNotional / leverage
    const scaledMarginPct = (scaledMargin / snapshot.equity) * 100

    // Re-check leverage cap
    if (scaledMarginPct > config.maxLeveragePerTrade) {
      suggestedLotSize = Math.max(0.01, Math.floor((snapshot.equity * config.maxLeveragePerTrade / 100 * leverage) / (CONTRACT_SIZE * params.entryPrice * 100)) / 100)
      warnings.push(`Post-scaling leverage cap: lot reduced to ${suggestedLotSize}`)
    }

    // Re-check max lot per trade
    if (suggestedLotSize > config.maxLotPerTrade) {
      suggestedLotSize = config.maxLotPerTrade
      warnings.push(`Post-scaling max lot cap: lot reduced to ${config.maxLotPerTrade}`)
    }

    // Re-check single stock concentration
    const scaledPositionValue = suggestedLotSize * CONTRACT_SIZE * params.entryPrice
    const scaledPositionMargin = scaledPositionValue / leverage
    const totalSymbolMarginAfterScale = sameSymbolTrades.reduce((s, p) => s + p.margin, 0) + scaledPositionMargin
    const scaledConcentration = (totalSymbolMarginAfterScale / snapshot.equity) * 100
    if (scaledConcentration > config.maxSingleStockPct) {
      suggestedLotSize = Math.max(0.01, Math.floor((snapshot.equity * config.maxSingleStockPct / 100) / (CONTRACT_SIZE * params.entryPrice / leverage * 100)) / 100)
      warnings.push(`Post-scaling concentration cap: lot reduced to ${suggestedLotSize}`)
    }
  }

  // ---- Phase 6: Sentiment Filter Check ----
  try {
    const { filterTrade } = await import("@/lib/sentiment-filter")
    const sentimentResult = await filterTrade(params.symbol, params.direction as "BUY" | "SELL")
    if (sentimentResult.shouldBlock) {
      logger.warn("RISK_MANAGEMENT", `Sentiment filter BLOCKED trade ${params.symbol} ${params.direction}`, {
        symbol: params.symbol,
        metadata: {
          reason: sentimentResult.blockReason,
          regime: sentimentResult.regime,
          symbolScore: sentimentResult.symbolScore,
          marketScore: sentimentResult.marketScore,
        },
      })
      await logRiskEvent({
        eventType: "SENTIMENT_FILTER_BLOCK",
        severity: "HIGH",
        message: `Sentiment filter blocked ${params.direction} ${params.symbol}: ${sentimentResult.blockReason}`,
        details: `Regime: ${sentimentResult.regime}, Symbol score: ${sentimentResult.symbolScore}, Market score: ${sentimentResult.marketScore}, Confidence: ${sentimentResult.confidence}`,
        actionTaken: "TRADE_BLOCKED",
      })
      return {
        approved: false,
        reason: `Sentiment filter: ${sentimentResult.blockReason}`,
        riskAmount,
        riskPercent,
        suggestedLotSize: 0,
        warnings: [...sentimentResult.warnings],
        positionSizeReduction: 1,
        volatilityMultiplier,
        gapRisk: gapRiskResult ?? undefined,
      }
    }
    if (sentimentResult.sizeAdjustment < 1.0) {
      const preAdj = suggestedLotSize
      suggestedLotSize = Math.max(0.01, Math.round(suggestedLotSize * sentimentResult.sizeAdjustment * 100) / 100)
      warnings.push(
        `Sentiment size adjustment: lot reduced from ${preAdj} to ${suggestedLotSize} (${(sentimentResult.sizeAdjustment * 100).toFixed(0)}% factor, regime: ${sentimentResult.regime})`,
      )
    }
    if (sentimentResult.warnings.length > 0) {
      warnings.push(...sentimentResult.warnings)
    }
  } catch {
    // Non-critical: sentiment filter failure should not block trading
  }

  // ---- Approved ----
  return {
    approved: true,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskPercent: Math.round(riskPercent * 100) / 100,
    suggestedLotSize: Math.round(suggestedLotSize * 100) / 100,
    warnings,
    positionSizeReduction: positionSizeReduction > 0 ? positionSizeReduction : undefined,
    volatilityMultiplier,
    gapRisk: gapRiskResult ?? undefined,
  }
}
