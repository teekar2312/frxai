/**
 * Money Management Module - FINEX Indonesia (Enhanced)
 * ======================================================
 * Position sizing algorithms, Kelly Criterion, compounding,
 * risk-of-ruin estimation, daily performance tracking,
 * commission-aware sizing, reserve capital enforcement,
 * drawdown recovery modeling, performance-based dynamic scaling,
 * and currency risk awareness.
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
import { isMarketOpen } from "./mt5-connection"
import { BASE_BALANCE } from "./config"

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
  commissionCost: number
  netRiskAfterCommission: number
  scalingFactor: number
  volatilityRegimeMultiplier: number
  reserveCheckApplied: boolean
  deployedMarginCheckApplied: boolean
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
  commissionPaid: number
  slippageCost: number
  deployedCapital: number
  reserveCapital: number
  sizingMethodUsed: string
  scalingFactor: number
}

export interface RiskOfRuinInput {
  winRate: number        // 0-100
  avgWin: number        // avg winning trade $ amount
  avgLoss: number       // avg losing trade $ amount
  riskPerTrade: number  // % risked per trade
}

export interface DrawdownRecoveryResult {
  drawdownPct: number
  recoveryNeeded: number
  strategy: string
  riskReductionPct: number
}

// ---- Constants ----

const LEVERAGE = 25
const MIN_LOT = 0.01
const LOT_STEP = 0.01
const PIP_VALUE_PER_LOT = 100000 // For stocks, 1 point * lot * 100000
const DEFAULT_COMMISSION_PER_LOT = 1 // FINEX charges $1/lot

// ---- Position Sizing ----

/**
 * Calculate the optimal lot size for a trade.
 * Enhanced with commission-aware sizing, reserve capital enforcement,
 * deployed margin cap, and performance-based dynamic scaling.
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
  commissionPerLot?: number // default $1 (FINEX)
  reserveCapitalPct?: number // default from RiskConfig
}): Promise<PositionSizeResult> {
  const config = await getRiskConfig()
  const method = params.method || "FIXED_FRACTIONAL"
  const sl = params.sl
  const commissionPerLot = params.commissionPerLot ?? DEFAULT_COMMISSION_PER_LOT
  const reserveCapitalPct = params.reserveCapitalPct ?? config.reserveCapitalPct

  // --- Performance-Based Dynamic Scaling ---
  const scalingFactor = await calculateScalingFactor()

  // Phase 4: Integrate volatility regime with scaling factor
  let volMultiplier = 1.0
  try {
    const { detectVolatilityRegime } = await import('./risk-engine')
    const volResult = detectVolatilityRegime({
      recentVolatility: 0.015, // default if no data
      avgVolatility: 0.015,
    })
    volMultiplier = volResult.riskMultiplier
  } catch { /* non-critical */ }

  // Combine scaling factor with volatility regime
  const effectiveScaling = (scalingFactor ?? 1.0) * volMultiplier

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

  // --- Base Risk Amount by Method ---
  let baseRiskAmount: number
  let methodReasoning: string

  switch (method) {
    case "FIXED_FRACTIONAL": {
      baseRiskAmount = (config.maxRiskPerTrade / 100) * params.equity
      methodReasoning = `Fixed fractional: ${config.maxRiskPerTrade}% of equity ($${params.equity.toFixed(2)}) = $${baseRiskAmount.toFixed(2)}`
      break
    }
    case "KELLY": {
      const kellyFraction = params.kellyFraction || 0.5
      const kellyResult = await calculateKelly(params.equity, kellyFraction)
      baseRiskAmount = kellyResult.suggestedRisk
      methodReasoning = `Half-Kelly criterion: Kelly suggests ${kellyResult.kellyPercent.toFixed(1)}%, using ${kellyFraction * 100}% = $${baseRiskAmount.toFixed(2)}`
      break
    }
    case "FIXED_DOLLAR": {
      baseRiskAmount = params.fixedDollarRisk || 100
      methodReasoning = `Fixed dollar risk: $${baseRiskAmount.toFixed(2)} per trade`
      break
    }
    case "ANTI_MARTINGALE": {
      const recentTrades = await getRecentTradeResults(5)
      let multiplier = 1
      for (const t of recentTrades) {
        if (t > 0) multiplier = Math.min(multiplier + 0.5, 3)
        else break
      }
      baseRiskAmount = (config.maxRiskPerTrade / 100) * params.equity * multiplier
      methodReasoning = `Anti-Martingale: base ${config.maxRiskPerTrade}% * ${multiplier.toFixed(1)}x (consecutive wins) = $${baseRiskAmount.toFixed(2)}`
      break
    }
    default:
      baseRiskAmount = (config.maxRiskPerTrade / 100) * params.equity
      methodReasoning = `Default fixed fractional: $${baseRiskAmount.toFixed(2)}`
  }

  // --- Apply Scaling Factor (combined with volatility regime) ---
  const scaledRiskAmount = baseRiskAmount * effectiveScaling
  let reasoning = methodReasoning
  if (effectiveScaling !== 1.0) {
    reasoning += ` | Scaled ${effectiveScaling.toFixed(3)}x (perf=${scalingFactor}, vol=${volMultiplier.toFixed(3)}) -> $${scaledRiskAmount.toFixed(2)}`
  }

  // --- Commission-Aware Lot Sizing ---
  // Risk budget must cover both SL risk AND commission cost.
  // totalRisk = SL_risk + commission
  // We need to find a lot size L where:
  //   L * effectivePipRisk * PIP_VALUE_PER_LOT + L * commissionPerLot <= scaledRiskAmount
  //   L * (effectivePipRisk * PIP_VALUE_PER_LOT + commissionPerLot) <= scaledRiskAmount
  //   L <= scaledRiskAmount / (effectivePipRisk * PIP_VALUE_PER_LOT + commissionPerLot)
  const costPerLot = effectivePipRisk * PIP_VALUE_PER_LOT + commissionPerLot
  const rawLotSize = costPerLot > 0 ? scaledRiskAmount / costPerLot : 0
  let suggestedLotSize = Math.floor(rawLotSize / LOT_STEP) * LOT_STEP
  suggestedLotSize = Math.max(MIN_LOT, suggestedLotSize)

  // Calculate commission cost for the suggested lot
  const commissionCost = Math.round(suggestedLotSize * commissionPerLot * 100) / 100
  const slRiskAmount = Math.round(suggestedLotSize * effectivePipRisk * PIP_VALUE_PER_LOT * 100) / 100
  const netRiskAfterCommission = Math.round((slRiskAmount + commissionCost) * 100) / 100

  reasoning += ` | Commission: $${commissionCost.toFixed(2)} (${suggestedLotSize} lot x $${commissionPerLot}/lot)`
  reasoning += ` | Net risk (SL + commission): $${netRiskAfterCommission.toFixed(2)}`

  // --- Reserve Capital Enforcement ---
  const maxDeployable = params.equity * (1 - reserveCapitalPct / 100)
  const contractValue = suggestedLotSize * params.entryPrice * 100000
  const marginRequired = contractValue / LEVERAGE
  let reserveCheckApplied = false

  if (marginRequired > maxDeployable) {
    // Reduce lot size so margin fits within deployable capital
    const maxLotForReserve = (maxDeployable * LEVERAGE) / (params.entryPrice * 100000)
    const reducedLot = Math.floor(maxLotForReserve / LOT_STEP) * LOT_STEP
    if (reducedLot < suggestedLotSize) {
      suggestedLotSize = Math.max(MIN_LOT, reducedLot)
      reserveCheckApplied = true
      // Recalculate values after reserve reduction
    }
    reasoning += ` | Reserve ${reserveCapitalPct}% enforced: max deployable $${maxDeployable.toFixed(2)}, reduced lot to ${suggestedLotSize}`
  }

  // --- Max Capital Deployment (Open Positions Check) ---
  const openPositions = await db.trade.findMany({ where: { status: "OPEN" } })
  const existingDeployedMargin = openPositions.reduce((sum, t) => sum + (t.margin || 0), 0)
  const newMarginRequired = (suggestedLotSize * params.entryPrice * 100000) / LEVERAGE
  let deployedMarginCheckApplied = false

  if (existingDeployedMargin + newMarginRequired > maxDeployable) {
    const availableForNew = maxDeployable - existingDeployedMargin
    if (availableForNew > 0) {
      const maxLotForDeployed = (availableForNew * LEVERAGE) / (params.entryPrice * 100000)
      const reducedLot = Math.floor(maxLotForDeployed / LOT_STEP) * LOT_STEP
      if (reducedLot < suggestedLotSize && reducedLot >= MIN_LOT) {
        suggestedLotSize = reducedLot
        deployedMarginCheckApplied = true
        reasoning += ` | Deployed margin check: $${existingDeployedMargin.toFixed(2)} already deployed, reduced lot to ${suggestedLotSize}`
      } else if (reducedLot < MIN_LOT) {
        // Not enough deployable capital for even minimum lot
        suggestedLotSize = 0
        reasoning += ` | REJECTED: Not enough deployable capital ($${availableForNew.toFixed(2)} available, $${newMarginRequired.toFixed(2)} needed)`
      }
    } else {
      suggestedLotSize = 0
      reasoning += ` | REJECTED: All deployable capital ($${maxDeployable.toFixed(2)}) already deployed ($${existingDeployedMargin.toFixed(2)})`
    }
  }

  // Cap at max lot per trade
  if (suggestedLotSize > 0) {
    suggestedLotSize = Math.min(suggestedLotSize, config.maxLotPerTrade)
  }

  // --- Absolute Risk Cap ---
  // Anti-martingale (up to 3x) + scaling (up to 1.25x) + vol multiplier can produce excessive risk.
  // Hard cap at 2x the configured max risk per trade.
  const MAX_RISK_PCT = config.maxRiskPerTrade * 2

  // --- Final Derived Values ---
  let finalContractValue = suggestedLotSize * params.entryPrice * 100000
  let finalMarginRequired = finalContractValue / LEVERAGE
  let finalCommissionCost = Math.round(suggestedLotSize * commissionPerLot * 100) / 100
  let finalSlRiskAmount = Math.round(suggestedLotSize * effectivePipRisk * PIP_VALUE_PER_LOT * 100) / 100
  let finalNetRisk = Math.round((finalSlRiskAmount + finalCommissionCost) * 100) / 100
  let riskPercent = params.equity > 0 ? (finalNetRisk / params.equity) * 100 : 0

  if (riskPercent > MAX_RISK_PCT) {
    riskPercent = MAX_RISK_PCT
    // Recalculate lot size from capped risk
    const cappedRiskAmount = (riskPercent / 100) * params.equity
    const cappedLotSize = Math.max(MIN_LOT, Math.floor((cappedRiskAmount / costPerLot) / LOT_STEP) * LOT_STEP)
    suggestedLotSize = Math.min(suggestedLotSize, cappedLotSize)
    finalContractValue = suggestedLotSize * params.entryPrice * 100000
    finalMarginRequired = finalContractValue / LEVERAGE
    finalCommissionCost = Math.round(suggestedLotSize * commissionPerLot * 100) / 100
    finalSlRiskAmount = Math.round(suggestedLotSize * effectivePipRisk * PIP_VALUE_PER_LOT * 100) / 100
    finalNetRisk = Math.round((finalSlRiskAmount + finalCommissionCost) * 100) / 100
    reasoning += ` | RISK CAPPED at ${MAX_RISK_PCT}% (anti-martingale + scaling exceeded safe limits)`
  }

  return {
    suggestedLotSize: Math.round(suggestedLotSize * 100) / 100,
    riskAmount: Math.round((baseRiskAmount * effectiveScaling) * 100) / 100,
    riskPercent: Math.round(riskPercent * 100) / 100,
    method,
    pipRisk: Math.round(effectivePipRisk * 100) / 100,
    contractValue: Math.round(finalContractValue * 100) / 100,
    marginRequired: Math.round(finalMarginRequired * 100) / 100,
    reasoning,
    commissionCost: finalCommissionCost,
    netRiskAfterCommission: finalNetRisk,
    scalingFactor,
    volatilityRegimeMultiplier: volMultiplier,
    reserveCheckApplied,
    deployedMarginCheckApplied,
  }
}

