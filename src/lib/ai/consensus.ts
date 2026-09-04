import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { fetchCandles, computeStrategySignal, calculateRSI, calculateMACD, calculateBollingerBands, calculateATR, type StrategySignal } from '@/lib/indicator-pool'
import { STRATEGY_REGISTRY, DEFAULT_TIMEFRAME, SL_MULTIPLIER, TP_MULTIPLIER, type StrategyBreakdown, type StrategyPerformance, type DecisionType, type AiDecision } from './types'
import { defaultTechnicalFactors, defaultNewsFactors, defaultSentimentFactors, defaultRiskFactors, noLlmEnhancement, toJsonString } from './helpers'

// ============================================================================
// SECTION 7.5: MULTI-STRATEGY CONSENSUS DECISION ENGINE
// ============================================================================

/**
 * Parameters for the multi-strategy consensus decision function.
 */
export interface MultiStrategyParams {
  symbol: string
  timeframe?: string
  enabledStrategies?: string[]
}

/**
 * Make a trading decision using weighted multi-strategy consensus.
 *
 * Runs all enabled strategies (or all 7 by default), collects their BUY/SELL/NEUTRAL
 * signals, computes a weighted consensus score, and produces a final AiDecision.
 *
 * Decision logic:
 *  - consensus > 0.3 * maxPossibleScore → BUY
 *  - consensus < -0.3 * maxPossibleScore → SELL
 *  - otherwise → HOLD
 *
 * Confidence = percentage of agreeing strategies × average confidence of agreeing strategies.
 *
 * @param params - Symbol, optional timeframe, optional list of enabled strategy IDs
 * @returns Complete AiDecision with multi-strategy consensus
 */
