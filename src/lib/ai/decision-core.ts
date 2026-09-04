import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { isLlmAvailable, runLlmMarketAnalysis } from '@/lib/ai-providers'
import { isMarketOpen, getTradingPhase } from '@/lib/mt5-connection'
import {
  DEFAULT_TIMEFRAME,
  BUY_THRESHOLD,
  SELL_THRESHOLD,
  HIGH_RISK_SCORE,
  MAX_BREAKING_NEWS,
  SL_MULTIPLIER,
  TP_MULTIPLIER,
  DEFAULT_ATR_PCT,
  ESTIMATED_ACCOUNT_VALUE,
  RISK_PER_TRADE_PCT,
  type DecisionType,
  type TechnicalFactors,
  type NewsFactors,
  type SentimentFactors,
  type RiskFactors,
  type AiDecision,
} from './types'
import { defaultTechnicalFactors, defaultNewsFactors, defaultSentimentFactors, defaultRiskFactors, noLlmEnhancement, toLlmEnhancement, clamp, mapRange, toJsonString } from './helpers'
import { analyzeTechnicalFactorsAsync } from './technical-synthesis'
import { analyzeNewsFactors } from './news-analysis'
import { analyzeSentimentFactors } from './sentiment'
import { analyzeRiskFactors } from './risk-context'
import { buildSignalSources } from './signal-tracking'
import { generateReasoning } from './reasoning'
import { getDecisionConfig } from './config'
import { classifyMarketCondition, getAdaptiveWeights, loadSelfLearningState, calibrateConfidence, type SelfLearningState } from './self-learning'

// ============================================================================
// SECTION 10: CORE DECISION ENGINE
// ============================================================================

/**
 * Make a trading decision for a single symbol.
 *
 * This is the primary entry point of the AI Decision Engine. It:
 *  1. Loads decision configuration from DB
 *  2. Checks cooldown period for the symbol
 *  3. Runs all four analyzers in parallel
 *  4. Computes weighted composite score
 *  5. Applies sentiment blocking, volatility scaling, and risk filters
 *  6. Determines final decision with confidence
 *  7. Calculates suggested SL/TP levels
 *  8. Logs the decision to the database
 *
 * @param symbol - Ticker symbol to decide on
 * @param timeframe - Chart timeframe (default 'H1')
 * @param precomputedRiskFactors - Optional pre-computed risk factors (Fix 5: for batch optimization)
 * @param useAdaptiveLearning - When true, uses adaptive weights + confidence calibration (request-scoped)
 * @returns Complete AiDecision with all factors and recommendations
 */
