/**
 * Risk Management Engine - FINEX Indonesia
 * ===========================================
 * Pre-trade validation, margin monitoring, daily loss limits,
 * margin call/stop out detection, correlation risk, and risk scoring.
 *
 * FINEX Broker Specs:
 *  - Leverage: 1:25
 *  - Margin Call Level: 50%
 *  - Stop Out Level: 20%
 *  - Max Order: 50 lots per trade
 *  - Max Open Positions: 200
 */

import { db } from "./db"
import logger from "./trading-logger"

// ---- Types ----

export interface RiskConfigData {
  maxRiskPerTrade: number      // % of equity
  maxDailyLoss: number         // % of equity
  maxWeeklyLoss: number        // % of equity
  maxMonthlyLoss: number       // % of equity
  maxMarginUsage: number       // % of equity
  maxDrawdown: number          // % of peak equity
  maxOpenPositions: number
  maxLotPerTrade: number
  maxLotPerSymbol: number
  marginCallLevel: number      // %
  stopOutLevel: number         // %
  maxCorrelatedExposure: number // %
  cooldownAfterLossMinutes: number
}

export interface PreTradeCheck {
  approved: boolean
  reason?: string
  riskAmount: number           // Dollar risk for this trade
  riskPercent: number          // % of equity
  suggestedLotSize: number     // Lot size within risk limits
  warnings: string[]
}

export interface RiskSnapshot {
  equity: number
  balance: number
  freeMargin: number
  marginUsed: number
  marginLevelPercent: number
  dailyPnl: number
  dailyPnlPercent: number
  weeklyPnl: number
  weeklyPnlPercent: number
  monthlyPnl: number
  monthlyPnlPercent: number
  currentDrawdown: number
  maxDrawdown: number
  maxAllowedDrawdown: number
  riskScore: number             // 0-10
  riskLevel: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "CRITICAL"
 openPositions: number
  maxPositionsAllowed: number
  marginUsagePercent: number
  maxMarginAllowed: number
  dailyLossRemaining: number
  dailyLossLimit: number
  isDailyLimitReached: boolean
  isMarginCallWarning: boolean
  isStopOutWarning: boolean
  isTradingAllowed: boolean
  tradingBlockReason?: string
  recentRiskEvents: RiskEventSummary[]
  recommendations: string[]
  positions: PositionRiskBreakdown[]
}

interface RiskEventSummary {
  eventType: string
  severity: string
  message: string
  createdAt: string
  resolved: boolean
}

interface PositionRiskBreakdown {
  tradeId: string
  symbol: string
  direction: string
  lotSize: number
  entryPrice: number
  currentPrice: number
  sl: number | null
  tp: number | null
  margin: number
  pnl: number
  pnlPercent: number
  riskAmount: number
  riskPercent: number
  strategy: string | null
  trailingStop: boolean
}

// Sector mapping for correlation risk
const SYMBOL_SECTORS: Record<string, string> = {
  BBCA: "Banking", BBRI: "Banking", BMRI: "Banking", BRIS: "Banking", BBNI: "Banking",
  TLKM: "Telecommunication", EXCL: "Telecommunication",
  ASII: "Conglomerate",
  UNVR: "Consumer Goods", ICBP: "Consumer Goods",
  GOTO: "Technology",
  ANTM: "Mining", TINS: "Mining", ADRO: "Mining",
  PGAS: "Energy", MEDC: "Energy",
  WSKT: "Infrastructure", JSMR: "Infrastructure",
  INKP: "Industrial", SMGR: "Industrial",
  EMTK: "Media",
  ARTO: "Banking", TBIG: "Telecommunication",
}

// ---- Default Config ----

const DEFAULT_CONFIG: RiskConfigData = {
  maxRiskPerTrade: 0.5,
  maxDailyLoss: 2.0,
  maxWeeklyLoss: 5.0,
  maxMonthlyLoss: 10.0,
  maxMarginUsage: 50.0,
  maxDrawdown: 10.0,
  maxOpenPositions: 200,
  maxLotPerTrade: 50.0,
  maxLotPerSymbol: 100.0,
  marginCallLevel: 50.0,
  stopOutLevel: 20.0,
  maxCorrelatedExposure: 15.0,
  cooldownAfterLossMinutes: 15,
}

// ---- Core Functions ----

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
      }
    }
  } catch (err) {
    logger.error("RISK_MANAGEMENT", "Failed to load risk config from DB, using defaults", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }
  return { ...DEFAULT_CONFIG }
}

/**
 * Calculate a full risk snapshot of the current account state.
 */
