import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { MATCHING_WINDOW_MS, type DecisionType, type DecisionAccuracy } from './types'

// ============================================================================
// SECTION 12: DECISION ACCURACY TRACKER
// ============================================================================

/**
 * Calculate decision accuracy over a time period.
 *
 * Queries historical DecisionLog entries, matches them to Trades opened
 * within 5 minutes of each decision, and evaluates profitability.
 * Also computes confidence calibration across low/medium/high tiers.
 *
 * @param days - Number of days to look back (default 30)
 * @returns DecisionAccuracy with win rates and calibration data
 */
export async function getDecisionAccuracy(days: number = 30): Promise<DecisionAccuracy> {
  const defaultAccuracy: DecisionAccuracy = {
    totalDecisions: 0,
    correctDecisions: 0,
    winRate: 0,
    avgConfidence: 0,
    avgPnlImpact: 0,
    byDecision: {
      BUY: { count: 0, correct: 0, avgPnl: 0 },
      SELL: { count: 0, correct: 0, avgPnl: 0 },
      HOLD: { count: 0, correct: 0, avgPnl: 0 },
      SKIP: { count: 0, correct: 0, avgPnl: 0 },
      REDUCE: { count: 0, correct: 0, avgPnl: 0 },
      CLOSE_ALL: { count: 0, correct: 0, avgPnl: 0 },
    },
    confidenceCalibration: {
      low: { count: 0, winRate: 0 },
      medium: { count: 0, winRate: 0 },
      high: { count: 0, winRate: 0 },
    },
  }

  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const decisions = await db.decisionLog.findMany({
      where: {
        createdAt: { gte: since },
        id: { not: '__self_learning_state__' }, // Exclude system records
      },
      orderBy: { createdAt: 'desc' },
    })

    if (decisions.length === 0) {
      return defaultAccuracy
    }

    let totalConfidence = 0
    let totalPnl = 0
    let correctCount = 0
    let evaluatedCount = 0

    // Calibration buckets
    const calLow: { wins: number; total: number } = { wins: 0, total: 0 }
    const calMed: { wins: number; total: number } = { wins: 0, total: 0 }
    const calHigh: { wins: number; total: number } = { wins: 0, total: 0 }

    // Fix N+1: Batch-load all closed trades in the time window first,
    // then match in-memory instead of per-decision DB queries.
    const tradeWindowStart = new Date(since.getTime() - MATCHING_WINDOW_MS)
    let allClosedTrades: Array<{
      symbol: string; direction: string; pnl: number; openTime: Date; id: string
    }> = []
    try {
      allClosedTrades = await db.trade.findMany({
        where: {
          status: 'CLOSED',
          openTime: { gte: tradeWindowStart, lte: new Date() },
        },
        select: {
          symbol: true,
          direction: true,
          pnl: true,
          openTime: true,
          id: true,
        },
      })
    } catch {
      // Trade batch load failed, continue without matching
    }

    // Collect decision IDs that need pnlImpact backfill (to batch later)
    const backfillMap = new Map<string, number>() // decisionId -> pnl

    for (const d of decisions) {
      const dType = d.decision as DecisionType
      const confidence = d.confidence as number

      // Update byDecision counts
      if (defaultAccuracy.byDecision[dType]) {
        defaultAccuracy.byDecision[dType].count++
      }

      totalConfidence += confidence

      // Only evaluate BUY/SELL decisions for accuracy
      if (dType !== 'BUY' && dType !== 'SELL') continue

      // Check pnlImpact if already populated
      if (d.pnlImpact !== null && d.pnlImpact !== undefined) {
        const isProfitable = d.pnlImpact > 0
        const pnlVal = d.pnlImpact as number
        totalPnl += pnlVal
        evaluatedCount++

        if (isProfitable) correctCount++

        if (defaultAccuracy.byDecision[dType]) {
          defaultAccuracy.byDecision[dType].avgPnl += pnlVal
          if (isProfitable) defaultAccuracy.byDecision[dType].correct++
        }

        // Calibration bucketing
        if (confidence < 50) {
          calLow.total++
          if (isProfitable) calLow.wins++
        } else if (confidence < 70) {
          calMed.total++
          if (isProfitable) calMed.wins++
        } else {
          calHigh.total++
          if (isProfitable) calHigh.wins++
        }

        continue
      }

      // Match to a trade in-memory from the pre-loaded batch
      // Fix 5: When multiple matches, pick the closest by openTime
      const decisionTime = d.createdAt.getTime()
      const matchWindowStart = decisionTime
      const matchWindowEnd = decisionTime + MATCHING_WINDOW_MS

      const matches = allClosedTrades.filter(
        t => t.symbol === d.symbol
          && t.direction === dType
          && t.openTime.getTime() >= matchWindowStart
          && t.openTime.getTime() <= matchWindowEnd,
      )

      let matchedTrade: typeof matches[0] | undefined
      if (matches.length > 0) {
        matchedTrade = matches.reduce((best, t) => {
          const bestDist = Math.abs(best.openTime.getTime() - decisionTime)
          const tDist = Math.abs(t.openTime.getTime() - decisionTime)
          return tDist < bestDist ? t : best
        })
      }

      if (matchedTrade) {
        const pnl = matchedTrade.pnl
        const isProfitable = pnl > 0
        totalPnl += pnl
        evaluatedCount++

        if (isProfitable) correctCount++

        if (defaultAccuracy.byDecision[dType]) {
          defaultAccuracy.byDecision[dType].avgPnl += pnl
          if (isProfitable) defaultAccuracy.byDecision[dType].correct++
        }

        // Calibration
        if (confidence < 50) {
          calLow.total++
          if (isProfitable) calLow.wins++
        } else if (confidence < 70) {
          calMed.total++
          if (isProfitable) calMed.wins++
        } else {
          calHigh.total++
          if (isProfitable) calHigh.wins++
        }

        // Queue pnlImpact backfill
        backfillMap.set(d.id, pnl)
      }
    }

    // Batch backfill pnlImpact on matched decisions
    if (backfillMap.size > 0) {
      try {
        await Promise.all(
          Array.from(backfillMap.entries()).map(([id, pnl]) =>
            db.decisionLog.update({ where: { id }, data: { pnlImpact: pnl } }),
          ),
        )
      } catch {
        // Non-critical
      }
    }

    // Compute averages
    defaultAccuracy.totalDecisions = decisions.length
    defaultAccuracy.correctDecisions = correctCount
    defaultAccuracy.winRate = evaluatedCount > 0
      ? Math.round((correctCount / evaluatedCount) * 100) / 100
      : 0
    defaultAccuracy.avgConfidence = Math.round(totalConfidence / decisions.length)
    defaultAccuracy.avgPnlImpact = evaluatedCount > 0
      ? Math.round((totalPnl / evaluatedCount) * 100) / 100
      : 0

    // Per-decision-type avg PnL
    for (const dType of Object.keys(defaultAccuracy.byDecision) as DecisionType[]) {
      const stats = defaultAccuracy.byDecision[dType]
      if (stats.count > 0) {
        stats.avgPnl = Math.round((stats.avgPnl / stats.count) * 100) / 100
      }
    }

    // Calibration
    defaultAccuracy.confidenceCalibration = {
      low: {
        count: calLow.total,
        winRate: calLow.total > 0
          ? Math.round((calLow.wins / calLow.total) * 100) / 100
          : 0,
      },
      medium: {
        count: calMed.total,
        winRate: calMed.total > 0
          ? Math.round((calMed.wins / calMed.total) * 100) / 100
          : 0,
      },
      high: {
        count: calHigh.total,
        winRate: calHigh.total > 0
          ? Math.round((calHigh.wins / calHigh.total) * 100) / 100
          : 0,
      },
    }

    logger.info('AI_ENGINE', `Decision accuracy computed: ${defaultAccuracy.winRate}% win rate over ${days} days`, {
      metadata: {
        days,
        totalDecisions: defaultAccuracy.totalDecisions,
        evaluatedDecisions: evaluatedCount,
        winRate: defaultAccuracy.winRate,
        avgConfidence: defaultAccuracy.avgConfidence,
        avgPnl: defaultAccuracy.avgPnlImpact,
      },
    })

    return defaultAccuracy
  } catch (err) {
    logger.error('AI_ENGINE', 'Decision accuracy calculation failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return defaultAccuracy
  }
}