export async function makeDecision(
  symbol: string,
  timeframe: string = DEFAULT_TIMEFRAME,
  precomputedRiskFactors?: RiskFactors,
  useAdaptiveLearning?: boolean,
): Promise<AiDecision> {
  const now = new Date()

  // Default decision (safe fallback)
  const defaultDecision: AiDecision = {
    symbol,
    decision: 'HOLD',
    confidence: 0,
    reasoning: 'Failed to compute decision — defaulting to HOLD.',
    technicalFactors: defaultTechnicalFactors(),
    newsFactors: defaultNewsFactors(),
    sentimentFactors: defaultSentimentFactors(),
    riskFactors: defaultRiskFactors(),
    suggestedLotSize: 0,
    suggestedSl: 0,
    suggestedTp: 0,
    strategyUsed: 'AI_COMPOSITE',
    timeframe,
    signalSources: [],
    volatilityMultiplier: 1.0,
    llmEnhancement: noLlmEnhancement(),
    createdAt: now,
  }

  try {
    // --- Step 1: Load configuration ---
    let config = await getDecisionConfig()

    // --- Step 2: Check cooldown ---
    try {
      const cooldownCutoff = new Date(now.getTime() - config.cooldownSeconds * 1000)
      const lastDecision = await db.decisionLog.findFirst({
        where: {
          symbol,
          createdAt: { gte: cooldownCutoff },
        },
        orderBy: { createdAt: 'desc' },
      })

      if (lastDecision) {
        const remainingSec = Math.ceil(
          (config.cooldownSeconds * 1000 - (now.getTime() - lastDecision.createdAt.getTime())) / 1000,
        )
        logger.info('AI_ENGINE', `Decision cooldown active for ${symbol}, ${remainingSec}s remaining`, {
          symbol,
          metadata: { remainingSeconds: remainingSec, lastDecisionId: lastDecision.id },
        })

        defaultDecision.reasoning = `Cooldown active — ${remainingSec}s remaining since last decision.`
        defaultDecision.confidence = lastDecision.confidence as number
        return defaultDecision
      }
    } catch (err) {
      logger.error('AI_ENGINE', `Cooldown check failed for ${symbol}`, {
        details: err instanceof Error ? err.message : String(err),
        symbol,
      })
      // Continue with decision if cooldown check fails
    }

    // --- Step 3: Check market phase BEFORE running expensive analyzers ---
    // Fix #22: Check market hours before making decisions
    try {
      const phase = getTradingPhase()
      if (phase === 'CLOSED') {
        const closedDecision: AiDecision = {
          symbol,
          decision: 'HOLD',
          confidence: 0,
          reasoning: `Market is currently CLOSED (phase: ${phase}). No decisions made outside trading hours.`,
          technicalFactors: defaultTechnicalFactors(),
          newsFactors: defaultNewsFactors(),
          sentimentFactors: defaultSentimentFactors(),
          riskFactors: defaultRiskFactors(),
          suggestedLotSize: 0,
          suggestedSl: 0,
          suggestedTp: 0,
          strategyUsed: 'AI_COMPOSITE',
          timeframe,
          signalSources: [],
          volatilityMultiplier: 1.0,
          llmEnhancement: noLlmEnhancement(),
          createdAt: now,
        }
        return closedDecision
      }
    } catch {
      // If phase check fails, continue with decision
    }

    // --- Step 3.5: Run all analyzers in parallel ---
    // Fix #17: Use async technical analysis (real data from indicator-pool)
    // Fix 5 (Task 7): Use pre-computed risk factors if provided (batch optimization)
    const [technicalFactors, newsFactors, sentimentFactors, riskFactors] = await Promise.all([
      analyzeTechnicalFactorsAsync(symbol, timeframe),
      analyzeNewsFactors(symbol),
      analyzeSentimentFactors(symbol),
      precomputedRiskFactors ?? analyzeRiskFactors(),
    ])

    // --- Step 4: Weighted composite scoring ---
    // Self-learning: use adaptive weights if enabled and sufficient data exists
    let effectiveTechWeight = config.technicalWeight
    let effectiveNewsWeight = config.newsWeight
    let effectiveSentWeight = config.sentimentWeight
    let learningState: SelfLearningState | null = null

    if (useAdaptiveLearning) {
      try {
        const mc = classifyMarketCondition(technicalFactors, riskFactors.volatilityRegime)
        const adaptiveW = await getAdaptiveWeights(mc, config)
        effectiveTechWeight = adaptiveW.technical
        effectiveNewsWeight = adaptiveW.news
        effectiveSentWeight = adaptiveW.sentiment
        learningState = await loadSelfLearningState()
      } catch (err) {
        logger.error('AI_ENGINE', `Adaptive weights failed for ${symbol}, using base weights`, {
          details: err instanceof Error ? err.message : String(err),
          symbol,
        })
      }
    }

    const technicalScore = technicalFactors.overallScore * (effectiveTechWeight as number)
    const newsScore = newsFactors.newsImpactScore * (effectiveNewsWeight as number)
    const sentimentScore = sentimentFactors.symbolScore * (effectiveSentWeight as number)

    // Normalize: max possible is 100 * 1.0 = 100, min is -100 * 1.0 = -100
    const compositeScore = clamp(
      Math.round(technicalScore + newsScore + sentimentScore),
      -100,
      100,
    )

    // Confidence: distance from zero mapped to 0-100, adjusted by signal agreement
    const signalAgreement = technicalFactors.signals.filter(
      s => (compositeScore > 0 && s.score > 0) || (compositeScore < 0 && s.score < 0),
    ).length
    const totalSignals = technicalFactors.signals.length || 1
    const agreementRatio = signalAgreement / totalSignals
    let confidence = Math.round(mapRange(Math.abs(compositeScore), 0, 100, 20, 90) * (0.5 + agreementRatio * 0.5))

    // Fix #24 / Fix 2 (Task 7): Adjust confidence based on sentiment trend direction
    // Sentiment should SUPPORT the signal direction, not contradict it
    const sentTrendDir = (sentimentFactors as unknown as Record<string, unknown>).trendDirection as string | undefined
    if (sentTrendDir === 'DECLINING' && compositeScore > 0) {
      // Declining sentiment contradicts bullish signal → reduce confidence
      confidence = Math.max(20, Math.round(confidence * 0.85))
    } else if (sentTrendDir === 'IMPROVING' && compositeScore > 0) {
      // Improving sentiment supports bullish signal → boost confidence
      confidence = Math.min(95, Math.round(confidence * 1.1))
    } else if (sentTrendDir === 'IMPROVING' && compositeScore < 0) {
      // Improving sentiment contradicts bearish signal → reduce confidence
      confidence = Math.max(20, Math.round(confidence * 0.85))
    } else if (sentTrendDir === 'DECLINING' && compositeScore < 0) {
      // Declining sentiment supports bearish signal → boost confidence
      confidence = Math.min(95, Math.round(confidence * 1.1))
    }

    // --- Step 5: Sentiment filter block ---
    if (sentimentFactors.isBlocked && config.extremeSentimentBlock) {
      const blockedDecision: AiDecision = {
        symbol,
        decision: 'SKIP',
        confidence,
        reasoning: generateReasoning('SKIP', compositeScore, confidence, technicalFactors, newsFactors, sentimentFactors, riskFactors),
        technicalFactors,
        newsFactors,
        sentimentFactors,
        riskFactors,
        suggestedLotSize: 0,
        suggestedSl: 0,
        suggestedTp: 0,
        strategyUsed: 'AI_COMPOSITE',
        timeframe,
        signalSources: buildSignalSources(technicalFactors, newsFactors, sentimentFactors),
        volatilityMultiplier: 1.0,
        llmEnhancement: noLlmEnhancement(),
        createdAt: now,
      }
      await logDecisionToDb(blockedDecision, riskFactors, sentimentFactors)
      return blockedDecision
    }

    // --- Step 6: Volatility scaling ---
    let volatilityMultiplier = 1.0
    if (config.volatilityScalingEnabled) {
      if (riskFactors.volatilityRegime === 'HIGH_VOLATILITY') {
        volatilityMultiplier = 0.5 // Reduce confidence by 50%
      } else if (riskFactors.volatilityRegime === 'LOW_VOLATILITY') {
        volatilityMultiplier = 0.8 // Slight reduction in low vol
      }
      confidence = Math.round(confidence * volatilityMultiplier)
    }

    // --- Step 7: Determine decision ---
    let decision: DecisionType = 'HOLD'

    if (compositeScore > BUY_THRESHOLD && confidence > config.minConfidenceBuy) {
      decision = 'BUY'
    } else if (compositeScore < SELL_THRESHOLD && confidence > config.minConfidenceSell) {
      decision = 'SELL'
    }

    // Override: too many breaking news
    if (newsFactors.breakingNewsCount > MAX_BREAKING_NEWS) {
      decision = 'SKIP'
    }

    // Override: risk too high
    if (riskFactors.riskScore > HIGH_RISK_SCORE) {
      decision = 'SKIP'
    }

    // Fix 4 (Task 7): Override for extreme/elevated risk → REDUCE or CLOSE_ALL
    // Override: extreme risk → CLOSE_ALL if there are open positions
    if (riskFactors.riskScore >= 9 && riskFactors.openPositions > 0) {
      decision = 'CLOSE_ALL'
    }
    // Override: elevated risk with open positions → REDUCE
    else if (riskFactors.riskScore >= 7 && riskFactors.openPositions > 2) {
      decision = 'REDUCE'
    }
    // Override: consecutive losses → REDUCE position sizing
    else if (riskFactors.consecutiveLosses >= 4 && (decision === 'BUY' || decision === 'SELL')) {
      decision = 'REDUCE'
    }

    // --- Step 8: Calculate suggested SL/TP ---
    // Fix 3 (Task 7): Use real ATR if available, otherwise fall back to estimate
    const midPrice = (technicalFactors.supportLevel + technicalFactors.resistanceLevel) / 2
    const realAtr = technicalFactors.atrValue
    const atrPct = realAtr && realAtr > 0
      ? realAtr / (midPrice || 1)
      : DEFAULT_ATR_PCT

    let suggestedSl = 0
    let suggestedTp = 0
    let suggestedLotSize = 0.01

    if (decision === 'BUY' || decision === 'SELL') {
      const slDistance = midPrice * atrPct * SL_MULTIPLIER
      const tpDistance = midPrice * atrPct * TP_MULTIPLIER

      if (decision === 'BUY') {
        suggestedSl = Math.round((midPrice - slDistance) * 100) / 100
        suggestedTp = Math.round((midPrice + tpDistance) * 100) / 100
      } else {
        suggestedSl = Math.round((midPrice + slDistance) * 100) / 100
        suggestedTp = Math.round((midPrice - tpDistance) * 100) / 100
      }

      // Fix 6 (Task 7): Risk-based lot sizing: risk 1% of estimated account on this trade
      const riskAmount = ESTIMATED_ACCOUNT_VALUE * RISK_PER_TRADE_PCT

      if (suggestedSl > 0 && midPrice > 0) {
        const slDistanceVal = Math.abs(midPrice - suggestedSl)
        const slPct = slDistanceVal / midPrice
        if (slPct > 0) {
          // lotSize = riskAmount / (slDistance * 100)
          const rawLotSize = riskAmount / (slDistanceVal * 100)
          // Scale by confidence (0.5x to 1.0x)
          const confidenceScale = 0.5 + (confidence / 100) * 0.5
          suggestedLotSize = Math.round(rawLotSize * confidenceScale * 100) / 100
        }
      }
      // Clamp to reasonable range
      suggestedLotSize = clamp(suggestedLotSize, 0.01, 5.0)
    }

    // --- Step 9: Build signal sources ---
    const signalSources = buildSignalSources(technicalFactors, newsFactors, sentimentFactors)

    // --- Step 10: Generate reasoning ---
    const reasoning = generateReasoning(
      decision, compositeScore, confidence, technicalFactors, newsFactors, sentimentFactors, riskFactors,
    )

    // --- Step 10.5: Confidence calibration (self-learning) ---
    // Apply calibration feedback if adaptive learning is enabled and data exists
    if (useAdaptiveLearning && learningState) {
      confidence = calibrateConfidence(confidence, learningState)
    }

    // --- Step 10.8: LLM-Enhanced Analysis ---
    // If any AI provider is configured and enabled, get LLM perspective
    let llmEnhancement = noLlmEnhancement()
    try {
      const llmAvailable = await isLlmAvailable('market_analysis')
      if (llmAvailable) {
        const midPrice = (technicalFactors.supportLevel + technicalFactors.resistanceLevel) / 2 || 0
        const llmResult = await runLlmMarketAnalysis({
          symbol,
          price: midPrice,
          change: 0,
          technicalFactors,
          newsFactors,
          sentimentFactors,
        })
        llmEnhancement = toLlmEnhancement(llmResult)

        // If LLM provided a valid analysis, optionally adjust confidence
        if (llmResult.used && llmResult.marketAnalysis) {
          const llmAction = llmResult.marketAnalysis.action
          const llmConf = llmResult.marketAnalysis.confidence

          // If LLM agrees with our decision, boost confidence slightly
          if (
            (decision === 'BUY' && llmAction === 'BUY') ||
            (decision === 'SELL' && llmAction === 'SELL')
          ) {
            confidence = Math.min(95, Math.round(confidence * 1.05))
          }
          // If LLM strongly disagrees, reduce confidence
          else if (
            (decision === 'BUY' && llmAction === 'SELL') ||
            (decision === 'SELL' && llmAction === 'BUY')
          ) {
            confidence = Math.max(20, Math.round(confidence * 0.85))
          }

          logger.info('AI_ENGINE', `LLM enhancement for ${symbol}: ${llmResult.provider}/${llmResult.model} (${llmResult.latencyMs}ms) action=${llmAction} conf=${llmConf}`, {
            symbol,
            metadata: {
              llmProvider: llmResult.provider,
              llmModel: llmResult.model,
              llmLatencyMs: llmResult.latencyMs,
              llmAction,
              llmConfidence: llmConf,
              originalDecision: decision,
              adjustedConfidence: confidence,
            },
          })
        }
      }
    } catch (err) {
      logger.warn('AI_ENGINE', `LLM enhancement failed for ${symbol}, continuing without LLM`, {
        details: err instanceof Error ? err.message : String(err),
        symbol,
      })
    }

    const aiDecision: AiDecision = {
      symbol,
      decision,
      confidence,
      reasoning,
      technicalFactors,
      newsFactors,
      sentimentFactors,
      riskFactors,
      suggestedLotSize,
      suggestedSl,
      suggestedTp,
      strategyUsed: 'AI_COMPOSITE',
      timeframe,
      signalSources,
      volatilityMultiplier,
      llmEnhancement,
      createdAt: now,
    }

    // --- Step 11: Log decision to database ---
    await logDecisionToDb(aiDecision, riskFactors, sentimentFactors)

    logger.info('AI_ENGINE', `AI Decision: ${decision} ${symbol} (confidence=${confidence}%, composite=${compositeScore})`, {
      symbol,
      metadata: {
        decision,
        confidence,
        compositeScore,
        technicalScore: Math.round(technicalScore),
        newsScore: Math.round(newsScore),
        sentimentScore: Math.round(sentimentScore),
        riskScore: riskFactors.riskScore,
        signalSources,
        volatilityMultiplier,
        adaptiveLearning: useAdaptiveLearning ?? false,
        effectiveWeights: useAdaptiveLearning
          ? { technical: effectiveTechWeight, news: effectiveNewsWeight, sentiment: effectiveSentWeight }
          : undefined,
      },
    })

    return aiDecision
  } catch (err) {
    logger.error('AI_ENGINE', `Decision engine failed for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
      stackTrace: err instanceof Error ? err.stack : undefined,
    })
    return defaultDecision
  }
}

/**
 * Persist an AiDecision to the DecisionLog table.
 */
async function logDecisionToDb(
  decision: AiDecision,
  riskFactors: RiskFactors,
  sentimentFactors: SentimentFactors,
): Promise<void> {
  try {
    const factorsJson = toJsonString({
      technical: {
        trendDirection: decision.technicalFactors.trendDirection,
        trendStrength: decision.technicalFactors.trendStrength,
        rsiValue: decision.technicalFactors.rsiValue,
        macdSignal: decision.technicalFactors.macdSignal,
        overallScore: decision.technicalFactors.overallScore,
      },
      news: {
        impactScore: decision.newsFactors.newsImpactScore,
        articleCount: decision.newsFactors.recentNewsCount,
        breakingCount: decision.newsFactors.breakingNewsCount,
      },
      sentiment: {
        symbolScore: sentimentFactors.symbolScore,
        marketScore: sentimentFactors.marketScore,
        regime: sentimentFactors.regime,
      },
      risk: {
        riskScore: riskFactors.riskScore,
        volatilityRegime: riskFactors.volatilityRegime,
        openPositions: riskFactors.openPositions,
      },
    })

    await db.decisionLog.create({
      data: {
        symbol: decision.symbol,
        decision: decision.decision,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        factors: factorsJson,
        signalSources: toJsonString(decision.signalSources),
        riskScore: riskFactors.riskScore,
        sentimentScore: sentimentFactors.symbolScore,
        volatilityRegime: riskFactors.volatilityRegime,
        strategyUsed: decision.strategyUsed,
        timeframe: decision.timeframe,
        finalAction: decision.decision,
        overridden: false,
      },
    })
  } catch (err) {
    logger.error('AI_ENGINE', `Failed to log decision for ${decision.symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol: decision.symbol,
    })
  }
}