/**
 * Kelly Criterion position sizing.
 */
async function calculateKelly(equity: number, fraction: number): Promise<{
  kellyPercent: number
  suggestedRisk: number
}> {
  const closedTrades = await db.trade.findMany({
    where: { status: "CLOSED" },
    orderBy: { closeTime: "desc" },
    take: 100,
  })

  if (closedTrades.length < 10) {
    return { kellyPercent: 1.0, suggestedRisk: (fraction / 100) * equity }
  }

  const wins = closedTrades.filter((t) => t.pnl > 0)
  const losses = closedTrades.filter((t) => t.pnl < 0)
  const winRate = wins.length / closedTrades.length
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1

  const R = avgLoss > 0 ? avgWin / avgLoss : 0
  const kellyPercent = R > 0 ? (winRate - (1 - winRate) / R) * 100 : 0
  const clampedKelly = Math.max(-5, Math.min(25, kellyPercent))

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
 * Uses the formula: P(ruin) = ((1 - edge) / (1 + edge))^units
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
  const R = input.avgWin / input.avgLoss

  if (R <= 0) {
    return {
      probability: 100,
      interpretation: "Average win is zero or negative",
      recommendation: "Strategy needs improvement - avg win must exceed avg loss",
    }
  }

  const edge = W - L / R
  const riskFraction = input.riskPerTrade / 100

  if (edge <= 0) {
    return {
      probability: 100,
      interpretation: `Negative edge (${(edge * 100).toFixed(2)}%) - strategy is unprofitable statistically`,
      recommendation: "Do not trade this strategy. Win rate and/or reward-risk ratio must improve.",
    }
  }

  const q = (1 - edge) / (1 + edge)
  const units = 1 / riskFraction
  const ror = Math.pow(Math.max(0, q), units) * 100

  let interpretation: string
  let recommendation: string

  if (ror < 1) {
    interpretation = "Very Low Risk"
    recommendation = "Strategy has a strong statistical edge. Safe to trade with current parameters."
  } else if (ror < 5) {
    interpretation = "Low Risk"
    recommendation = "Acceptable risk level. Continue monitoring performance metrics."
  } else if (ror < 15) {
    interpretation = "Moderate Risk"
    recommendation = "Consider reducing position sizes or improving win rate to lower risk of ruin."
  } else if (ror < 30) {
    interpretation = "High Risk"
    recommendation = "Significant risk of account drawdown. Reduce risk per trade significantly."
  } else {
    interpretation = "Extreme Risk"
    recommendation = "Do NOT trade this strategy with current parameters. High probability of account destruction."
  }

  return {
    probability: Math.min(100, Math.round(ror * 100) / 100),
    interpretation,
    recommendation,
  }
}

