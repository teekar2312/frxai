/**
 * Money Management Module - FINEX Indonesia
 * ==============================================
 * Position sizing algorithms, Kelly Criterion, compounding,
 * risk-of-ruin estimation, and daily performance tracking.
 *
 * Supported Sizing Methods:
 *  - Fixed Fractional (default)
 *  - Kelly Criterion (conservative: half-Kelly)
 *  - Fixed Dollar Amount
 *  - Anti-Martingale (increase after wins)
 */

import { db } from "./db"
import logger from "./trading-logger"
import { getRiskConfig } from "./risk-engine"

export type SizingMethod = "FIXED_FRACTIONAL" | "KELLY" | "FIXED_DOLLAR" | "ANTI_MARTINGALE"

export interface PositionSizeResult {
  suggestedLotSize: number
  riskAmount: number
  riskPercent: number
  method: SizingMethod
  pipRisk: number
  contractValue: number
  marginRequired: number
  reasoning: string
}

export interface DailyPerformanceData {
  date: string
  startBalance: number
  endBalance: number
  realizedPnl: number
  unrealizedPnl: number
  totalPnl: number
  pnlPercent: number
  tradesOpened: number
  tradesClosed: number
  winTrades: number
  lossTrades: number
  maxDrawdown: number
  peakEquity: number
  troughEquity: number
}

export interface RiskOfRuinInput {
  winRate: number        // 0-100
  avgWin: number        // avg winning trade $ amount
  avgLoss: number       // avg losing trade $ amount
  riskPerTrade: number  // % risked per trade
}
// ---- Constants ----

const LEVERAGE = 25
const MIN_LOT = 0.01
const LOT_STEP = 0.01
const PIP_VALUE_PER_LOT = 100000 // For stocks, 1 point * lot * 100000

// ---- Position Sizing ----

/**
 * Calculate the optimal lot size for a trade.
 */
export async function calculatePositionSize(params: {
  symbol: string
  direction: "BUY" | "SELL"
  entryPrice: number
  sl?: number | null
  equity: number
  method?: SizingMethod
  fixedDollarRisk?: number
  kellyFraction?: number // default 0.5 (half-Kelly)
}): Promise<PositionSizeResult> {
  const config = await getRiskConfig()
  const method = params.method || "FIXED_FRACTIONAL"
  const sl = params.sl

  // Calculate pip risk (price distance to stop loss)
  let pipRisk = 0
  if (sl) {
    pipRisk = params.direction === "BUY"
      ? params.entryPrice - sl
      : sl - params.entryPrice
    pipRisk = Math.abs(pipRisk)
  }

  // If no SL, use a default 2% price risk as fallback
  const effectivePipRisk = pipRisk > 0 ? pipRisk : params.entryPrice * 0.02

  let riskAmount: number
  let reasoning: string

  switch (method) {
    case "FIXED_FRACTIONAL": {
      // Risk = equity * maxRiskPerTrade%
      riskAmount = (config.maxRiskPerTrade / 100) * params.equity
      reasoning = `Fixed fractional: ${config.maxRiskPerTrade}% of equity ($${params.equity.toFixed(2)}) = $${riskAmount.toFixed(2)}`
      break
    }
    case "KELLY": {
      const kellyFraction = params.kellyFraction || 0.5 // Half-Kelly by default
      const kellyResult = await calculateKelly(params.equity, kellyFraction)
      riskAmount = kellyResult.suggestedRisk
      reasoning = `Half-Kelly criterion: Kelly suggests ${kellyResult.kellyPercent.toFixed(1)}%, using ${kellyFraction * 100}% = $${riskAmount.toFixed(2)}`
      break
    }
    case "FIXED_DOLLAR": {
      riskAmount = params.fixedDollarRisk || 100
      reasoning = `Fixed dollar risk: $${riskAmount.toFixed(2)} per trade`
      break
    }
    case "ANTI_MARTINGALE": {
      // Start with base risk, increase by 50% after consecutive wins
      const recentTrades = await getRecentTradeResults(5)
      let multiplier = 1
      for (const t of recentTrades) {
        if (t > 0) multiplier = Math.min(multiplier + 0.5, 3) // Cap at 3x
        else break
      }
      riskAmount = (config.maxRiskPerTrade / 100) * params.equity * multiplier
      reasoning = `Anti-Martingale: base ${config.maxRiskPerTrade}% * ${multiplier.toFixed(1)}x (consecutive wins) = $${riskAmount.toFixed(2)}`
      break
    }
    default:
      riskAmount = (config.maxRiskPerTrade / 100) * params.equity
      reasoning = `Default fixed fractional: $${riskAmount.toFixed(2)}`
  }

  // Calculate lot size: riskAmount / (pipRisk * pipValuePerLot)
  const rawLotSize = effectivePipRisk > 0 ? riskAmount / (effectivePipRisk * PIP_VALUE_PER_LOT) : 0
  let suggestedLotSize = Math.floor(rawLotSize / LOT_STEP) * LOT_STEP
  suggestedLotSize = Math.max(MIN_LOT, suggestedLotSize)

  // Cap at max lot per trade
  suggestedLotSize = Math.min(suggestedLotSize, config.maxLotPerTrade)

  // Calculate derived values
  const contractValue = suggestedLotSize * params.entryPrice * 100000
  const marginRequired = contractValue / LEVERAGE
  const riskPercent = params.equity > 0 ? (riskAmount / params.equity) * 100 : 0

  return {
    suggestedLotSize: Math.round(suggestedLotSize * 100) / 100,
    riskAmount: Math.round(riskAmount * 100) / 100,
    riskPercent: Math.round(riskPercent * 100) / 100,
    method,
    pipRisk: Math.round(effectivePipRisk * 100) / 100,
    contractValue: Math.round(contractValue * 100) / 100,
    marginRequired: Math.round(marginRequired * 100) / 100,
    reasoning,
  }
}

