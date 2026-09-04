import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { MATCHING_WINDOW_MS, type TechnicalFactors, type MarketCondition } from './types'
import { clamp, safeJsonParse, toJsonString } from './helpers'
import { getDecisionConfig } from './config'

// ============================================================================
// SECTION 16: SELF-LEARNING MODULE
// ============================================================================

/** Half-life for exponential time-decay weighting (168 hours = 1 week) */
const DECAY_HALF_LIFE_HOURS = 168

/** EMA smoothing alpha for adaptive multipliers (0.7 = 70% old, 30% new) */
const ADAPTIVE_SMOOTHING_ALPHA = 0.7

/** Minimum decisions required before computing adaptive multipliers */
const MIN_DECISIONS_FOR_ADAPTIVE = 30

/** Minimum decisions per market condition before computing weight hints */
const MIN_DECISIONS_PER_MC = 15

/** Per-strategy performance entry for self-learning */
export interface StrategyPerformanceEntry {
  strategy: string
  totalTrades: number      // Raw integer count
  weightedTrades: number   // Time-decay weighted sum
  winRate: number           // Based on weighted values
  avgPnl: number
  bestMarketCondition: string
  worstMarketCondition: string
}

/** Confidence calibration bucket */
export interface CalibrationBucket {
  rangeStart: number
  rangeEnd: number
  count: number
  winRate: number
  calibrationFactor: number
}

/** Per-market-condition weight adjustment hints */
export interface MarketConditionWeightHint {
  technicalBoost: number
  newsBoost: number
  sentimentBoost: number
}

/** Complete self-learning state persisted in DB */
export interface SelfLearningState {
  /** Per-strategy win rates: strategy -> {wins, total, pnlSum, rawTotal?, rawWins?} */
  strategyStats: Record<string, { wins: number; total: number; pnlSum: number; rawTotal?: number; rawWins?: number }>
  /** Per (strategy, marketCondition) stats */
  strategyMarketStats: Record<string, { wins: number; total: number; pnlSum: number }>
  /** Confidence calibration: 10-point buckets from 0-100 (last bucket 90+ with rangeEnd=101) */
  calibrationBuckets: CalibrationBucket[]
  /** Per-market-condition weight hints */
  marketConditionWeights: Partial<Record<string, MarketConditionWeightHint>>
  /** Adaptive multipliers applied on top of base weights */
  adaptiveMultipliers: {
    technical: number
    news: number
    sentiment: number
  }
  /** Timestamp of last feedback loop run */
  lastUpdated: string
  /** Total decisions analyzed */
  totalAnalyzed: number
}

/** In-memory cache for self-learning state */
let selfLearningCache: {
  state: SelfLearningState | null
  loadedAt: number
} | null = null
const SELF_LEARNING_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** Default empty self-learning state */
function getDefaultSelfLearningState(): SelfLearningState {
  const buckets: CalibrationBucket[] = []
  for (let i = 0; i < 100; i += 10) {
    // Last bucket uses rangeEnd=101 so that confidence=100 is included (100 < 101)
    const rangeEnd = i === 90 ? 101 : i + 10
    buckets.push({ rangeStart: i, rangeEnd, count: 0, winRate: 0, calibrationFactor: 1.0 })
  }
  return {
    strategyStats: {},
    strategyMarketStats: {},
    calibrationBuckets: buckets,
    marketConditionWeights: {},
    adaptiveMultipliers: { technical: 1.0, news: 1.0, sentiment: 1.0 },
    lastUpdated: new Date().toISOString(),
    totalAnalyzed: 0,
  }
}