// ---- Drawdown Recovery Model ----

/**
 * Calculate the recovery needed for any drawdown level.
 * Formula: recoveryNeeded = (drawdown / (100 - drawdown)) * 100
 *
 * Examples:
 *   10% DD -> 11.1% recovery needed
 *   20% DD -> 25% recovery needed
 *   50% DD -> 100% recovery needed
 */
export function calculateDrawdownRecovery(drawdownPct: number): DrawdownRecoveryResult {
  const dd = Math.max(0, Math.min(99, drawdownPct)) // Clamp 0-99%

  const recoveryNeeded = dd >= 100 ? Infinity : (dd / (100 - dd)) * 100

  // Recovery strategy and risk reduction based on drawdown severity
  let strategy: string
  let riskReductionPct: number

  if (dd < 5) {
    strategy = "NORMAL: No action needed. Drawdown within acceptable range. Continue normal trading operations."
    riskReductionPct = 0
  } else if (dd < 10) {
    strategy = "CAUTION: Minor drawdown. Review recent trades for patterns. Tighten stop losses by 10%. Avoid high-risk setups."
    riskReductionPct = 10
  } else if (dd < 15) {
    strategy = "ELEVATED: Moderate drawdown. Reduce position sizes by 25%. Focus on highest-confidence setups only. Consider pausing new positions temporarily."
    riskReductionPct = 25
  } else if (dd < 20) {
    strategy = "HIGH: Significant drawdown. Reduce risk to 50% of normal. Trade only A+ setups. Implement stricter entry criteria. Review and potentially pause underperforming strategies."
    riskReductionPct = 50
  } else if (dd < 30) {
    strategy = "CRITICAL: Severe drawdown. Reduce risk to 75% of normal. Consider full trading pause for 24-48 hours. Perform strategy review. Check if market regime has changed."
    riskReductionPct = 75
  } else if (dd < 50) {
    strategy = "EMERGENCY: Extreme drawdown. Stop all new trading immediately. Close weakest positions. Full strategy audit required. Resume only with micro-lots after analysis."
    riskReductionPct = 90
  } else {
    strategy = "CATASTROPHIC: Account severely impaired. ${recoveryNeeded.toFixed(1)}% gain required to recover. Full trading halt. Account preservation is the only priority. Consider account reset or external capital injection after thorough review."
    riskReductionPct = 100
  }

  // Fix the template literal for 50%+ case
  if (dd >= 50) {
    strategy = `CATASTROPHIC: Account severely impaired. ${recoveryNeeded.toFixed(1)}% gain required to recover. Full trading halt. Account preservation is the only priority. Consider account reset or external capital injection after thorough review.`
  }

  return {
    drawdownPct: Math.round(dd * 100) / 100,
    recoveryNeeded: Math.round(recoveryNeeded * 100) / 100,
    strategy,
    riskReductionPct,
  }
}

// ---- Performance-Based Dynamic Scaling ----

