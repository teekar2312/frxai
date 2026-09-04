import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { type RiskFactors } from './types'
import { defaultRiskFactors, clamp } from './helpers'

// ============================================================================
// SECTION 7: RISK CONTEXT ANALYZER
// ============================================================================

/**
 * Analyze current portfolio risk context.
 *
 * Queries open trades, daily performance, and risk configuration to build
 * a comprehensive risk profile for decision-making.
 *
 * @returns RiskFactors with portfolio-level risk metrics
 */
export async function analyzeRiskFactors(): Promise<RiskFactors> {
  const factors = defaultRiskFactors()

  try {
    // --- Open positions count & margin usage ---
    const openTrades = await db.trade.findMany({
      where: { status: 'OPEN' },
    })
    factors.openPositions = openTrades.length

    // Calculate total margin and portfolio risk
    let totalMargin = 0
    let totalRiskAmount = 0
    for (const trade of openTrades) {
      totalMargin += trade.margin
      if (trade.riskAmount) {
        totalRiskAmount += trade.riskAmount
      }
    }

    // Fix #20: Get base equity from account data or risk config
    // Fix 3 (Task 2-b): Single query for both baseEquity and dailyLossPct
    let baseEquity = 100_000_000
    const todayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
    try {
      const dailyPerf = await db.dailyPerformance.findUnique({
        where: { date: todayWib },
      })
      if (dailyPerf) {
        baseEquity = Math.max(dailyPerf.startBalance, 100_000_000)
        factors.dailyLossPct = Math.abs(dailyPerf.pnlPercent)
        factors.consecutiveLosses = dailyPerf.consecutiveLosses
      }
    } catch {
      // Use default estimate
    }

    // Fix: Compute margin usage percentage
    factors.marginUsagePct = baseEquity > 0
      ? Math.round((totalMargin / baseEquity) * 100)
      : 0

    // Portfolio risk as percentage of equity
    factors.portfolioRiskPct = baseEquity > 0
      ? Math.round((totalRiskAmount / baseEquity) * 100)
      : 0

    // --- Daily performance --- (merged into single query above)

    // --- Determine volatility regime ---
    // Check recent closed trades for volatility clues
    try {
      const recentClosed = await db.trade.findMany({
        where: { status: 'CLOSED' },
        orderBy: { closeTime: 'desc' },
        take: 20,
      })

      if (recentClosed.length >= 5) {
        // Calculate average absolute PnL percent as volatility proxy
        const avgAbsPnl = recentClosed.reduce(
          (sum, t) => sum + Math.abs(t.pnlPercent),
          0,
        ) / recentClosed.length

        if (avgAbsPnl > 3.0) {
          factors.volatilityRegime = 'HIGH_VOLATILITY'
        } else if (avgAbsPnl < 0.5) {
          factors.volatilityRegime = 'LOW_VOLATILITY'
        } else {
          factors.volatilityRegime = 'NORMAL'
        }
      }
    } catch {
      // Keep default NORMAL
    }

    // --- Composite risk score (0-10) ---
    let riskScore = 0

    // Margin usage component (0-3)
    if (factors.marginUsagePct > 80) riskScore += 3
    else if (factors.marginUsagePct > 60) riskScore += 2
    else if (factors.marginUsagePct > 40) riskScore += 1

    // Daily loss component (0-2)
    if (factors.dailyLossPct > 3) riskScore += 2
    else if (factors.dailyLossPct > 1.5) riskScore += 1

    // Consecutive losses component (0-2)
    if (factors.consecutiveLosses >= 5) riskScore += 2
    else if (factors.consecutiveLosses >= 3) riskScore += 1

    // Portfolio risk component (0-2)
    if (factors.portfolioRiskPct > 8) riskScore += 2
    else if (factors.portfolioRiskPct > 4) riskScore += 1

    // Volatility regime component (0-1)
    if (factors.volatilityRegime === 'HIGH_VOLATILITY') riskScore += 1

    factors.riskScore = clamp(riskScore, 0, 10)

  } catch (err) {
    logger.error('AI_ENGINE', 'Risk factor analysis failed', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  return factors
}