export async function makeMultiStrategyDecision(
  params: MultiStrategyParams,
): Promise<AiDecision> {
  const { symbol, timeframe: requestedTimeframe, enabledStrategies } = params
  const now = new Date()
  const effectiveTimeframe = requestedTimeframe || DEFAULT_TIMEFRAME

  // Default decision (safe fallback)
  const defaultDecision: AiDecision = {
    symbol,
    decision: 'HOLD',
    confidence: 0,
    reasoning: 'Multi-strategy consensus failed — defaulting to HOLD.',
    technicalFactors: defaultTechnicalFactors(),
    newsFactors: defaultNewsFactors(),
    sentimentFactors: defaultSentimentFactors(),
    riskFactors: defaultRiskFactors(),
    suggestedLotSize: 0,
    suggestedSl: 0,
    suggestedTp: 0,
    strategyUsed: 'MULTI_STRATEGY',
    timeframe: effectiveTimeframe,
    signalSources: [],
    volatilityMultiplier: 1.0,
    llmEnhancement: noLlmEnhancement(),
    createdAt: now,
  }

  try {
    // Determine which strategies to run
    const strategies = enabledStrategies
      ? STRATEGY_REGISTRY.filter((s) => enabledStrategies.includes(s.id))
      : [...STRATEGY_REGISTRY]

    if (strategies.length === 0) {
      logger.warn('AI_ENGINE', 'No valid strategies enabled for multi-strategy decision', {
        symbol,
        metadata: { requestedStrategies: enabledStrategies },
      })
      return defaultDecision
    }

    // Fetch candles — use the maximum minBars across all strategies
    const maxBars = Math.max(...strategies.map((s) => s.minBars), 100)
    const candles = await fetchCandles(symbol, effectiveTimeframe, maxBars)

    if (!candles || candles.length < 30) {
      logger.warn('AI_ENGINE', `Insufficient candles for multi-strategy decision on ${symbol}`, {
        metadata: { symbol, timeframe: effectiveTimeframe, barCount: candles?.length ?? 0 },
      })
      return defaultDecision
    }

    // Compute signal for each strategy
    const breakdowns: StrategyBreakdown[] = []
    let bestStrategy: StrategyBreakdown | null = null

    for (const strategy of strategies) {
      try {
        const signal: StrategySignal = computeStrategySignal(strategy.id, candles)
        const direction = signal.signal === 'BUY' ? 1 : signal.signal === 'SELL' ? -1 : 0
        const weightedScore = direction * strategy.weight * (signal.confidence / 100)

        const breakdown: StrategyBreakdown = {
          strategyId: strategy.id,
          strategyName: strategy.name,
          signal: signal.signal,
          confidence: signal.confidence,
          weight: strategy.weight,
          weightedScore,
        }

        breakdowns.push(breakdown)

        // Track the highest-confidence non-neutral strategy as "primary"
        if (signal.signal !== 'NEUTRAL') {
          if (!bestStrategy || signal.confidence > bestStrategy.confidence) {
            bestStrategy = breakdown
          }
        }
      } catch (err) {
        logger.warn('AI_ENGINE', `Strategy ${strategy.id} failed in multi-strategy consensus`, {
          metadata: { symbol, strategyId: strategy.id, details: err instanceof Error ? err.message : String(err) },
        })
        // Record as neutral on failure
        breakdowns.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          signal: 'NEUTRAL',
          confidence: 0,
          weight: strategy.weight,
          weightedScore: 0,
        })
      }
    }

    // Calculate consensus score
    const consensusScore = breakdowns.reduce((sum, b) => sum + b.weightedScore, 0)
    const maxPossibleScore = strategies.reduce((sum, s) => sum + s.weight, 0)
    const threshold = 0.3 * maxPossibleScore

    // Determine final decision direction
    let decision: DecisionType = 'HOLD'
    if (consensusScore > threshold) {
      decision = 'BUY'
    } else if (consensusScore < -threshold) {
      decision = 'SELL'
    }

    // Calculate confidence: % of agreeing strategies × their avg confidence
    const agreeingStrategies = breakdowns.filter(
      (b) => decision === 'BUY' ? b.signal === 'BUY' : decision === 'SELL' ? b.signal === 'SELL' : true,
    )
    const agreeRatio = agreeingStrategies.length / strategies.length
    const avgConfidenceOfAgreeing = agreeingStrategies.length > 0
      ? agreeingStrategies.reduce((sum, b) => sum + b.confidence, 0) / agreeingStrategies.length
      : 0
    const finalConfidence = Math.min(100, Math.round(agreeRatio * avgConfidenceOfAgreeing))

    // Determine primary strategy for strategyUsed field
    const primaryStrategy = bestStrategy?.strategyId || 'MULTI_STRATEGY'

    // Build reasoning string
    const buyStrategies = breakdowns.filter((b) => b.signal === 'BUY')
    const sellStrategies = breakdowns.filter((b) => b.signal === 'SELL')
    const neutralStrategies = breakdowns.filter((b) => b.signal === 'NEUTRAL')

    const reasoning = [
      `Multi-strategy consensus: ${decision} (score: ${consensusScore.toFixed(3)}, threshold: ±${threshold.toFixed(3)})`,
      `BUY: [${buyStrategies.map((b) => `${b.strategyName}(${b.confidence}%)`).join(', ')}]`,
      `SELL: [${sellStrategies.map((b) => `${b.strategyName}(${b.confidence}%)`).join(', ')}]`,
      `NEUTRAL: [${neutralStrategies.map((b) => `${b.strategyName}(${b.confidence}%)`).join(', ')}]`,
      `Confidence: ${finalConfidence}% (${agreeRatio.toFixed(0)}% agreement, avg ${Math.round(avgConfidenceOfAgreeing)}% confidence)`,
      `Primary strategy: ${primaryStrategy}`,
    ].join(' | ')

    // Log the per-strategy breakdown
    logger.info('AI_ENGINE', `Multi-strategy decision for ${symbol}`, {
      metadata: {
        symbol,
        timeframe: effectiveTimeframe,
        decision,
        consensusScore: consensusScore.toFixed(3),
        maxPossibleScore: maxPossibleScore.toFixed(3),
        threshold: threshold.toFixed(3),
        confidence: finalConfidence,
        primaryStrategy,
        strategiesRun: strategies.length,
        breakdown: breakdowns.map((b) => ({
          id: b.strategyId,
          signal: b.signal,
          confidence: b.confidence,
          weight: b.weight,
          weightedScore: +b.weightedScore.toFixed(3),
        })),
      },
    })

    // Compute basic technical factors from candles for the AiDecision shape
    const closes = candles.map((c) => c.close)
    const currentPrice = closes[closes.length - 1]
    const rsiValue = calculateRSI(closes, 14) ?? 50
    const macdResult = calculateMACD(closes)
    const bollResult = calculateBollingerBands(closes, 20, 2)
    const atrValue = calculateATR(candles, 14)

    const aiDecision: AiDecision = {
      symbol,
      decision,
      confidence: finalConfidence,
      reasoning,
      technicalFactors: {
        trendDirection: consensusScore > threshold ? 'UP' : consensusScore < -threshold ? 'DOWN' : 'SIDEWAYS',
        trendStrength: Math.min(100, Math.abs(consensusScore / maxPossibleScore) * 100),
        rsiValue,
        rsiSignal: rsiValue > 70 ? 'OVERBOUGHT' : rsiValue < 30 ? 'OVERSOLD' : 'NEUTRAL',
        macdSignal: (macdResult.histogram ?? 0) > 0 ? 'BULLISH' : (macdResult.histogram ?? 0) < 0 ? 'BEARISH' : 'NEUTRAL',
        macdHistogram: macdResult.histogram ?? 0,
        bollingerPosition: bollResult && bollResult.upper != null && currentPrice > bollResult.upper ? 'ABOVE_UPPER'
          : bollResult && bollResult.lower != null && currentPrice < bollResult.lower ? 'BELOW_LOWER'
          : 'MIDDLE',
        supportLevel: bollResult?.lower ?? 0,
        resistanceLevel: bollResult?.upper ?? 0,
        volumeTrend: 'NORMAL',
        adxValue: 0,
        stochasticSignal: 'NEUTRAL',
        overallScore: consensusScore > 0 ? Math.min(100, (consensusScore / maxPossibleScore) * 100) : 0,
        signals: breakdowns.map((b) => ({
          name: b.strategyName,
          signal: b.signal,
          weight: b.weight,
          score: b.weightedScore,
        })),
        atrValue,
      },
      newsFactors: defaultNewsFactors(),
      sentimentFactors: defaultSentimentFactors(),
      riskFactors: defaultRiskFactors(),
      suggestedLotSize: 0,
      suggestedSl: atrValue ? currentPrice - atrValue * SL_MULTIPLIER : 0,
      suggestedTp: atrValue ? currentPrice + atrValue * TP_MULTIPLIER : 0,
      strategyUsed: primaryStrategy,
      timeframe: effectiveTimeframe,
      signalSources: strategies.map((s) => s.id),
      volatilityMultiplier: 1.0,
      llmEnhancement: noLlmEnhancement(),
      createdAt: now,
    }

    // Persist to DecisionLog
    try {
      await db.decisionLog.create({
        data: {
          symbol: aiDecision.symbol,
          decision: aiDecision.decision,
          confidence: aiDecision.confidence,
          reasoning: aiDecision.reasoning,
          factors: toJsonString({
            multiStrategy: {
              consensusScore: consensusScore.toFixed(3),
              maxPossibleScore: maxPossibleScore.toFixed(3),
              threshold: threshold.toFixed(3),
              breakdown: breakdowns.map((b) => ({
                id: b.strategyId,
                signal: b.signal,
                confidence: b.confidence,
                weightedScore: Number(b.weightedScore),
              })),
            },
          }),
          signalSources: toJsonString(aiDecision.signalSources),
          riskScore: 0,
          sentimentScore: 0,
          volatilityRegime: 'NORMAL',
          strategyUsed: aiDecision.strategyUsed,
          timeframe: aiDecision.timeframe,
          finalAction: aiDecision.decision,
          overridden: false,
        },
      })
    } catch (dbErr) {
      logger.error('AI_ENGINE', `Failed to log multi-strategy decision for ${symbol}`, {
        details: dbErr instanceof Error ? dbErr.message : String(dbErr),
        symbol,
      })
    }

    return aiDecision
  } catch (err) {
    logger.error('AI_ENGINE', `Multi-strategy decision engine failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
      stackTrace: err instanceof Error ? err.stack : undefined,
    })
    return defaultDecision
  }
}

// ============================================================================
// SECTION 7.6: STRATEGY PERFORMANCE TRACKER
// ============================================================================

/**
 * Retrieve performance statistics for a specific strategy over the last N days.
 *
 * Queries the DecisionLog table for decisions attributed to the given strategy
 * and computes aggregate statistics including win rate, accuracy, and P&L.
 *
 * @param strategyId - The strategy ID to query (e.g. 'ma-ribbon', 'momentum-scalp')
 * @param days - Number of days to look back (default 30)
 * @returns Strategy performance summary
 */
export async function getSingleStrategyPerformance(
  strategyId: string,
  days: number = 30,
): Promise<StrategyPerformance> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const empty: StrategyPerformance = {
    strategyId,
    totalDecisions: 0,
    buyCount: 0,
    sellCount: 0,
    holdCount: 0,
    avgConfidence: 0,
    accuracy: null,
    totalPnl: null,
  }

  try {
    const logs = await db.decisionLog.findMany({
      where: {
        strategyUsed: strategyId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (logs.length === 0) {
      logger.info('AI_ENGINE', `No decision logs found for strategy ${strategyId} in last ${days} days`)
      return empty
    }

    let buyCount = 0
    let sellCount = 0
    let holdCount = 0
    let totalConfidence = 0
    let pnlCount = 0
    let totalPnl = 0
    let correctCount = 0

    for (const log of logs) {
      if (log.decision === 'BUY') buyCount++
      else if (log.decision === 'SELL') sellCount++
      else holdCount++

      totalConfidence += log.confidence

      if (log.pnlImpact !== null && log.pnlImpact !== undefined) {
        pnlCount++
        totalPnl += log.pnlImpact
        if (log.pnlImpact > 0) correctCount++
      }
    }

    const accuracy = pnlCount > 0 ? (correctCount / pnlCount) * 100 : null

    const result: StrategyPerformance = {
      strategyId,
      totalDecisions: logs.length,
      buyCount,
      sellCount,
      holdCount,
      avgConfidence: Math.round((totalConfidence / logs.length) * 100) / 100,
      accuracy: accuracy !== null ? Math.round(accuracy * 100) / 100 : null,
      totalPnl: pnlCount > 0 ? Math.round(totalPnl * 100) / 100 : null,
    }

    logger.info('AI_ENGINE', `Strategy performance for ${strategyId} (last ${days}d)`, {
      metadata: { ...result },
    })

    return result
  } catch (err) {
    logger.error('AI_ENGINE', `Failed to get strategy performance for ${strategyId}`, {
      details: err instanceof Error ? err.message : String(err),
    })
    return empty
  }
}