/**
 * Calculate a dynamic scaling factor based on recent trading performance.
 * Analyzes the last 30 closed trades (or all if fewer) for:
 *   - Rolling win rate
 *   - Profit factor (gross profit / gross loss)
 *   - Sharpe-like ratio (mean PnL / std dev of PnL)
 *
 * Scaling rules:
 *   WR > 60% AND PF > 1.5  -> scale up to 1.25x (max)
 *   WR > 55% AND PF > 1.2  -> scale up to 1.1x
 *   WR < 40% OR PF < 0.8  -> scale down to 0.5x
 *   WR < 45% OR PF < 1.0  -> scale down to 0.75x
 *   Otherwise              -> 1.0x (neutral)
 */
export async function calculateScalingFactor(): Promise<number> {
  try {
    const closedTrades = await db.trade.findMany({
      where: { status: "CLOSED" },
      orderBy: { closeTime: "desc" },
      take: 30,
    })

    // Not enough trades to evaluate - use neutral scaling
    if (closedTrades.length < 5) {
      return 1.0
    }

    // Calculate rolling win rate
    const wins = closedTrades.filter((t) => t.pnl > 0)
    const winRate = (wins.length / closedTrades.length) * 100

    // Calculate profit factor
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0)
    const losses = closedTrades.filter((t) => t.pnl < 0)
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0))
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0

    // Calculate Sharpe-like ratio (mean / stddev of PnL)
    const pnls = closedTrades.map((t) => t.pnl)
    const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length
    const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length
    const stddev = Math.sqrt(variance)
    // We don't use this for scaling decisions directly but log it
    const sharpeLike = stddev > 0 ? mean / stddev : 0

    // Determine scaling factor based on rules
    let factor: number
    if (winRate > 60 && profitFactor > 1.5) {
      factor = 1.25
    } else if (winRate > 55 && profitFactor > 1.2) {
      factor = 1.1
    } else if (winRate < 40 || profitFactor < 0.8) {
      factor = 0.5
    } else if (winRate < 45 || profitFactor < 1.0) {
      factor = 0.75
    } else {
      factor = 1.0
    }

    logger.debug("MONEY_MANAGEMENT", `Scaling factor calculated: ${factor}x (WR: ${winRate.toFixed(1)}%, PF: ${profitFactor.toFixed(2)}, Sharpe-like: ${sharpeLike.toFixed(2)})`, {
      metadata: {
        scalingFactor: factor,
        winRate: Math.round(winRate * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100,
        sharpeLike: Math.round(sharpeLike * 100) / 100,
        sampleSize: closedTrades.length,
      },
    })

    return factor
  } catch (err) {
    logger.error("MONEY_MANAGEMENT", "Error calculating scaling factor, defaulting to 1.0", {
      details: err instanceof Error ? err.stack : undefined,
    })
    return 1.0
  }
}

// ---- Currency Risk Awareness ----

/**
 * Returns informational awareness about IDR/USD currency risk.
 * FINEX may use USD accounts for IDX stocks, creating FX exposure.
 * This is informational only (no auto-action taken).
 */
export function getExchangeRateRisk(): {
  hasExposure: boolean
  baseCurrency: string
  quoteCurrency: string
  warning: string
  recommendation: string
  openPositionsSummary: string
} {
  // Since we trade IDX stocks priced in IDR on a potentially USD-denominated account,
  // there is inherent FX risk. This function provides awareness.
  return {
    hasExposure: true,
    baseCurrency: "USD",
    quoteCurrency: "IDR",
    warning: "IDX stocks are priced in IDR. If account is USD-denominated, IDR/USD fluctuations affect real returns. A 1% move in IDR/USD translates to ~1% P&L impact on open positions.",
    recommendation: "Monitor BI (Bank Indonesia) rate decisions. Consider hedging FX exposure if position sizes are large relative to account. Keep reserve capital to absorb FX drawdowns.",
    openPositionsSummary: "All IDX stock positions carry implicit IDR/USD exchange rate risk. Profit in IDR terms may differ from USD terms if exchange rates move between position open and close.",
  }
}

// ---- Daily Performance Tracking ----

/**
 * Get or create today's daily performance record.
 */
export async function getDailyPerformance(): Promise<DailyPerformanceData> {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

  const NINETY_DAYS_AGO = new Date()
  NINETY_DAYS_AGO.setDate(NINETY_DAYS_AGO.getDate() - 90)

  // Use upsert to avoid race condition between findUnique and create
  const allClosed = await db.trade.findMany({ where: { status: "CLOSED", closeTime: { gte: NINETY_DAYS_AGO } } })
  const totalClosedPnl = allClosed.reduce((s, t) => s + t.pnl, 0)
  const startBalance = Math.round((BASE_BALANCE + totalClosedPnl) * 100) / 100

  const perf = await db.dailyPerformance.upsert({
    where: { date: todayStr },
    update: {},
    create: {
      date: todayStr,
      startBalance,
      endBalance: startBalance,
      peakEquity: startBalance,
      troughEquity: startBalance,
    },
  })

  return mapDailyPerformanceToData(perf)
}

/**
 * Update daily performance after a trade event.
 * Enhanced to track commission, slippage, deployed capital, reserve capital,
 * scaling factor, and sizing method used.
 */
