/*
 * Risk Management Engine — PART 9/12: snapshot.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 418-783): Core — account risk assessment
 * (calculateScalingFactor, calculateSectorExposure, getRiskSnapshot,
 * private buildPhase3SnapshotFields).
 */

import { db } from "@/lib/db"
import { BASE_BALANCE } from "@/lib/config"
import { getRiskConfig } from "./config"
import { determineProactiveMarginZone, processProactiveMarginMonitoring } from "./margin-monitoring"
import { calculateRiskScore, getRiskLevel, generateRecommendations } from "./internal-helpers"
import { detectVolatilityRegime } from "./volatility-regime"
import { SYMBOL_SECTORS, type PositionRiskBreakdown, type RiskSnapshot, type SectorExposureEntry } from "./types"

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
  const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const allClosed = await db.trade.findMany({ where: { status: "CLOSED", closeTime: { gte: NINETY_DAYS_AGO } } })

  const totalClosedPnl = allClosed.reduce((s, t) => s + t.pnl, 0)
  const currentBalance = Math.round((BASE_BALANCE + totalClosedPnl) * 100) / 100
  const totalOpenPnl = openTrades.reduce((s, t) => s + t.pnl, 0)
  const equity = Math.round((currentBalance + totalOpenPnl) * 100) / 100
  const totalMarginUsed = openTrades.reduce((s, t) => s + t.margin, 0)
  const freeMargin = Math.max(0, Math.round((equity - totalMarginUsed) * 100) / 100)
  const marginLevelPercent = totalMarginUsed > 0 ? Math.round((equity / totalMarginUsed) * 10000) / 100 : 0

  // ---- Time-based P&L (WIB timezone) ----
  const now = new Date()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now)
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