export async function getRiskSnapshot(): Promise<RiskSnapshot> {
  const config = await getRiskConfig()
  const openTrades = await db.trade.findMany({ where: { status: "OPEN" } })
  const allClosed = await db.trade.findMany({ where: { status: "CLOSED" } })

  const BASE_BALANCE = 10000
  const totalClosedPnl = allClosed.reduce((s, t) => s + t.pnl, 0)
  const currentBalance = Math.round((BASE_BALANCE + totalClosedPnl) * 100) / 100
  const totalOpenPnl = openTrades.reduce((s, t) => s + t.pnl, 0)
  const equity = Math.round((currentBalance + totalOpenPnl) * 100) / 100
  const totalMarginUsed = openTrades.reduce((s, t) => s + t.margin, 0)
  const freeMargin = Math.max(0, Math.round((equity - totalMarginUsed) * 100) / 100)
  const marginLevelPercent = totalMarginUsed > 0 ? Math.round((equity / totalMarginUsed) * 10000) / 100 : 0

  // ---- Time-based P&L ----
  const now = new Date()
  const todayStr = now.toISOString().split("T")[0]
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const closedToday = allClosed.filter((t) => t.closeTime && t.closeTime >= new Date(todayStr))
  const closedWeek = allClosed.filter((t) => t.closeTime && t.closeTime >= weekAgo)
  const closedMonth = allClosed.filter((t) => t.closeTime && t.closeTime >= monthAgo)

  const dailyPnl = closedToday.reduce((s, t) => s + t.pnl, 0) + totalOpenPnl
  const weeklyPnl = closedWeek.reduce((s, t) => s + t.pnl, 0) + totalOpenPnl
  const monthlyPnl = closedMonth.reduce((s, t) => s + t.pnl, 0) + totalOpenPnl

  // ---- Drawdown calculation ----
  let peak = currentBalance
  let maxDrawdown = 0
  let runningBalance = currentBalance - totalClosedPnl
  for (const trade of allClosed) {
    runningBalance += trade.pnl
    if (runningBalance > peak) peak = runningBalance
    const dd = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  // Factor in open P&L for current drawdown
  if (equity < peak) {
    const currentDD = ((peak - equity) / peak) * 100
    if (currentDD > maxDrawdown) maxDrawdown = currentDD
  }
  const currentDrawdown = peak > 0 ? Math.round(((peak - equity) / peak) * 10000) / 100 : 0

  // ---- Risk Score (deterministic, not random) ----
  const riskScore = calculateRiskScore({
    dailyPnlPercent: (dailyPnl / equity) * 100,
    marginUsagePercent: equity > 0 ? (totalMarginUsed / equity) * 100 : 0,
    currentDrawdown,
    maxDrawdown,
    config,
    openPositionCount: openTrades.length,
    marginLevelPercent,
  })

  const riskLevel = getRiskLevel(riskScore)

  // ---- Margin Call / Stop Out checks ----
  const isMarginCallWarning = marginLevelPercent <= config.marginCallLevel && marginLevelPercent > config.stopOutLevel
  const isStopOutWarning = marginLevelPercent <= config.stopOutLevel

  // ---- Daily loss limit ----
  const dailyLossLimit = (config.maxDailyLoss / 100) * equity
  const isDailyLimitReached = dailyPnl < 0 && Math.abs(dailyPnl) >= dailyLossLimit

  // ---- Trading allowed? ----
  let isTradingAllowed = true
  let tradingBlockReason: string | undefined

  if (isDailyLimitReached) {
    isTradingAllowed = false
    tradingBlockReason = `Daily loss limit reached (${config.maxDailyLoss}% / $${dailyLossLimit.toFixed(2)})`
  }
  if (isStopOutWarning) {
    isTradingAllowed = false
    tradingBlockReason = `Stop out level reached (${config.stopOutLevel}%)`
  }
  if (currentDrawdown >= config.maxDrawdown) {
    isTradingAllowed = false
    tradingBlockReason = `Max drawdown limit reached (${config.maxDrawdown}%)`
  }
  if (openTrades.length >= config.maxOpenPositions) {
    isTradingAllowed = false
    tradingBlockReason = `Max open positions reached (${config.maxOpenPositions})`
  }

  // ---- Recent risk events ----
  const recentEvents = await db.riskEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  })

  // ---- Recommendations ----
  const recommendations = generateRecommendations({
    riskScore,
    riskLevel,
    dailyPnl,
    dailyPnlPercent: (dailyPnl / equity) * 100,
    currentDrawdown,
    marginUsagePercent: equity > 0 ? (totalMarginUsed / equity) * 100 : 0,
    config,
    isDailyLimitReached,
    isMarginCallWarning,
    isStopOutWarning,
    isTradingAllowed,
    tradingBlockReason,
  })

  // ---- Position risk breakdown ----
  const positions: PositionRiskBreakdown[] = openTrades.map((t) => {
    let riskAmount = 0
    if (t.sl) {
      riskAmount = t.direction === "BUY"
        ? (t.entryPrice - t.sl) * t.lotSize * 100000
        : (t.sl - t.entryPrice) * t.lotSize * 100000
    }
    return {
      tradeId: t.id,
      symbol: t.symbol,
      direction: t.direction,
      lotSize: t.lotSize,
      entryPrice: t.entryPrice,
      currentPrice: t.currentPrice,
      sl: t.sl,
      tp: t.tp,
      margin: t.margin,
      pnl: t.pnl,
      pnlPercent: t.pnlPercent,
      riskAmount: Math.round(Math.abs(riskAmount) * 100) / 100,
      riskPercent: equity > 0 ? Math.round((Math.abs(riskAmount) / equity) * 10000) / 100 : 0,
      strategy: t.strategy,
      trailingStop: t.trailingStop,
    }
  })

  return {
    equity: Math.round(equity * 100) / 100,
    balance: Math.round(currentBalance * 100) / 100,
    freeMargin,
    marginUsed: Math.round(totalMarginUsed * 100) / 100,
    marginLevelPercent,
    dailyPnl: Math.round(dailyPnl * 100) / 100,
    dailyPnlPercent: Math.round((dailyPnl / equity) * 10000) / 100,
    weeklyPnl: Math.round(weeklyPnl * 100) / 100,
    weeklyPnlPercent: Math.round((weeklyPnl / equity) * 10000) / 100,
    monthlyPnl: Math.round(monthlyPnl * 100) / 100,
    monthlyPnlPercent: Math.round((monthlyPnl / equity) * 10000) / 100,
    currentDrawdown: Math.round(currentDrawdown * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxAllowedDrawdown: config.maxDrawdown,
    riskScore,
    riskLevel,
    openPositions: openTrades.length,
    maxPositionsAllowed: config.maxOpenPositions,
    marginUsagePercent: Math.round((equity > 0 ? (totalMarginUsed / equity) * 100 : 0) * 100) / 100,
    maxMarginAllowed: config.maxMarginUsage,
    dailyLossRemaining: Math.round(Math.max(0, dailyLossLimit - Math.abs(Math.min(0, dailyPnl))) * 100) / 100,
    dailyLossLimit: Math.round(dailyLossLimit * 100) / 100,
    isDailyLimitReached,
    isMarginCallWarning,
    isStopOutWarning,
    isTradingAllowed,
    tradingBlockReason,
    recentRiskEvents: recentEvents.map((e) => ({
      eventType: e.eventType,
      severity: e.severity,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
      resolved: e.resolved,
    })),
    recommendations,
    positions,
  }
}