export async function updateDailyPerformance(params: {
  type: "OPEN" | "CLOSE"
  pnl?: number
  isWin?: boolean
  commission?: number
  slippage?: number
  sizingMethod?: string
}): Promise<void> {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

  const existing = await db.dailyPerformance.findUnique({ where: { date: todayStr } })
  if (!existing) return

  const openTrades = await db.trade.findMany({ where: { status: "OPEN" } })
  const unrealizedPnl = openTrades.reduce((s, t) => s + t.pnl, 0)

  // Calculate deployed capital = sum of margin for all open positions
  const deployedCapital = openTrades.reduce((s, t) => s + (t.margin || 0), 0)

  // Reserve capital = equity - deployed capital - unrealized PnL
  const currentEquity = existing.startBalance + existing.realizedPnl + unrealizedPnl
  const reserveCapital = Math.max(0, currentEquity - deployedCapital - unrealizedPnl)

  // Track commission and slippage from closed trades today
  const todayStart = new Date(todayStr)
  const todayClosedTrades = await db.trade.findMany({
    where: {
      status: "CLOSED",
      closeTime: { gte: todayStart },
    },
  })
  const totalCommissionPaid = todayClosedTrades.reduce((s, t) => s + (t.commission || 0), 0)
  const totalSlippageCost = todayClosedTrades.reduce((s, t) => s + (t.slippage || 0), 0)

  // Get current scaling factor
  const scalingFactor = await calculateScalingFactor()

  const updateData: Record<string, unknown> = {
    unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    deployedCapital: Math.round(deployedCapital * 100) / 100,
    reserveCapital: Math.round(reserveCapital * 100) / 100,
    commissionPaid: Math.round(totalCommissionPaid * 100) / 100,
    slippageCost: Math.round(totalSlippageCost * 100) / 100,
    scalingFactor,
  }

  // Track the most common sizing method used today
  if (params.sizingMethod) {
    // Store the latest sizing method used; this is a simplification.
    // A more complex approach would count method occurrences.
    updateData.sizingMethodUsed = params.sizingMethod
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
  const finalEquity = existing.startBalance + (updateData.totalPnl as number)
  updateData.endBalance = Math.round(finalEquity * 100) / 100

  const newPeak = Math.max(existing.peakEquity, finalEquity)
  const newTrough = Math.min(existing.troughEquity, finalEquity)
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

  logger.debug("MONEY_MANAGEMENT", `Daily performance updated: ${params.type} | PnL: ${params.pnl ?? 0} | Commission: $${totalCommissionPaid.toFixed(2)} | Deployed: $${deployedCapital.toFixed(2)} | Reserve: $${reserveCapital.toFixed(2)}`, {
    metadata: { type: params.type, pnl: params.pnl, date: todayStr, scalingFactor },
  })
}

// ---- Helper: Map DB record to DailyPerformanceData ----

function mapDailyPerformanceToData(row: {
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
  commissionPaid: number
  slippageCost: number
  deployedCapital: number
  reserveCapital: number
  sizingMethodUsed: string
  scalingFactor: number
}): DailyPerformanceData {
  return {
    date: row.date,
    startBalance: row.startBalance,
    endBalance: row.endBalance,
    realizedPnl: row.realizedPnl,
    unrealizedPnl: row.unrealizedPnl,
    totalPnl: row.totalPnl,
    pnlPercent: row.pnlPercent,
    tradesOpened: row.tradesOpened,
    tradesClosed: row.tradesClosed,
    winTrades: row.winTrades,
    lossTrades: row.lossTrades,
    maxDrawdown: row.maxDrawdown,
    peakEquity: row.peakEquity,
    troughEquity: row.troughEquity,
    commissionPaid: row.commissionPaid,
    slippageCost: row.slippageCost,
    deployedCapital: row.deployedCapital,
    reserveCapital: row.reserveCapital,
    sizingMethodUsed: row.sizingMethodUsed,
    scalingFactor: row.scalingFactor,
  }
}

// ============================================================================
// PHASE 3: ENHANCED MONEY MANAGEMENT
// ============================================================================

// ---- 1. Maximum Consecutive Loss Protection ----

export interface ConsecutiveLossResult {
  isHalted: boolean
  consecutiveLosses: number
  maxAllowed: number
  haltReason: string | null
  cooldownRemainingMinutes: number
  lastLossTime: Date | null
}

/**
 * Check whether trading should be halted due to consecutive losses.
 *
 * Queries recent CLOSED trades ordered by closeTime desc, counts consecutive
 * losses (pnl < 0) from the most recent trade. If the count reaches or exceeds
 * maxConsecutiveLosses (default 5), trading is halted.
 *
 * A cooldown period (default 60 minutes) must elapse before trading resumes.
 * Once the cooldown elapses, the counter is effectively reset and trading is allowed.
 */
export async function checkConsecutiveLossHalt(): Promise<ConsecutiveLossResult> {
  // Defaults (these fields exist in the DB RiskConfig model but are not yet
  // exposed through the TypeScript RiskConfigData interface).
  const maxAllowed = 5
  const cooldownMinutes = 60

  const closedTrades = await db.trade.findMany({
    where: { status: "CLOSED", closeTime: { not: null } },
    orderBy: { closeTime: "desc" },
    select: { pnl: true, closeTime: true },
    take: maxAllowed + 1,
  })

  // Count consecutive losses from the most recent trade
  let consecutiveLosses = 0
  let lastLossTime: Date | null = null

  for (const trade of closedTrades) {
    if (trade.pnl < 0) {
      consecutiveLosses++
      if (lastLossTime === null && trade.closeTime) {
        lastLossTime = trade.closeTime
      }
    } else {
      break // Stop counting at first non-loss
    }
  }

  const result: ConsecutiveLossResult = {
    isHalted: false,
    consecutiveLosses,
    maxAllowed,
    haltReason: null,
    cooldownRemainingMinutes: 0,
    lastLossTime,
  }

  if (consecutiveLosses >= maxAllowed && lastLossTime) {
    const elapsedMs = Date.now() - lastLossTime.getTime()
    const cooldownMs = cooldownMinutes * 60 * 1000
    const remainingMs = cooldownMs - elapsedMs

    if (remainingMs > 0) {
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000))
      result.isHalted = true
      result.cooldownRemainingMinutes = remainingMinutes
      result.haltReason = `Consecutive loss halt: ${consecutiveLosses} consecutive losses (max ${maxAllowed}). Cooldown: ${remainingMinutes} minutes remaining.`

      logger.warn(
        "MONEY_MANAGEMENT",
        result.haltReason,
        {
          metadata: {
            consecutiveLosses,
            maxAllowed,
            cooldownMinutes,
            cooldownRemainingMinutes: remainingMinutes,
            lastLossTime: lastLossTime.toISOString(),
          },
        },
      )
    }
    // If cooldown has elapsed, isHalted stays false — counter is effectively reset
  }

  return result
}

// ---- 2. Equity Curve Trading ----

export type EquityCurveStatus = "NORMAL" | "BELOW_MA" | "RECOVERING"

export interface EquityCurveResult {
  status: EquityCurveStatus
  currentEquity: number
  equityCurveMa: number
  maPeriod: number
}

