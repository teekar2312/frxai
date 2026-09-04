import logger from '@/lib/trading-logger'
import { DEFAULT_TIMEFRAME, type AiDecision } from './types'
import { getDecisionConfig } from './config'
import { analyzeRiskFactors } from './risk-context'
import { makeDecision } from './decision-core'

// ============================================================================
// SECTION 11: BATCH DECISION PROCESSING
// ============================================================================

/**
 * Make decisions for multiple symbols simultaneously.
 *
 * Processes each symbol through the decision engine, sorts results by
 * confidence (descending), and respects the maxPositionsPerDecision
 * configuration limit — only returning the top N actionable decisions.
 *
 * Fix 5 (Task 7): Risk factors are computed ONCE and shared across all symbols,
 * since risk factors are portfolio-level (same for all symbols).
 *
 * @param symbols - Array of ticker symbols to analyze
 * @param timeframe - Chart timeframe (default 'H1')
 * @param useAdaptiveLearning - When true, uses adaptive weights + calibration for each decision
 * @returns Array of AiDecision sorted by confidence descending
 */
export async function makeBatchDecision(
  symbols: string[],
  timeframe: string = DEFAULT_TIMEFRAME,
  useAdaptiveLearning?: boolean,
): Promise<AiDecision[]> {
  try {
    const config = await getDecisionConfig()

    // Fix 5 (Task 7): Compute shared risk factors ONCE for the entire batch
    const sharedRiskFactors = await analyzeRiskFactors()

    // Process all symbols (sequentially to avoid DB contention)
    const decisions: AiDecision[] = []
    for (const symbol of symbols) {
      try {
        const decision = await makeDecision(symbol, timeframe, sharedRiskFactors, useAdaptiveLearning)
        decisions.push(decision)
      } catch (err) {
        logger.error('AI_ENGINE', `Batch decision failed for ${symbol}`, {
          details: err instanceof Error ? err.message : String(err),
          symbol,
        })
      }
    }

    // Sort by confidence descending
    decisions.sort((a, b) => b.confidence - a.confidence)

    // Count actionable decisions (BUY or SELL)
    let actionableCount = 0
    const filtered: AiDecision[] = []

    for (const decision of decisions) {
      if (decision.decision === 'BUY' || decision.decision === 'SELL') {
        if (actionableCount < config.maxPositionsPerDecision) {
          actionableCount++
          filtered.push(decision)
        } else {
          // Downgrade excess actionable decisions to HOLD
          filtered.push({
            ...decision,
            decision: 'HOLD',
            reasoning: `${decision.reasoning} [Downgraded to HOLD: max positions (${config.maxPositionsPerDecision}) reached]`,
          })
        }
      } else {
        filtered.push(decision)
      }
    }

    logger.info('AI_ENGINE', `Batch decision completed for ${symbols.length} symbols`, {
      metadata: {
        totalSymbols: symbols.length,
        actionableDecisions: actionableCount,
        maxAllowed: config.maxPositionsPerDecision,
        topDecision: filtered[0]
          ? `${filtered[0].decision} ${filtered[0].symbol} (${filtered[0].confidence}%)`
          : 'none',
      },
    })

    return filtered
  } catch (err) {
    logger.error('AI_ENGINE', 'Batch decision engine failed', {
      details: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}