/**
 * Kelly Criterion position sizing.
 */
async function calculateKelly(equity: number, fraction: number): Promise<{
  kellyPercent: number
  suggestedRisk: number
}> {
  // Get historical trade stats
  const closedTrades = await db.trade.findMany({
    where: { status: "CLOSED" },
    orderBy: { closeTime: "desc" },
    take: 100,
  })

  if (closedTrades.length < 10) {
    // Not enough data, fall back to conservative default
    return { kellyPercent: 1.0, suggestedRisk: (fraction / 100) * equity }
  }

  const wins = closedTrades.filter((t) => t.pnl > 0)
  const losses = closedTrades.filter((t) => t.pnl < 0)
  const winRate = wins.length / closedTrades.length
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1

  // Kelly % = W - [(1-W) / R] where R = avgWin / avgLoss
  const R = avgLoss > 0 ? avgWin / avgLoss : 0
  const kellyPercent = R > 0 ? (winRate - (1 - winRate) / R) * 100 : 0
  const clampedKelly = Math.max(-5, Math.min(25, kellyPercent)) // Clamp to reasonable range

  return {
    kellyPercent: clampedKelly,
    suggestedRisk: (Math.max(0, clampedKelly) * fraction / 100) * equity,
  }
}

/**
 * Get recent trade results as array of PnL values (newest first).
 */
async function getRecentTradeResults(count: number): Promise<number[]> {
  const trades = await db.trade.findMany({
    where: { status: "CLOSED" },
    orderBy: { closeTime: "desc" },
    take: count,
  })
  return trades.map((t) => t.pnl)
}

// ---- Risk of Ruin ----

/**
 * Estimate the probability of ruin (losing X% of account).
 * Uses the formula: P(ruin) ≈ ((1 - edge) / (1 + edge))^units
 * where edge = W - (1-W)*avgLoss/avgWin and units = account / (risk per trade)
 */
export function calculateRiskOfRuin(input: RiskOfRuinInput): {
  probability: number
  interpretation: string
  recommendation: string
} {
  if (input.winRate <= 0 || input.avgLoss <= 0) {
    return {
      probability: 100,
      interpretation: "Cannot calculate - insufficient winning trades or zero avg loss",
      recommendation: "Improve strategy win rate or reduce loss size",
    }
  }

  const W = input.winRate / 100
  const L = 1 - W
  const R = input.avgWin / input.avgLoss // Reward-to-risk ratio

  if (R <= 0) {
    return {
      probability: 100,
      interpretation: "Average win is zero or negative",
      recommendation: "Strategy needs improvement - avg win must exceed avg loss",
    }
  }

  // Edge = W - L/R
  const edge = W - L / R
  const riskFraction = input.riskPerTrade / 100

  if (edge <= 0) {
    return {
      probability: 100,
      interpretation: `Negative edge (${(edge * 100).toFixed(2)}%) - strategy is unprofitable statistically`,
      recommendation: "Do not trade this strategy. Win rate and/or reward-risk ratio must improve.",
    }
  }

  // Approximate risk of ruin
  const q = (1 - edge) / (1 + edge)
  const units = 1 / riskFraction
  const ror = Math.pow(Math.max(0, q), units) * 100

  let interpretation: string
  let recommendation: string

  if (ror < 1) {
    interpretation = "Very Low Risk";
    recommendation = "Strategy has a strong statistical edge. Safe to trade with current parameters.";
  } else if (ror < 5) {
    interpretation = "Low Risk";
    recommendation = "Acceptable risk level. Continue monitoring performance metrics.";
  } else if (ror < 15) {
    interpretation = "Moderate Risk";
    recommendation = "Consider reducing position sizes or improving win rate to lower risk of ruin.";
  } else if (ror < 30) {
    interpretation = "High Risk";
    recommendation = "Significant risk of account drawdown. Reduce risk per trade significantly.";
  } else {
    interpretation = "Extreme Risk";
    recommendation = "Do NOT trade this strategy with current parameters. High probability of account destruction.";
  }

  return {
    probability: Math.min(100, Math.round(ror * 100) / 100),
    interpretation,
    recommendation,
  }
}