/**
 * Check equity curve status against its simple moving average.
 *
 * Queries DailyPerformance for the last N days (maPeriod, default 20),
 * calculates the SMA of endBalance, and compares the current equity.
 *
 * - BELOW_MA: current equity is below the SMA → trading should be disabled/reduced
 * - RECOVERING: current equity was below MA recently but now above
 * - NORMAL: current equity is above the SMA
 */
export async function checkEquityCurveStatus(): Promise<EquityCurveResult> {
  const maPeriod = 20

  const recentPerf = await db.dailyPerformance.findMany({
    orderBy: { date: "desc" },
    take: maPeriod + 1, // +1 to detect RECOVERING (was below, now above)
  })

  // Need at least a few days of data to compute a meaningful MA
  if (recentPerf.length < 3) {
    const currentEquity = recentPerf.length > 0 ? recentPerf[0].endBalance : 0
    return {
      status: "NORMAL",
      currentEquity,
      equityCurveMa: currentEquity,
      maPeriod,
    }
  }

  // Calculate SMA of endBalance over the available period (up to maPeriod)
  const effectivePeriod = Math.min(maPeriod, recentPerf.length)
  const balancesForMa = recentPerf.slice(0, effectivePeriod).map((p) => p.endBalance)
  const equityCurveMa = balancesForMa.reduce((s, v) => s + v, 0) / balancesForMa.length

  const currentEquity = recentPerf[0].endBalance

  // Determine if the previous day was below MA (for RECOVERING detection)
  const prevEquity = recentPerf.length > 1 ? recentPerf[1].endBalance : currentEquity
  const prevBelowMa = prevEquity < equityCurveMa
  const currentBelowMa = currentEquity < equityCurveMa

  let status: EquityCurveStatus
  if (currentBelowMa) {
    status = "BELOW_MA"
    logger.warn(
      "MONEY_MANAGEMENT",
      `[Equity Curve] BELOW moving average. Current: ${currentEquity.toFixed(2)}, MA(${effectivePeriod}): ${equityCurveMa.toFixed(2)}. Consider reducing or halting trading.`,
      {
        metadata: {
          currentEquity: Math.round(currentEquity * 100) / 100,
          equityCurveMa: Math.round(equityCurveMa * 100) / 100,
          maPeriod: effectivePeriod,
          deviationPct: equityCurveMa > 0
            ? Math.round(((currentEquity - equityCurveMa) / equityCurveMa) * 10000) / 100
            : 0,
        },
      },
    )
  } else if (prevBelowMa && !currentBelowMa) {
    status = "RECOVERING"
    logger.info(
      "MONEY_MANAGEMENT",
      `[Equity Curve] RECOVERING — above MA after being below. Current: ${currentEquity.toFixed(2)}, MA(${effectivePeriod}): ${equityCurveMa.toFixed(2)}.`,
      {
        metadata: {
          currentEquity: Math.round(currentEquity * 100) / 100,
          equityCurveMa: Math.round(equityCurveMa * 100) / 100,
          maPeriod: effectivePeriod,
        },
      },
    )
  } else {
    status = "NORMAL"
  }

  return {
    status,
    currentEquity: Math.round(currentEquity * 100) / 100,
    equityCurveMa: Math.round(equityCurveMa * 100) / 100,
    maPeriod: effectivePeriod,
  }
}

// ---- 3. Session-Based Risk Limits ----

export interface SessionRiskResult {
  isLimitReached: boolean
  sessionPnl: number
  sessionLimit: number
  sessionTrades: number
  remainingRiskBudget: number
}

/**
 * Check whether the intraday session risk limit has been reached.
 *
 * The trading session window is 09:00–15:00 WIB (UTC+7).
 * Uses sessionRiskLimitPct from RiskConfig (default 1.0% of equity).
 * Calculates the session's realized P&L by summing PnL of all trades
 * closed within the current session window today.
 */
export async function checkSessionRiskLimit(): Promise<SessionRiskResult> {
  const sessionRiskLimitPct = 1.0 // default 1.0% of equity

  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now)
  const wibParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const wibHours = parseInt(wibParts.find(p => p.type === 'hour')?.value ?? '0')
  const wibMinutes = parseInt(wibParts.find(p => p.type === 'minute')?.value ?? '0')
  const currentWibMinutes = wibHours * 60 + wibMinutes

  // Session window: 09:00 (540) - 15:00 (900) WIB
  const SESSION_START = 540
  const SESSION_END = 900

  // If outside session, return clean state
  if (currentWibMinutes < SESSION_START || currentWibMinutes > SESSION_END) {
    return {
      isLimitReached: false,
      sessionPnl: 0,
      sessionLimit: 0,
      sessionTrades: 0,
      remainingRiskBudget: 0,
    }
  }

  // Get today's start balance from DailyPerformance
  const todayStr = today
  const todayPerf = await db.dailyPerformance.findUnique({ where: { date: todayStr } })
  const equity = todayPerf ? todayPerf.startBalance : 10000
  const sessionLimit = (sessionRiskLimitPct / 100) * equity

  // Calculate session start/end in UTC for DB query
  // WIB 09:00 today = UTC 02:00 today
  // WIB 15:00 today = UTC 08:00 today
  const sessionStartUtc = new Date(now)
  sessionStartUtc.setUTCHours(2, 0, 0, 0) // 09:00 WIB
  const sessionEndUtc = new Date(now)
  sessionEndUtc.setUTCHours(8, 0, 0, 0) // 15:00 WIB

  // Query trades closed within today's session
  const sessionClosedTrades = await db.trade.findMany({
    where: {
      status: "CLOSED",
      closeTime: {
        gte: sessionStartUtc,
        lte: sessionEndUtc,
      },
    },
    select: { pnl: true },
  })

  // Session P&L only counts losses (negative PnL) against the limit
  const sessionPnl = sessionClosedTrades.reduce((sum, t) => sum + t.pnl, 0)
  const sessionLosses = sessionClosedTrades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)
  const sessionTrades = sessionClosedTrades.length

  // Remaining risk budget is based on how much loss capacity is left
  const remainingRiskBudget = Math.max(0, Math.round((sessionLimit + sessionLosses) * 100) / 100)
  const isLimitReached = sessionLosses <= -sessionLimit

  if (isLimitReached) {
    logger.warn(
      "MONEY_MANAGEMENT",
      `Session risk limit reached. Session loss: ${sessionLosses.toFixed(2)}, Limit: ${sessionLimit.toFixed(2)}, Trades: ${sessionTrades}`,
      {
        metadata: {
          sessionPnl: Math.round(sessionPnl * 100) / 100,
          sessionLoss: Math.round(sessionLosses * 100) / 100,
          sessionLimit: Math.round(sessionLimit * 100) / 100,
          sessionTrades,
          remainingRiskBudget: 0,
        },
      },
    )
  }

  return {
    isLimitReached,
    sessionPnl: Math.round(sessionPnl * 100) / 100,
    sessionLimit: Math.round(sessionLimit * 100) / 100,
    sessionTrades,
    remainingRiskBudget,
  }
}

