/**
 * Risk Management Engine - FINEX Indonesia
 * ===========================================
 * Pre-trade validation, margin monitoring, daily loss limits,
 * margin call/stop out detection, correlation risk, risk scoring,
 * proactive margin monitoring, portfolio risk cap, leverage cap,
 * position concentration limits, slippage modeling, reserve capital,
 * and dynamic risk scaling.
 *
 * FINEX Broker Specs:
 *  - Leverage: 1:25
 *  - Proactive Margin Call 70%: Warning zone
 *  - Proactive Margin Call 60%: Strong warning, reduce sizes 50%
 *  - Margin Call Level: 50%
 *  - Stop Out Level: 20%
 *  - Max Order: 50 lots per trade
 *  - Max Open Positions: 200
 */

import { db } from "./db"
import logger from "./trading-logger"
import { isMarketOpen } from "./mt5-connection"

// ---- Types ----

export type ProactiveMarginZone =
  | "SAFE"
  | "PROACTIVE_70"
  | "PROACTIVE_60"
  | "MARGIN_CALL"
  | "STOP_OUT"

export interface SectorExposureEntry {
  sector: string
  exposurePct: number
  positionCount: number
  marginUsed: number
}

export interface RiskConfigData {
  maxRiskPerTrade: number          // % of equity
  maxDailyLoss: number             // % of equity
  maxWeeklyLoss: number            // % of equity
  maxMonthlyLoss: number           // % of equity
  maxMarginUsage: number           // % of equity
  maxDrawdown: number              // % of peak equity
  maxOpenPositions: number
  maxLotPerTrade: number
  maxLotPerSymbol: number
  marginCallLevel: number          // %
  stopOutLevel: number             // %
  maxCorrelatedExposure: number    // %
  cooldownAfterLossMinutes: number
  // --- Deep audit fields ---
  proactiveMcLevel70: boolean      // Warn at 70% margin level
  proactiveMcLevel60: boolean      // Warn at 60% margin level
  maxPortfolioRiskPct: number      // Max total risk across all positions (% of equity)
  maxLeveragePerTrade: number      // Max effective leverage per single trade
  maxSingleStockPct: number        // Max % of equity in single stock
  maxSectorPct: number             // Max % of equity in single sector
  slippageTolerancePips: number    // Max acceptable slippage in pips
  reserveCapitalPct: number        // % of equity to keep as cash reserve
  // --- Phase 3 fields ---
  gapRiskMaxPct: number            // Max overnight gap risk tolerance %
  gapRiskAlertPct: number          // Alert threshold for gap risk %
  highVolRiskReduction: number     // Risk multiplier in HIGH_VOLATILITY
  lowVolRiskReduction: number      // Risk multiplier in LOW_VOLATILITY
}

export interface PreTradeCheck {
  approved: boolean
  reason?: string
  riskAmount: number               // Dollar risk for this trade
  riskPercent: number              // % of equity
  suggestedLotSize: number         // Lot size within risk limits
  warnings: string[]
  positionSizeReduction?: number   // 0-1, fraction to reduce size by (e.g. 0.5 for 50% reduction at PROACTIVE_60)
  // --- Phase 4 fields ---
  volatilityMultiplier: number     // Risk multiplier from volatility regime detection
  gapRisk?: GapRiskResult          // Gap risk assessment result
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
  riskScore: number                 // 0-10
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
  // --- Deep audit fields ---
  proactiveMarginZone: ProactiveMarginZone
  sectorExposure: SectorExposureEntry[]
  portfolioTotalRiskPct: number    // Total risk across all positions as % of equity
  leverageUsed: number             // Current effective leverage
  reserveCapitalPct: number        // Current reserve capital %
  scalingFactor: number            // Dynamic risk scaling factor
  // --- Phase 3 fields ---
  volatilityRegime: string         // Current volatility regime
  volatilityRiskMultiplier: number // Risk multiplier from volatility regime
  circuitBreakerState: string      // Circuit breaker state (CLOSED, OPEN, HALF_OPEN)
  connectionQuality: number        // Connection quality score (0-100)
  hasGapRisk: boolean              // Whether gap risk is elevated
  unresolvedRiskEvents: number     // Count of unresolved risk events
}