// ---- Daily Performance Tracking ----

/**
 * Get or create today's daily performance record.
 */
export async function getDailyPerformance(): Promise<DailyPerformanceData> {
  const todayStr = new Date().toISOString().split("T")[0]

  const existing = await db.dailyPerformance.findUnique({ where: { date: todayStr } })
  if (existing) {
    return {
      date: existing.date,
      startBalance: existing.startBalance,
      endBalance: existing.endBalance,
      realizedPnl: existing.realizedPnl,
      unrealizedPnl: existing.unrealizedPnl,
      totalPnl: existing.totalPnl,
      pnlPercent: existing.pnlPercent,
      tradesOpened: existing.tradesOpened,
      tradesClosed: existing.tradesClosed,
      winTrades: existing.winTrades,
      lossTrades: existing.lossTrades,
      maxDrawdown: existing.maxDrawdown,
      peakEquity: existing.peakEquity,
      troughEquity: existing.troughEquity,
    }
  }

  // Create today's record
  const BASE_BALANCE = 10000
  const allClosed = await db.trade.findMany({ where: { status: "CLOSED" } })
  const totalClosedPnl = allClosed.reduce((s, t) => s + t.pnl, 0)
  const startBalance = Math.round((BASE_BALANCE + totalClosedPnl) * 100) / 100

  const perf = await db.dailyPerformance.create({
    data: {
      date: todayStr,
      startBalance,
      endBalance: startBalance,
      peakEquity: startBalance,
      troughEquity: startBalance,
    },
  })

  return {
    date: perf.date,
    startBalance: perf.startBalance,
    endBalance: perf.endBalance,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    pnlPercent: 0,
    tradesOpened: 0,
    tradesClosed: 0,
    winTrades: 0,
    lossTrades: 0,
    maxDrawdown: 0,
    peakEquity: perf.peakEquity,
    troughEquity: perf.troughEquity,
  }
}

/**
 * Update daily performance after a trade event.
 */
export async function updateDailyPerformance(params: {
 type: "OPEN" | "CLOSE"
  pnl?: number
  isWin?: boolean
}): Promise<void> {
  const todayStr = new Date().toISOString().split("T")[0]

  const existing = await db.dailyPerformance.findUnique({ where: { date: todayStr } })
  if (!existing) return

  const openTrades = await db.trade.findMany({ where: { status: "OPEN" } })
  const unrealizedPnl = openTrades.reduce((s, t) => s + t.pnl, 0)

  const updateData: Record<string, unknown> = {
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
  }

  if (params.type === "CLOSE") {
    const newRealized = Math.round((existing.realizedPnl + (params.pnl || 0)) * 100) / 100
    updateData.realizedPnl = newRealized
    updateData.totalPnl = Math.round((newRealized + unrealizedPnl) * 100) / 100
    updateData.pnlPercent = existing.startBalance > 0 ? Math.round((newRealized / existing.startBalance) * 10000) / 100 : 0
    updateData.tradesClosed = existing.tradesClosed + 1
    if (params.isWin) {
      updateData.winTrades = existing.winTrades + 1
    } else {
      updateData.lossTrades = existing.lossTrades + 1
    }
  } else {
    updateData.tradesOpened = existing.tradesOpened + 1
    updateData.totalPnl = Math.round((existing.realizedPnl + unrealizedPnl) * 100) / 100
    updateData.pnlPercent = existing.startBalance > 0 ? Math.round((existing.realizedPnl / existing.startBalance) * 10000) / 100 : 0
  }

  // Update peak/trough for drawdown
  const currentEquity = existing.startBalance + (updateData.totalPnl as number)
  updateData.endBalance = Math.round(currentEquity * 100) / 100

  const newPeak = Math.max(existing.peakEquity, currentEquity)
  const newTrough = Math.min(existing.troughEquity, currentEquity)
  updateData.peakEquity = Math.round(newPeak * 100) / 100
  updateData.troughEquity = Math.round(newTrough * 100) / 100

  if (newPeak > 0) {
    const dd = ((newPeak - newTrough) / newPeak) * 100
    updateData.maxDrawdown = Math.max(existing.maxDrawdown, Math.round(dd * 100) / 100)
  }

  await db.dailyPerformance.update({
    where: { date: todayStr },
    data: updateData,
  })

  logger.debug("MONEY_MANAGEMENT", `Daily performance updated: ${params.type} | PnL: ${params.pnl ?? 0}`, {
    metadata: { type: params.type, pnl: params.pnl, date: todayStr },
  })
}