// ---- 4. Partial Profit Taking Model ----

export interface PartialProfitLevel {
  level: number        // 1, 2, 3
  price: number        // Target price for this level
  closePercent: number // % of position to close at this level (0-100)
  reason: string       // Human-readable explanation
}

export interface PartialProfitResult {
  levels: PartialProfitLevel[]
}

/**
 * Calculate systematic partial profit-taking levels for a trade.
 *
 * Default: 3 levels at R:R ratios of 1:1, 1:2, 1:3 with 30%, 30%, 40% closes.
 * The levels are distributed evenly along the path from entry to TP.
 *
 * For BUY:  price = entry + (tp - entry) * level / 3
 * For SELL: price = entry - (entry - tp) * level / 3
 *
 * @param entryPrice  - Trade entry price
 * @param direction   - BUY or SELL
 * @param tp          - Take-profit price
 * @param riskRewardRatio - Optional override; if provided, adjusts level spacing
 */
export function calculatePartialProfitLevels(params: {
  entryPrice: number
  direction: "BUY" | "SELL"
  tp: number
  riskRewardRatio?: number
}): PartialProfitResult {
  const { entryPrice, direction, tp, riskRewardRatio } = params

  const isBuy = direction === "BUY"
  const totalRange = isBuy ? tp - entryPrice : entryPrice - tp

  // Validate inputs
  if (totalRange <= 0) {
    return { levels: [] }
  }

  // Default: 3 levels at 1:1, 1:2, 1:3 R:R with 30%/30%/40% allocation
  const levels: PartialProfitLevel[] = [
    {
      level: 1,
      price: isBuy
        ? Math.round((entryPrice + totalRange * (1 / 3)) * 100) / 100
        : Math.round((entryPrice - totalRange * (1 / 3)) * 100) / 100,
      closePercent: 30,
      reason: "R:R 1:1 — Lock in first profit, reduce risk exposure",
    },
    {
      level: 2,
      price: isBuy
        ? Math.round((entryPrice + totalRange * (2 / 3)) * 100) / 100
        : Math.round((entryPrice - totalRange * (2 / 3)) * 100) / 100,
      closePercent: 30,
      reason: "R:R 1:2 — Second profit target, trail remaining stop",
    },
    {
      level: 3,
      price: isBuy
        ? Math.round(tp * 100) / 100
        : Math.round(tp * 100) / 100,
      closePercent: 40,
      reason: "R:R 1:3 — Final profit target, close remainder",
    },
  ]

  // If a custom risk-reward ratio is provided, adjust the level distances
  // while keeping the same close percentages
  if (riskRewardRatio && riskRewardRatio > 0) {
    let scaledRange = totalRange * (riskRewardRatio / 3)
    // Ensure levels don't exceed TP: scaledRange * 3 must fit within totalRange
    const maxLevelRange = totalRange / 3
    const effectiveRange = Math.min(scaledRange, maxLevelRange)

    levels[0].price = isBuy
      ? Math.round((entryPrice + effectiveRange) * 100) / 100
      : Math.round((entryPrice - effectiveRange) * 100) / 100
    levels[0].reason = `R:R ${riskRewardRatio.toFixed(1)}:1 — First scaled profit target (30%)`

    levels[1].price = isBuy
      ? Math.round((entryPrice + effectiveRange * 2) * 100) / 100
      : Math.round((entryPrice - effectiveRange * 2) * 100) / 100
    levels[1].reason = `R:R ${(riskRewardRatio * 2).toFixed(1)}:1 — Second scaled profit target (30%)`

    levels[2].price = isBuy
      ? Math.round((entryPrice + effectiveRange * 3) * 100) / 100
      : Math.round((entryPrice - effectiveRange * 3) * 100) / 100
    levels[2].reason = `R:R ${(riskRewardRatio * 3).toFixed(1)}:1 — Final scaled profit target (40%)`
  }

  logger.debug(
    "MONEY_MANAGEMENT",
    `Calculated ${levels.length} partial profit levels for ${direction} @ ${entryPrice} → TP ${tp}`,
    {
      metadata: { direction, entryPrice, tp, levels: levels.length, riskRewardRatio },
    },
  )

  return { levels }
}

// ---- 5. Enhanced Pre-Trade Halt Status ----

export interface PreTradeHaltStatus {
  canTrade: boolean
  haltReasons: string[]
  consecutiveLossHalted: boolean
  equityCurveHalted: boolean
  sessionLimitReached: boolean
  marketClosed: boolean
}

/**
 * Combine all pre-trade halt checks into a single call.
 *
 * Checks:
 *  1. Consecutive loss halt
 *  2. Equity curve status (BELOW_MA → halted)
 *  3. Session risk limit
 *  4. Market hours (uses isMarketOpen from mt5-connection)
 *
 * If ANY halt condition is true, canTrade is set to false.
 */