// ============================================================================
// SECTION 13: DECISION HISTORY
// ============================================================================

/**
 * Retrieve decision history from the database.
 *
 * @param symbol - Optional symbol filter
 * @param limit - Maximum number of records (default 50)
 * @returns Array of DecisionLog records ordered by createdAt descending
 */
export async function getDecisionHistory(
  symbol?: string,
  limit: number = 50,
) {
  // Safety cap
  const safeLimit = Math.min(Math.max(limit, 1), 500)
  try {
    return await db.decisionLog.findMany({
      where: symbol ? { symbol } : undefined,
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    })
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to fetch decision history', {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
    return []
  }
}

// ============================================================================
// SECTION 14: OVERRIDE SYSTEM
// ============================================================================

/**
 * Override a previously logged decision.
 *
 * Marks the decision as overridden, records the new decision and reason,
 * and logs the override event for audit purposes.
 *
 * @param decisionId - ID of the DecisionLog to override
 * @param newDecision - The replacement decision type
 * @param reason - Human-readable explanation for the override
 */
export async function overrideDecision(
  decisionId: string,
  newDecision: DecisionType,
  reason: string,
): Promise<void> {
  try {
    const existing = await db.decisionLog.findUnique({
      where: { id: decisionId },
    })

    if (!existing) {
      logger.error('AI_ENGINE', `Cannot override: decision ${decisionId} not found`, {
        metadata: { decisionId, newDecision, reason },
      })
      return
    }

    await db.decisionLog.update({
      where: { id: decisionId },
      data: {
        overridden: true,
        overrideReason: reason,
        finalAction: newDecision,
      },
    })

    logger.info('AI_ENGINE', `Decision overridden: ${existing.decision} → ${newDecision} for ${existing.symbol}`, {
      symbol: existing.symbol,
      tradeId: decisionId,
      metadata: {
        originalDecision: existing.decision,
        newDecision,
        reason,
        originalConfidence: existing.confidence,
      },
    })
  } catch (err) {
    logger.error('AI_ENGINE', `Failed to override decision ${decisionId}`, {
      details: err instanceof Error ? err.message : String(err),
      tradeId: decisionId,
    })
  }
}