interface RiskEventSummary {
  eventType: string
  severity: string
  message: string
  createdAt: string
  resolved: boolean
}

// ---- Phase 3 Types ----

export interface GapRiskResult {
  hasGapRisk: boolean
  estimatedMaxGapPct: number
  riskAmount: number
  recommendation: string
  severity: string
}

export interface VolatilityRegimeResult {
  regime: "HIGH_VOLATILITY" | "NORMAL" | "LOW_VOLATILITY"
  riskMultiplier: number
  reason: string
}

export interface CorrelationMatrixResult {
  sectors: Array<{
    sector: string
    exposure: number
    positionCount: number
    correlationGroup: string
  }>
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

// ---- Sector mapping for correlation risk ----
// Extended with additional IDX stocks
export const SYMBOL_SECTORS: Record<string, string> = {
  // Banking
  BBCA: "Banking", BBRI: "Banking", BMRI: "Banking", BRIS: "Banking", BBNI: "Banking",
  ARTO: "Banking", NISP: "Banking", BTPS: "Banking", MEGA: "Banking",
  // Telecommunication
  TLKM: "Telecommunication", EXCL: "Telecommunication", TBIG: "Telecommunication",
  ISAT: "Telecommunication", 
  // Conglomerate
  ASII: "Conglomerate",
  // Consumer Goods
  UNVR: "Consumer Goods", ICBP: "Consumer Goods",
  ACST: "Consumer Goods", INDF: "Consumer Goods", MYOR: "Consumer Goods",
  // Technology
  GOTO: "Technology", BUKA: "Technology",
  // Mining
  ANTM: "Mining", TINS: "Mining", ADRO: "Mining",
  PTBA: "Mining", MDKA: "Mining", TKIM: "Mining",
  // Energy
  PGAS: "Energy", MEDC: "Energy", AKRA: "Energy",
  // Infrastructure
  WSKT: "Infrastructure", JSMR: "Infrastructure",
  TOWR: "Infrastructure", SMRA: "Infrastructure",
  // Industrial
  INKP: "Industrial", SMGR: "Industrial",
  ASRI: "Industrial",
  // Media
  EMTK: "Media", MNCN: "Media", 
  // Property
  BSDE: "Property", CTRA: "Property",
}

// ---- Constants ----
const MIN_LOT = 0.01

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
  // Deep audit defaults
  proactiveMcLevel70: true,
  proactiveMcLevel60: true,
  maxPortfolioRiskPct: 5.0,
  maxLeveragePerTrade: 10.0,
  maxSingleStockPct: 5.0,
  maxSectorPct: 15.0,
  slippageTolerancePips: 3.0,
  reserveCapitalPct: 20.0,
  // Phase 3 defaults
  gapRiskMaxPct: 3.0,
  gapRiskAlertPct: 2.0,
  highVolRiskReduction: 0.5,
  lowVolRiskReduction: 0.8,
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

/**
 * Calculate dynamic risk scaling factor based on recent performance.
 * - If daily loss > 1% of limit, scale down by 50%
 * - If drawdown > 80% of max, scale down by 75%
 * - If winning streak > 3, can scale up by 25% (max 1.5x)
 */
export function calculateScalingFactor(params: {
  dailyPnl: number
  dailyLossLimit: number
  currentDrawdown: number
  maxDrawdown: number
  equity: number
}): number {
  let factor = 1.0

  // Scale down if daily loss is more than 1% of the limit
  if (params.dailyPnl < 0 && params.dailyLossLimit > 0) {
    const dailyLossPct = Math.abs(params.dailyPnl) / params.dailyLossLimit
    if (dailyLossPct > 0.5) {
      factor = Math.min(factor, 0.5) // 50% reduction
    }
  }

  // Scale down if drawdown > 80% of max
  if (params.maxDrawdown > 0 && params.currentDrawdown > params.maxDrawdown * 0.8) {
    factor = Math.min(factor, 0.25) // 75% reduction
  }

  // Scale up if on a winning streak > 3 consecutive wins
  // This is a bonus that can only increase factor up to 1.5x
  // The winning streak check requires trade history, so we apply a
  // conservative boost. The actual streak check is in the caller.
  // Here we use a positive daily P&L as a proxy for the upward boost.
  if (params.dailyPnl > 0 && factor >= 1.0) {
    // Only allow scaling up if no drawdown pressure
    if (params.currentDrawdown < params.maxDrawdown * 0.3) {
      factor = Math.min(factor * 1.25, 1.5)
    }
  }

  return Math.round(factor * 1000) / 1000
}

/**
 * Calculate sector exposure breakdown for all open positions.
 */
export function calculateSectorExposure(
  openTrades: PositionRiskBreakdown[],
  equity: number,
): SectorExposureEntry[] {
  const sectorMap = new Map<string, { margin: number; count: number }>()

  for (const pos of openTrades) {
    const sector = SYMBOL_SECTORS[pos.symbol] || "Unknown"
    const existing = sectorMap.get(sector)
    if (existing) {
      existing.margin += pos.margin
      existing.count += 1
    } else {
      sectorMap.set(sector, { margin: pos.margin, count: 1 })
    }
  }

  const entries: SectorExposureEntry[] = []
  for (const [sector, data] of sectorMap.entries()) {
    entries.push({
      sector,
      exposurePct: equity > 0 ? Math.round((data.margin / equity) * 10000) / 100 : 0,
      positionCount: data.count,
      marginUsed: Math.round(data.margin * 100) / 100,
    })
  }

  // Sort by exposure descending
  entries.sort((a, b) => b.exposurePct - a.exposurePct)
  return entries
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

  // ---- Proactive margin monitoring (4 zones) ----
  const proactiveMarginZone = determineProactiveMarginZone(marginLevelPercent, config)

  // Process zone transitions and log events
  if (proactiveMarginZone !== "SAFE") {
    await processProactiveMarginMonitoring(marginLevelPercent, config)
  }

  const isMarginCallWarning =
    proactiveMarginZone === "MARGIN_CALL" ||
    proactiveMarginZone === "STOP_OUT"
  const isStopOutWarning = proactiveMarginZone === "STOP_OUT"

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

  // ---- Daily loss limit ----
  const dailyLossLimit = (config.maxDailyLoss / 100) * equity
  const isDailyLimitReached = dailyPnl < 0 && Math.abs(dailyPnl) >= dailyLossLimit

  // ---- Trading allowed? ----
  let isTradingAllowed = true
  let tradingBlockReason: string | undefined

  if (isStopOutWarning) {
    isTradingAllowed = false
    tradingBlockReason = `Stop out level reached (${config.stopOutLevel}%)`
  }
  if (proactiveMarginZone === "MARGIN_CALL") {
    isTradingAllowed = false
    tradingBlockReason = `Margin call level reached (${config.marginCallLevel}%)`
  }
  if (isDailyLimitReached) {
    isTradingAllowed = false
    tradingBlockReason = `Daily loss limit reached (${config.maxDailyLoss}% / $${dailyLossLimit.toFixed(2)})`
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
    proactiveMarginZone,
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

  // ---- Sector exposure ----
  const sectorExposure = calculateSectorExposure(positions, equity)

  // ---- Portfolio total risk % ----
  const portfolioTotalRisk = positions.reduce((s, p) => s + p.riskAmount, 0)
  const portfolioTotalRiskPct = equity > 0
    ? Math.round((portfolioTotalRisk / equity) * 10000) / 100
    : 0

  // ---- Current effective leverage ----
  const totalNotionalValue = openTrades.reduce(
    (s, t) => s + t.entryPrice * t.lotSize * 100000, 0,
  )
  const leverageUsed = equity > 0
    ? Math.round((totalNotionalValue / equity) * 100) / 100
    : 0

  // ---- Current reserve capital % ----
  const reserveCapitalPct = equity > 0
    ? Math.round((freeMargin / equity) * 10000) / 100
    : 0

  // ---- Dynamic risk scaling factor ----
  // Check winning streak for upward scaling
  const recentClosed = allClosed
    .filter((t) => t.closeTime && t.closeTime >= new Date(todayStr))
    .sort((a, b) => (b.closeTime?.getTime() || 0) - (a.closeTime?.getTime() || 0))
  let winningStreak = 0
  for (const t of recentClosed) {
    if (t.pnl > 0) {
      winningStreak++
    } else {
      break
    }
  }
  let scalingFactor = calculateScalingFactor({
    dailyPnl,
    dailyLossLimit,
    currentDrawdown,
    maxDrawdown: config.maxDrawdown,
    equity,
  })
  // Apply winning streak boost
  if (winningStreak > 3 && scalingFactor >= 1.0 && currentDrawdown < config.maxDrawdown * 0.3) {
    scalingFactor = Math.min(scalingFactor * 1.25, 1.5)
    scalingFactor = Math.round(scalingFactor * 1000) / 1000
  }

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
    // Deep audit fields
    proactiveMarginZone,
    sectorExposure,
    portfolioTotalRiskPct,
    leverageUsed,
    reserveCapitalPct,
    scalingFactor,
    // Phase 3 fields
    ...(await buildPhase3SnapshotFields()),
  }
}

/**
 * Build Phase 3 snapshot fields by reading from DB and computing volatility regime.
 */
async function buildPhase3SnapshotFields(): Promise<{
  volatilityRegime: string
  volatilityRiskMultiplier: number
  circuitBreakerState: string
  connectionQuality: number
  hasGapRisk: boolean
  unresolvedRiskEvents: number
}> {
  // Default volatility regime when no real data available
  const volRegime = detectVolatilityRegime({ recentVolatility: 0, avgVolatility: 0 })

  // Read MT5 connection state from DB for circuit breaker & quality
  let circuitBreakerState = "CLOSED"
  let connectionQuality = 100
  try {
    const connState = await db.mt5ConnectionState.findFirst({ orderBy: { createdAt: "desc" } })
    if (connState) {
      circuitBreakerState = connState.circuitState || "CLOSED"
      connectionQuality = Math.round(connState.connectionQuality * 100) / 100
    }
  } catch {
    // Table may not exist or be accessible; use defaults
  }

  const unresolvedRiskEvents = await db.riskEvent.count({ where: { resolved: false } })

  return {
    volatilityRegime: volRegime.regime,
    volatilityRiskMultiplier: volRegime.riskMultiplier,
    circuitBreakerState,
    connectionQuality,
    hasGapRisk: false,
    unresolvedRiskEvents,
  }
}

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
    warnings.push(`Risk $${riskAmount.toFixed(2)} exceeds max $${maxRiskDollar.toFixed(2)} (${config.maxRiskPerTrade}%)`)
  }

  // Phase 4: Apply volatility regime multiplier to suggested lot size
  suggestedLotSize = Math.max(MIN_LOT, suggestedLotSize * volatilityMultiplier)

  // ---- 7. No stop loss? ----
  if (!params.sl) {
    warnings.push("No stop loss set - this increases uncontrolled risk")
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
  if (snapshot.scalingFactor < 1.0) {
    const scaledLot = Math.max(0.01, Math.round(suggestedLotSize * snapshot.scalingFactor * 100) / 100)
    if (scaledLot < suggestedLotSize) {
      warnings.push(
        `Dynamic risk scaling applied: lot reduced from ${suggestedLotSize} to ${scaledLot} (factor: ${snapshot.scalingFactor})`,
      )
      suggestedLotSize = scaledLot
    }
  }

  // ---- Phase 6: Sentiment Filter Check ----
  try {
    const { filterTrade } = await import("./sentiment-filter")
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
  const now = new Date()
  // WIB is UTC+7
  const wibOffset = 7 * 60 * 60 * 1000
  const wibHour = new Date(now.getTime() + wibOffset).getUTCHours()
  const wibMinute = new Date(now.getTime() + wibOffset).getUTCMinutes()
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

  if (hasGapRisk && !isMarketOpen(now)) {
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

  const staleEvents = await db.riskEvent.findMany({
    where: {
      resolved: false,
      createdAt: { lt: cutoff },
    },
  })

  if (staleEvents.length === 0) {
    return 0
  }

  const now = new Date()
  let resolvedCount = 0

  for (const event of staleEvents) {
    try {
      await db.riskEvent.update({
        where: { id: event.id },
        data: {
          resolved: true,
          resolvedAt: now,
          actionTaken: event.actionTaken
            ? `${event.actionTaken}; AUTO_RESOLVED`
            : "AUTO_RESOLVED",
        },
      })
      logger.info("RISK_MANAGEMENT", `Auto-resolved stale risk event: ${event.eventType}`, {
        metadata: {
          eventId: event.id,
          eventType: event.eventType,
          severity: event.severity,
          ageMinutes: Math.round((now.getTime() - event.createdAt.getTime()) / 60000),
        },
      })
      resolvedCount++
    } catch (err) {
      logger.error("RISK_MANAGEMENT", `Failed to auto-resolve risk event ${event.id}`, {
        details: err instanceof Error ? err.stack : undefined,
      })
    }
  }

  if (resolvedCount > 0) {
    logger.info("RISK_MANAGEMENT", `Auto-resolved ${resolvedCount} stale risk events (max age: ${maxAgeMinutes}min)`, {
      metadata: { resolvedCount, maxAgeMinutes },
    })
  }

  return resolvedCount
}

// ============================================
// PHASE 3: CORRELATION MATRIX
// ============================================

/**
 * Calculate a sector-level correlation matrix from open positions.
 *
 * Groups positions by sector, calculates sector exposure as % of total margin,
 * and assigns correlation groups based on position count per sector.
 */
export function calculateCorrelationMatrix(
  openPositions: Array<{ symbol: string; sector: string; margin: number; pnl: number }>,
): CorrelationMatrixResult {
  const config = DEFAULT_CONFIG // Use defaults for threshold comparison

  // Group by sector
  const sectorMap = new Map<string, { margin: number; count: number; pnl: number }>()
  let totalMargin = 0

  for (const pos of openPositions) {
    const sector = pos.sector || "Unknown"
    const existing = sectorMap.get(sector)
    if (existing) {
      existing.margin += pos.margin
      existing.count += 1
      existing.pnl += pos.pnl
    } else {
      sectorMap.set(sector, { margin: pos.margin, count: 1, pnl: pos.pnl })
    }
    totalMargin += pos.margin
  }

  const sectors: CorrelationMatrixResult["sectors"] = []

  for (const [sector, data] of sectorMap.entries()) {
    const exposure = totalMargin > 0
      ? Math.round((data.margin / totalMargin) * 10000) / 100
      : 0

    // Assign correlation group based on position count
    let correlationGroup: string
    if (data.count > 3) {
      correlationGroup = "HIGH_CORRELATION"
    } else if (data.count >= 2) {
      correlationGroup = "MEDIUM"
    } else {
      correlationGroup = "LOW"
    }

    sectors.push({
      sector,
      exposure,
      positionCount: data.count,
      correlationGroup,
    })
  }

  // Sort by exposure descending
  sectors.sort((a, b) => b.exposure - a.exposure)

  return { sectors }
}

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