/**
 * Pre-trade risk validation. Call this BEFORE creating any trade.
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
}): Promise<PreTradeCheck> {
  const config = await getRiskConfig()
  const snapshot = await getRiskSnapshot()
  const warnings: string[] = []

  // ---- 1. Trading allowed? ----
  if (!snapshot.isTradingAllowed) {
    return {
      approved: false,
      reason: snapshot.tradingBlockReason || "Trading is currently blocked by risk controls",
      riskAmount: 0,
      riskPercent: 0,
      suggestedLotSize: 0,
      warnings,
    }
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
    }
  }

  // ---- 5. Calculate risk amount ----
  let riskAmount = 0
  if (params.sl) {
    riskAmount = params.direction === "BUY"
      ? (params.entryPrice - params.sl) * params.lotSize * 100000
      : (params.sl - params.entryPrice) * params.lotSize * 100000
    riskAmount = Math.abs(riskAmount)
  }

  const riskPercent = snapshot.equity > 0 ? (riskAmount / snapshot.equity) * 100 : 0

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
    warnings.push(`Risk ${riskAmount.toFixed(2)} exceeds max ${maxRiskDollar.toFixed(2)} (${config.maxRiskPerTrade}%)`)
  }

  // ---- 7. No stop loss? ----
  if (!params.sl) {
    warnings.push("No stop loss set - this increases uncontrolled risk")
  }

  // ---- 8. Correlation risk ----
  const sector = SYMBOL_SECTORS[params.symbol]
  if (sector) {
    const sectorExposure = snapshot.positions
      .filter((p) => SYMBOL_SECTORS[p.symbol] === sector)
      .reduce((s, p) => s + p.margin, 0)
    const newMargin = (params.entryPrice * params.lotSize * 100000) / 25
    const sectorExposurePct = ((sectorExposure + newMargin) / snapshot.equity) * 100
    if (sectorExposurePct > config.maxCorrelatedExposure) {
      warnings.push(`Sector (${sector}) exposure would be ${sectorExposurePct.toFixed(1)}% (max ${config.maxCorrelatedExposure}%)`)
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
      }
    }
  }

  // ---- Approved ----
  return {
    approved: true,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskPercent: Math.round(riskPercent * 100) / 100,
    suggestedLotSize: Math.round(suggestedLotSize * 100) / 100,
    warnings,
  }
}

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
  } catch (err) {
    logger.error("RISK_MANAGEMENT", "Failed to log risk event", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }
}

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

  // Margin level proximity to margin call (0-2 points)
  if (factors.marginLevelPercent > 0 && factors.marginLevelPercent < factors.config.marginCallLevel) {
    score += 2
  } else if (factors.marginLevelPercent > 0 && factors.marginLevelPercent < factors.config.marginCallLevel * 1.5) {
    score += 1
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
}): string[] {
  const recs: string[] = []

  if (ctx.isStopOutWarning) {
    recs.push("CRITICAL: Stop out level reached. All positions at risk of forced closure.")
    recs.push("Immediately reduce positions or deposit additional funds.")
  } else if (ctx.isMarginCallWarning) {
    recs.push("WARNING: Margin call level approaching. Monitor positions closely.")
    recs.push("Consider reducing exposure on losing positions.")
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