/** Persist self-learning state to DB via dedicated SystemConfig table */
async function persistSelfLearningState(state: SelfLearningState): Promise<void> {
  try {
    const jsonStr = toJsonString(state)
    await db.systemConfig.upsert({
      where: { key: '__self_learning_state__' },
      update: { value: jsonStr },
      create: { key: '__self_learning_state__', value: jsonStr },
    })
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to persist self-learning state', {
      details: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Load self-learning state from DB or return cached version */
export async function loadSelfLearningState(): Promise<SelfLearningState> {
  // Check in-memory cache first
  if (
    selfLearningCache
    && selfLearningCache.state
    && (Date.now() - selfLearningCache.loadedAt) < SELF_LEARNING_CACHE_TTL_MS
  ) {
    // Fix 3: Staleness warning even for cached state
    if (selfLearningCache.state.totalAnalyzed > 0) {
      const ageMs = Date.now() - new Date(selfLearningCache.state.lastUpdated).getTime()
      const ageHours = ageMs / (1000 * 60 * 60)
      if (ageHours > 24) {
        logger.warn('AI_ENGINE', `Self-learning state is stale (${Math.round(ageHours)}h since last update)`, {
          metadata: { ageHours: Math.round(ageHours), lastUpdated: selfLearningCache.state.lastUpdated, totalAnalyzed: selfLearningCache.state.totalAnalyzed },
        })
      }
    }
    return selfLearningCache.state
  }

  // One-time migration: check if old DecisionLog record exists
  try {
    const oldRecord = await db.decisionLog.findUnique({
      where: { id: '__self_learning_state__' },
    })
    if (oldRecord && oldRecord.factors) {
      const parsed = safeJsonParse(oldRecord.factors) as SelfLearningState | null
      if (parsed && parsed.calibrationBuckets && parsed.adaptiveMultipliers) {
        logger.info('AI_ENGINE', 'Migrating self-learning state from DecisionLog to SystemConfig')
        await db.systemConfig.upsert({
          where: { key: '__self_learning_state__' },
          update: { value: oldRecord.factors },
          create: { key: '__self_learning_state__', value: oldRecord.factors },
        })
        // Delete old record
        await db.decisionLog.delete({ where: { id: '__self_learning_state__' } }).catch(() => {})
        selfLearningCache = { state: parsed, loadedAt: Date.now() }
        return parsed
      }
    }
  } catch {
    // Migration failed, continue to SystemConfig path
  }

  // Load from SystemConfig
  try {
    const record = await db.systemConfig.findUnique({
      where: { key: '__self_learning_state__' },
    })
    if (record && record.value) {
      const parsed = safeJsonParse(record.value) as SelfLearningState | null
      if (parsed && parsed.calibrationBuckets && parsed.adaptiveMultipliers) {
        // Fix 3: Staleness warning
        if (parsed.totalAnalyzed > 0) {
          const ageMs = Date.now() - new Date(parsed.lastUpdated).getTime()
          const ageHours = ageMs / (1000 * 60 * 60)
          if (ageHours > 24) {
            logger.warn('AI_ENGINE', `Self-learning state is stale (${Math.round(ageHours)}h since last update)`, {
              metadata: { ageHours: Math.round(ageHours), lastUpdated: parsed.lastUpdated, totalAnalyzed: parsed.totalAnalyzed },
            })
          }
        }
        selfLearningCache = { state: parsed, loadedAt: Date.now() }
        return parsed
      }
    }
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to load self-learning state from DB', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  // Return default
  const defaultState = getDefaultSelfLearningState()
  selfLearningCache = { state: defaultState, loadedAt: Date.now() }
  return defaultState
}

/** Invalidate the in-memory cache (call after updating state) */
export function invalidateSelfLearningCache(): void {
  selfLearningCache = null
}

/**
 * Get adaptive weights based on current self-learning state.
 *
 * Reads the learning state, applies market-condition-specific boosts,
 * and returns { technical, news, sentiment } weights that sum to 1.0.
 * Falls back to base config weights if learning has insufficient data.
 *
 * @param currentMarketCondition - The current market condition label
 * @param baseConfig - The base AiDecisionConfig record
 * @returns Normalized weights { technical, news, sentiment }
 */
export async function getAdaptiveWeights(
  currentMarketCondition: string,
  baseConfig: Awaited<ReturnType<typeof getDecisionConfig>>,
): Promise<{ technical: number; news: number; sentiment: number }> {
  const state = await loadSelfLearningState()

  // Need minimum data before adjusting (at least 20 analyzed decisions)
  if (state.totalAnalyzed < 20) {
    return {
      technical: baseConfig.technicalWeight as number,
      news: baseConfig.newsWeight as number,
      sentiment: baseConfig.sentimentWeight as number,
    }
  }

  // Start with base weights * adaptive multipliers
  let tech = (baseConfig.technicalWeight as number) * state.adaptiveMultipliers.technical
  let news = (baseConfig.newsWeight as number) * state.adaptiveMultipliers.news
  let sent = (baseConfig.sentimentWeight as number) * state.adaptiveMultipliers.sentiment

  // Apply market-condition-specific boosts
  const condHint = state.marketConditionWeights[currentMarketCondition]
  if (condHint) {
    tech *= condHint.technicalBoost
    news *= condHint.newsBoost
    sent *= condHint.sentimentBoost
  }

  // Normalize to sum to 1.0
  const sum = tech + news + sent
  if (sum > 0) {
    tech = Math.round((tech / sum) * 100) / 100
    news = Math.round((news / sum) * 100) / 100
    sent = Math.round((sent / sum) * 100) / 100
  }

  // Fix any floating point drift
  const normalizedSum = tech + news + sent
  if (Math.abs(normalizedSum - 1.0) > 0.001) {
    const diff = 1.0 - normalizedSum
    if (tech >= news && tech >= sent) {
      tech = Math.round((tech + diff) * 100) / 100
    } else if (news >= sent) {
      news = Math.round((news + diff) * 100) / 100
    } else {
      sent = Math.round((sent + diff) * 100) / 100
    }
  }

  return { technical: tech, news: news, sentiment: sent }
}

/**
 * Calibrate a raw confidence value based on historical calibration data.
 *
 * If a confidence range (e.g. 70-80) historically only wins 40% of the time,
 * we apply a calibration factor to reduce the stated confidence.
 * This prevents overconfidence in systematically miscalibrated ranges.
 *
 * @param rawConfidence - The raw confidence (0-100)
 * @param state - The current self-learning state
 * @returns Calibrated confidence (0-100)
 */
export function calibrateConfidence(rawConfidence: number, state: SelfLearningState): number {
  if (!state || !state.calibrationBuckets || state.calibrationBuckets.length === 0) {
    return rawConfidence
  }

  const bucket = state.calibrationBuckets.find(
    b => rawConfidence >= b.rangeStart && rawConfidence < b.rangeEnd,
  )

  if (!bucket || bucket.count < 5) {
    // Not enough data in this bucket to calibrate
    return rawConfidence
  }

  // The ideal win rate for a given confidence level IS the confidence itself.
  // If 75% confidence only wins 45%, the factor should pull it down.
  const idealWinRate = (bucket.rangeStart + bucket.rangeEnd) / 2 / 100
  const actualWinRate = bucket.winRate / 100

  if (actualWinRate <= 0) return rawConfidence

  // Calibration factor: ratio of actual to ideal, clamped to [0.5, 1.0]
  // Don't inflate confidence, only reduce it when overconfident
  const rawFactor = actualWinRate / idealWinRate
  const factor = clamp(rawFactor, 0.5, 1.0)

  // Apply factor (soft — blend 70% raw + 30% calibrated to avoid jitter)
  const calibrated = rawConfidence * (0.7 + 0.3 * factor)
  return Math.round(clamp(calibrated, 0, 100))
}

/**
 * Update the self-learning state by analyzing recent decisions and trade outcomes.
 *
 * This is the core feedback loop:
 *  1. Load recent BUY/SELL decisions with their outcomes
 *  2. Compute per-strategy and per-(strategy, marketCondition) win rates
 *  3. Build confidence calibration map
 *  4. Compute adaptive weight multipliers based on factor performance
 *  5. Compute market-condition-specific weight hints
 *  6. Persist and cache the updated state
 *
 * @param days - How many days of history to analyze (default 30)
 * @returns Updated SelfLearningState
 */
export async function updateSelfLearningState(days: number = 30): Promise<SelfLearningState> {
  const state = getDefaultSelfLearningState()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Improvement 4: Load previous state for EMA smoothing of adaptive multipliers
  const previousState = await loadSelfLearningState()

  try {
    // --- Step 1: Load decisions and trades in batch ---
    const decisions = await db.decisionLog.findMany({
      where: {
        createdAt: { gte: since },
        decision: { in: ['BUY', 'SELL'] },
        id: { not: '__self_learning_state__' }, // Exclude system records
      },
      orderBy: { createdAt: 'desc' },
    })

    if (decisions.length === 0) {
      state.lastUpdated = new Date().toISOString()
      state.totalAnalyzed = 0
      selfLearningCache = { state, loadedAt: Date.now() }
      return state
    }

    // Batch-load all closed trades
    const tradeWindowStart = new Date(since.getTime() - MATCHING_WINDOW_MS)
    const allClosedTrades = await db.trade.findMany({
      where: {
        status: 'CLOSED',
        openTime: { gte: tradeWindowStart, lte: new Date() },
      },
      select: {
        symbol: true,
        direction: true,
        pnl: true,
        openTime: true,
        strategy: true,
      },
    })

    // --- Step 2: Match decisions to trades and build stats ---
    // Improvement 3: Use weighted accumulators for time-decay
    const strategyStats: Record<string, { wins: number; total: number; pnlSum: number; rawTotal: number; rawWins: number }> = {}
    const strategyMarketStats: Record<string, { wins: number; total: number; pnlSum: number }> = {}
    const calBuckets: Array<{ wins: number; total: number; rangeStart: number; rangeEnd: number }> = []
    for (let i = 0; i < 100; i += 10) {
      // Last bucket uses rangeEnd=101 so that confidence=100 is included (100 < 101)
      const rangeEnd = i === 90 ? 101 : i + 10
      calBuckets.push({ rangeStart: i, rangeEnd, wins: 0, total: 0 })
    }

    // Improvement 3: Weighted accumulators for factor correctness
    let techCorrect = 0; let techTotal = 0
    let newsCorrect = 0; let newsTotal = 0
    let sentCorrect = 0; let sentTotal = 0

    // Per-market-condition factor performance (weighted)
    const mcFactorPerf: Record<string, {
      techWins: number; techTotal: number
      newsWins: number; newsTotal: number
      sentWins: number; sentTotal: number
    }> = {}

    // Track per-market-condition decision count for Improvement 7
    const mcDecisionCounts: Record<string, number> = {}

    let totalMatched = 0

    for (const d of decisions) {
      const confidence = d.confidence as number
      const strategy = d.strategyUsed || 'AI_COMPOSITE'

      // Parse stored factors
      const factors = (safeJsonParse(d.factors) as Record<string, Record<string, unknown>>) || {}
      const techF = (factors.technical || {}) as Record<string, unknown>
      const newsF = (factors.news || {}) as Record<string, unknown>
      const sentF = (factors.sentiment || {}) as Record<string, unknown>
      const marketCondition = (d.volatilityRegime || 'NORMAL') as string

      // Determine outcome
      let pnl: number | null = null
      if (d.pnlImpact !== null && d.pnlImpact !== undefined) {
        pnl = d.pnlImpact as number
      } else {
        // Match in-memory
        // Fix 5: When multiple matches, pick the closest by openTime
        const decisionTime = d.createdAt.getTime()
        const matchCandidates = allClosedTrades.filter(
          t => t.symbol === d.symbol
            && t.direction === d.decision
            && t.openTime.getTime() >= decisionTime
            && t.openTime.getTime() <= decisionTime + MATCHING_WINDOW_MS,
        )
        if (matchCandidates.length > 0) {
          const closest = matchCandidates.reduce((best, t) => {
            const bestDist = Math.abs(best.openTime.getTime() - decisionTime)
            const tDist = Math.abs(t.openTime.getTime() - decisionTime)
            return tDist < bestDist ? t : best
          })
          pnl = closest.pnl
        }
      }

      if (pnl === null) continue // Can't evaluate
      totalMatched++
      const isWin = pnl > 0

      // Improvement 3: Compute time-decay weight based on decision age
      const decisionAgeHours = (Date.now() - d.createdAt.getTime()) / (1000 * 60 * 60)
      const weight = Math.exp(-decisionAgeHours / DECAY_HALF_LIFE_HOURS)

      // Update confidence calibration bucket (weighted)
      const bucketIdx = Math.min(Math.floor(confidence / 10), 9)
      if (calBuckets[bucketIdx]) {
        calBuckets[bucketIdx].total += weight
        if (isWin) calBuckets[bucketIdx].wins += weight
      }

      // Update strategy stats (weighted + raw)
      if (!strategyStats[strategy]) {
        strategyStats[strategy] = { wins: 0, total: 0, pnlSum: 0, rawTotal: 0, rawWins: 0 }
      }
      strategyStats[strategy].total += weight
      strategyStats[strategy].pnlSum += pnl * weight
      if (isWin) strategyStats[strategy].wins += weight
      // Fix 2: Track raw (unweighted) counts separately
      strategyStats[strategy].rawTotal = (strategyStats[strategy].rawTotal || 0) + 1
      if (isWin) strategyStats[strategy].rawWins = (strategyStats[strategy].rawWins || 0) + 1

      // Per (strategy, marketCondition) (weighted)
      const smKey = `${strategy}|${marketCondition}`
      if (!strategyMarketStats[smKey]) {
        strategyMarketStats[smKey] = { wins: 0, total: 0, pnlSum: 0 }
      }
      strategyMarketStats[smKey].total += weight
      strategyMarketStats[smKey].pnlSum += pnl * weight
      if (isWin) strategyMarketStats[smKey].wins += weight

      // Track per-MC decision count for minimum sample guard
      mcDecisionCounts[marketCondition] = (mcDecisionCounts[marketCondition] || 0) + 1

      // --- Improvement 6: Evaluate factors against OUTCOME direction, not decision agreement ---
      const decisionDir = d.decision === 'BUY' ? 1 : -1
      // The correct direction was the decision direction if trade won, opposite if lost
      const outcomeDir = isWin ? decisionDir : (decisionDir === 1 ? -1 : 1)

      // Technical score direction
      const techScore = (techF.overallScore as number) || 0
      const techDir = techScore > 0 ? 1 : techScore < 0 ? -1 : 0
      if (techDir !== 0) {
        techTotal += weight
        if (techDir === outcomeDir) techCorrect += weight
      }

      // News impact direction
      const newsScore = (newsF.impactScore as number) || 0
      const newsDir = newsScore > 0 ? 1 : newsScore < 0 ? -1 : 0
      if (newsDir !== 0) {
        newsTotal += weight
        if (newsDir === outcomeDir) newsCorrect += weight
      }

      // Sentiment direction
      const sentScore = (sentF.symbolScore as number) || 0
      const sentDir = sentScore > 0 ? 1 : sentScore < 0 ? -1 : 0
      if (sentDir !== 0) {
        sentTotal += weight
        if (sentDir === outcomeDir) sentCorrect += weight
      }

      // Per-market-condition factor performance (weighted, outcome-based)
      if (!mcFactorPerf[marketCondition]) {
        mcFactorPerf[marketCondition] = {
          techWins: 0, techTotal: 0,
          newsWins: 0, newsTotal: 0,
          sentWins: 0, sentTotal: 0,
        }
      }
      if (techDir !== 0) {
        mcFactorPerf[marketCondition].techTotal += weight
        if (techDir === outcomeDir) mcFactorPerf[marketCondition].techWins += weight
      }
      if (newsDir !== 0) {
        mcFactorPerf[marketCondition].newsTotal += weight
        if (newsDir === outcomeDir) mcFactorPerf[marketCondition].newsWins += weight
      }
      if (sentDir !== 0) {
        mcFactorPerf[marketCondition].sentTotal += weight
        if (sentDir === outcomeDir) mcFactorPerf[marketCondition].sentWins += weight
      }
    }

    // --- Step 3: Build calibration buckets ---
    state.calibrationBuckets = calBuckets.map(b => {
      const winRate = b.total > 0 ? Math.round((b.wins / b.total) * 100) / 100 : 0
      const idealWinRate = (b.rangeStart + b.rangeEnd) / 2 / 100
      let factor = 1.0
      if (b.total >= 5 && idealWinRate > 0) {
        const rawFactor = (winRate / 100) / idealWinRate
        factor = clamp(rawFactor, 0.5, 1.0)
      }
      return {
        rangeStart: b.rangeStart,
        rangeEnd: b.rangeEnd,
        count: b.total,
        winRate,
        calibrationFactor: Math.round(factor * 100) / 100,
      }
    })

    // --- Step 4: Compute adaptive multipliers based on factor correctness ---
    // Improvement 7: Only compute adaptive multipliers if minimum sample size is met
    if (totalMatched >= MIN_DECISIONS_FOR_ADAPTIVE) {
      const baseTechRate = techTotal > 0 ? techCorrect / techTotal : 0.5
      const baseNewsRate = newsTotal > 0 ? newsCorrect / newsTotal : 0.5
      const baseSentRate = sentTotal > 0 ? sentCorrect / sentTotal : 0.5
      const avgRate = (baseTechRate + baseNewsRate + baseSentRate) / 3

      const newMultipliers = {
        technical: Math.round(clamp(baseTechRate / (avgRate || 0.5), 0.7, 1.3) * 100) / 100,
        news: Math.round(clamp(baseNewsRate / (avgRate || 0.5), 0.7, 1.3) * 100) / 100,
        sentiment: Math.round(clamp(baseSentRate / (avgRate || 0.5), 0.7, 1.3) * 100) / 100,
      }

      // Improvement 4: EMA smoothing between old and new multipliers
      const old = previousState.adaptiveMultipliers
      state.adaptiveMultipliers = {
        technical: Math.round((old.technical * ADAPTIVE_SMOOTHING_ALPHA + newMultipliers.technical * (1 - ADAPTIVE_SMOOTHING_ALPHA)) * 100) / 100,
        news: Math.round((old.news * ADAPTIVE_SMOOTHING_ALPHA + newMultipliers.news * (1 - ADAPTIVE_SMOOTHING_ALPHA)) * 100) / 100,
        sentiment: Math.round((old.sentiment * ADAPTIVE_SMOOTHING_ALPHA + newMultipliers.sentiment * (1 - ADAPTIVE_SMOOTHING_ALPHA)) * 100) / 100,
      }
    } else {
      // Improvement 7: Not enough data — keep previous adaptive multipliers
      logger.warn('AI_ENGINE', `Insufficient decisions for adaptive multipliers: ${totalMatched} < ${MIN_DECISIONS_FOR_ADAPTIVE}`, {
        metadata: { totalMatched, required: MIN_DECISIONS_FOR_ADAPTIVE },
      })
      state.adaptiveMultipliers = { ...previousState.adaptiveMultipliers }
    }

    // --- Step 5: Compute market-condition weight hints ---
    // Improvement 7: Only compute weight hints for MCs with minimum sample size
    const mcWeights: Partial<Record<string, MarketConditionWeightHint>> = {}
    for (const [mc, perf] of Object.entries(mcFactorPerf)) {
      const mcTotal = (mcDecisionCounts[mc] || 0)
      if (mcTotal < MIN_DECISIONS_PER_MC) {
        logger.warn('AI_ENGINE', `Insufficient decisions for MC weight hints: ${mc} has ${mcTotal} < ${MIN_DECISIONS_PER_MC}`, {
          metadata: { marketCondition: mc, total: mcTotal, required: MIN_DECISIONS_PER_MC },
        })
        // Keep previous weight hint for this MC if it existed
        if (previousState.marketConditionWeights[mc]) {
          mcWeights[mc] = previousState.marketConditionWeights[mc]
        }
        continue
      }

      const mcTechRate = perf.techTotal > 0 ? perf.techWins / perf.techTotal : 0.5
      const mcNewsRate = perf.newsTotal > 0 ? perf.newsWins / perf.newsTotal : 0.5
      const mcSentRate = perf.sentTotal > 0 ? perf.sentWins / perf.sentTotal : 0.5
      const mcAvg = (mcTechRate + mcNewsRate + mcSentRate) / 3

      if (mcAvg <= 0) continue

      mcWeights[mc] = {
        technicalBoost: Math.round(clamp(mcTechRate / (mcAvg || 0.5), 0.8, 1.2) * 100) / 100,
        newsBoost: Math.round(clamp(mcNewsRate / (mcAvg || 0.5), 0.8, 1.2) * 100) / 100,
        sentimentBoost: Math.round(clamp(mcSentRate / (mcAvg || 0.5), 0.8, 1.2) * 100) / 100,
      }
    }
    state.marketConditionWeights = mcWeights

    // --- Step 6: Store stats ---
    state.strategyStats = strategyStats
    state.strategyMarketStats = strategyMarketStats
    state.totalAnalyzed = totalMatched
    state.lastUpdated = new Date().toISOString()

    // --- Step 7: Persist and cache ---
    selfLearningCache = { state, loadedAt: Date.now() }
    await persistSelfLearningState(state)

    logger.info('AI_ENGINE', `Self-learning state updated: ${totalMatched} decisions analyzed`, {
      metadata: {
        totalAnalyzed: totalMatched,
        adaptiveMultipliers: state.adaptiveMultipliers,
        marketConditions: Object.keys(mcWeights),
        strategies: Object.keys(strategyStats),
      },
    })

    return state
  } catch (err) {
    logger.error('AI_ENGINE', 'Self-learning state update failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return state
  }
}

/**
 * Get per-strategy performance statistics.
 *
 * @param days - Number of days to look back (default 30)
 * @returns Array of StrategyPerformanceEntry sorted by win rate descending
 */
export async function getStrategyPerformance(days: number = 30): Promise<StrategyPerformanceEntry[]> {
  const state = await loadSelfLearningState()
  const results: StrategyPerformanceEntry[] = []

  // If we have self-learning data, use it directly
  if (state.totalAnalyzed > 0 && Object.keys(state.strategyStats).length > 0) {
    for (const [strategy, stats] of Object.entries(state.strategyStats)) {
      let bestMc = 'NORMAL'
      let worstMc = 'NORMAL'
      let bestWr = -1
      let worstWr = 2

      for (const [key, mcStats] of Object.entries(state.strategyMarketStats)) {
        if (!key.startsWith(`${strategy}|`)) continue
        const mc = key.slice(strategy.length + 1)
        const wr = mcStats.total > 0 ? mcStats.wins / mcStats.total : 0
        if (wr > bestWr) { bestWr = wr; bestMc = mc }
        if (wr < worstWr) { worstWr = wr; worstMc = mc }
      }

      results.push({
        strategy,
        totalTrades: stats.rawTotal || Math.round(stats.total),
        weightedTrades: Math.round(stats.total * 100) / 100,
        winRate: stats.total > 0
          ? Math.round((stats.wins / stats.total) * 100) / 100
          : 0,
        avgPnl: stats.total > 0
          ? Math.round((stats.pnlSum / stats.total) * 100) / 100
          : 0,
        bestMarketCondition: bestMc,
        worstMarketCondition: worstMc,
      })
    }

    return results.sort((a, b) => b.winRate - a.winRate)
  }

  // Fallback: compute directly from DB
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const decisions = await db.decisionLog.findMany({
      where: {
        createdAt: { gte: since },
        decision: { in: ['BUY', 'SELL'] },
        id: { not: '__self_learning_state__' }, // Exclude system records
      },
    })

    const tradeWindowStart = new Date(since.getTime() - MATCHING_WINDOW_MS)
    const allTrades = await db.trade.findMany({
      where: { status: 'CLOSED', openTime: { gte: tradeWindowStart } },
      select: { symbol: true, direction: true, pnl: true, openTime: true },
    })

    const stratMap = new Map<string, {
      wins: number; total: number; pnlSum: number
      mcMap: Record<string, { wins: number; total: number }>
    }>()

    for (const d of decisions) {
      const strategy = d.strategyUsed || 'AI_COMPOSITE'
      const mc = d.volatilityRegime || 'NORMAL'

      let pnl: number | null = null
      if (d.pnlImpact !== null && d.pnlImpact !== undefined) {
        pnl = d.pnlImpact as number
      } else {
        const dt = d.createdAt.getTime()
        const matched = allTrades.find(
          t => t.symbol === d.symbol && t.direction === d.decision
            && t.openTime.getTime() >= dt && t.openTime.getTime() <= dt + MATCHING_WINDOW_MS,
        )
        if (matched) pnl = matched.pnl
      }
      if (pnl === null) continue

      if (!stratMap.has(strategy)) {
        stratMap.set(strategy, { wins: 0, total: 0, pnlSum: 0, mcMap: {} })
      }
      const entry = stratMap.get(strategy)!
      entry.total++
      entry.pnlSum += pnl
      if (pnl > 0) entry.wins++
      if (!entry.mcMap[mc]) entry.mcMap[mc] = { wins: 0, total: 0 }
      entry.mcMap[mc].total++
      if (pnl > 0) entry.mcMap[mc].wins++
    }

    for (const [strategy, stats] of stratMap.entries()) {
      let bestMc = 'NORMAL'; let worstMc = 'NORMAL'
      let bestWr = -1; let worstWr = 2
      for (const [mc, mcStats] of Object.entries(stats.mcMap)) {
        const wr = mcStats.total > 0 ? mcStats.wins / mcStats.total : 0
        if (wr > bestWr) { bestWr = wr; bestMc = mc }
        if (wr < worstWr) { worstWr = wr; worstMc = mc }
      }
      results.push({
        strategy,
        totalTrades: stats.total,
        weightedTrades: stats.total, // No decay in DB fallback path
        winRate: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) / 100 : 0,
        avgPnl: stats.total > 0 ? Math.round((stats.pnlSum / stats.total) * 100) / 100 : 0,
        bestMarketCondition: bestMc,
        worstMarketCondition: worstMc,
      })
    }

    return results.sort((a, b) => b.winRate - a.winRate)
  } catch (err) {
    logger.error('AI_ENGINE', 'Strategy performance fetch failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

/**
 * Run the full feedback loop: update self-learning state from recent history.
 *
 * This is the main entry point for periodic self-learning. It:
 *  1. Calls updateSelfLearningState() to recompute all adaptive parameters
 *  2. Returns the updated state for inspection
 *
 * Should be called periodically (e.g., every 30 minutes) by a scheduler
 * or manually via the POST /api/ai/accuracy endpoint.
 *
 * @param days - Days of history to analyze (default 30)
 * @returns Updated SelfLearningState
 */
export async function runFeedbackLoop(days: number = 30): Promise<SelfLearningState> {
  logger.info('AI_ENGINE', `Running self-learning feedback loop (last ${days} days)`, {
    metadata: { days },
  })
  const state = await updateSelfLearningState(days)
  logger.info('AI_ENGINE', 'Feedback loop complete', {
    metadata: {
      totalAnalyzed: state.totalAnalyzed,
      adaptiveMultipliers: state.adaptiveMultipliers,
      strategiesTracked: Object.keys(state.strategyStats).length,
      marketConditionsTracked: Object.keys(state.marketConditionWeights).length,
    },
  })
  return state
}

/**
 * Determine the market condition classification from technical factors.
 *
 * Maps technical analysis signals to a MarketCondition label used by
 * the self-learning system for strategy-level performance tracking.
 *
 * @param tech - Technical factors
 * @param riskVolatilityRegime - Volatility regime from risk factors
 * @returns MarketCondition label
 */
export function classifyMarketCondition(
  tech: TechnicalFactors,
  riskVolatilityRegime: string,
): MarketCondition {
  if (riskVolatilityRegime === 'HIGH_VOLATILITY') return 'HIGH_VOLATILITY'
  if (riskVolatilityRegime === 'LOW_VOLATILITY') return 'LOW_VOLATILITY'
  if (tech.adxValue > 25 && tech.trendStrength > 40) return 'TRENDING'
  if (tech.adxValue < 20 && tech.trendStrength < 30) return 'RANGE_BOUND'
  return 'NORMAL'
}