export async function getPreTradeHaltStatus(): Promise<PreTradeHaltStatus> {
  const haltReasons: string[] = []
  let consecutiveLossHalted = false
  let equityCurveHalted = false
  let sessionLimitReached = false
  let marketClosed = false

  // 1. Consecutive loss check
  try {
    const clResult = await checkConsecutiveLossHalt()
    if (clResult.isHalted) {
      consecutiveLossHalted = true
      haltReasons.push(clResult.haltReason || "Consecutive loss halt active")
    }
  } catch (err) {
    logger.error("MONEY_MANAGEMENT", "[Pre-Trade Halt] Error checking consecutive loss halt", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }

  // 2. Equity curve check
  try {
    const ecResult = await checkEquityCurveStatus()
    if (ecResult.status === "BELOW_MA") {
      equityCurveHalted = true
      haltReasons.push(
        `Equity curve below MA: current ${ecResult.currentEquity} < MA(${ecResult.maPeriod}) ${ecResult.equityCurveMa}`,
      )
    }
  } catch (err) {
    logger.error("MONEY_MANAGEMENT", "[Pre-Trade Halt] Error checking equity curve status", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }

  // 3. Session risk limit check
  try {
    const srResult = await checkSessionRiskLimit()
    if (srResult.isLimitReached) {
      sessionLimitReached = true
      haltReasons.push(
        `Session risk limit reached: session P&L ${srResult.sessionPnl}, limit ${srResult.sessionLimit}`,
      )
    }
  } catch (err) {
    logger.error("MONEY_MANAGEMENT", "[Pre-Trade Halt] Error checking session risk limit", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }

  // 4. Market hours check
  try {
    marketClosed = !isMarketOpen()
    if (marketClosed) {
      haltReasons.push("Market is currently closed (outside 09:00-15:00 WIB trading hours)")
    }
  } catch (err) {
    logger.error("MONEY_MANAGEMENT", "[Pre-Trade Halt] Error checking market hours", {
      details: err instanceof Error ? err.stack : undefined,
    })
  }

  const canTrade = haltReasons.length === 0

  if (!canTrade) {
    logger.warn(
      "MONEY_MANAGEMENT",
      `[Pre-Trade Halt] Trading HALTED: ${haltReasons.length} condition(s) active`,
      {
        metadata: {
          canTrade: false,
          haltReasons,
          consecutiveLossHalted,
          equityCurveHalted,
          sessionLimitReached,
          marketClosed,
        },
      },
    )
  }

  return {
    canTrade,
    haltReasons,
    consecutiveLossHalted,
    equityCurveHalted,
    sessionLimitReached,
    marketClosed,
  }
}

// ============================================================================
// PHASE 4: ENHANCED POSITION SIZING ADJUSTMENTS
// ============================================================================

// ---- Fix 10: Progressive Drawdown Risk Reduction ----

/**
 * Calculate progressive drawdown risk reduction.
 * Instead of binary 0.25x at 80%, apply a smooth curve:
 *   0-50% of max drawdown: 1.0x (no reduction)
 *   50-70%: linear from 1.0 to 0.75
 *   70-85%: linear from 0.75 to 0.5
 *   85-95%: linear from 0.5 to 0.25
 *   95-100%: 0.25x (minimum)
 */
export function calculateProgressiveDrawdownFactor(
  currentDrawdown: number,
  maxDrawdown: number,
): number {
  if (maxDrawdown <= 0) return 1.0
  const ratio = Math.min(currentDrawdown / maxDrawdown, 1.0)

  if (ratio <= 0.50) return 1.0
  if (ratio <= 0.70) return 1.0 - (ratio - 0.50) / 0.20 * 0.25  // 1.0 → 0.75
  if (ratio <= 0.85) return 0.75 - (ratio - 0.70) / 0.15 * 0.25  // 0.75 → 0.50
  if (ratio <= 0.95) return 0.50 - (ratio - 0.85) / 0.10 * 0.25  // 0.50 → 0.25
  return 0.25
}

// ---- Fix 11: Win-Rate Adjusted Position Sizing ----

export interface WinRateAdjustmentResult {
  adjustedMultiplier: number
  reason: string
  currentWinRate: number
  historicalWinRate: number
  sampleSize: number
}

/**
 * Adjust position sizing based on recent vs historical win rate.
 * If recent win rate drops below 80% of historical, reduce sizing proportionally.
 */
export async function calculateWinRateAdjustment(): Promise<WinRateAdjustmentResult> {
  const closedTrades = await db.trade.findMany({
    where: { status: 'CLOSED' },
    orderBy: { closeTime: 'desc' },
    take: 100,
  })

  if (closedTrades.length < 20) {
    return { adjustedMultiplier: 1.0, reason: 'Insufficient trade history (need 20+ trades)', currentWinRate: 0, historicalWinRate: 0, sampleSize: closedTrades.length }
  }

  // Historical = all 100 trades
  const historicalWins = closedTrades.filter(t => t.pnl > 0).length
  const historicalWinRate = historicalWins / closedTrades.length

  // Recent = last 20 trades
  const recentTrades = closedTrades.slice(0, 20)
  const recentWins = recentTrades.filter(t => t.pnl > 0).length
  const recentWinRate = recentWins / recentTrades.length

  if (historicalWinRate <= 0) {
    return { adjustedMultiplier: 1.0, reason: 'Zero historical win rate', currentWinRate: recentWinRate, historicalWinRate, sampleSize: closedTrades.length }
  }

  // If recent win rate < 80% of historical, reduce proportionally
  const threshold = historicalWinRate * 0.80
  if (recentWinRate < threshold) {
    const ratio = recentWinRate / threshold
    const multiplier = Math.max(0.5, ratio) // Never reduce below 0.5x
    return {
      adjustedMultiplier: Math.round(multiplier * 100) / 100,
      reason: `Recent win rate (${(recentWinRate * 100).toFixed(1)}%) below 80% of historical (${(historicalWinRate * 100).toFixed(1)}%). Reducing to ${multiplier.toFixed(2)}x`,
      currentWinRate: recentWinRate,
      historicalWinRate,
      sampleSize: closedTrades.length,
    }
  }

  return { adjustedMultiplier: 1.0, reason: 'Win rate within normal range', currentWinRate: recentWinRate, historicalWinRate, sampleSize: closedTrades.length }
}
