/*
 * Trade Execution Engine — PART 8/10: price-pipeline.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 1800-2007):
 *   - PRICE UPDATE PIPELINE / ORCHESTRATOR (PriceUpdateResult,
 *     evaluatePriceAlerts, processPriceUpdate) — wires together the trailing
 *     stop, SL/TP trigger and partial close engines plus price alerts.
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { processTrailingStopsForAllTrades } from './trailing-stop'
import { processSlTpForAllOpenTrades } from './trigger-engine'
import { checkPartialCloseTriggers } from './partial-close'

// ============================================
// PRICE UPDATE PIPELINE (ORCHESTRATOR)
// ============================================

/** Result of a price update pipeline run. */
export interface PriceUpdateResult {
  trailingAdjusted: number
  trailingCooldownBlocked: number
  trailingPhaseBlocked: number
  trailingMaxCapHit: number
  slTriggered: number
  tpTriggered: number
  partialCloses: number
  errors: number
  durationMs: number
  triggeredAlerts: Array<{ id: string; symbol: string; condition: string; price: number; triggeredAt: Date }>
}

/**
 * Evaluate all active price alerts against current prices.
 * For each triggered alert, atomically mark it as triggered in DB (using
 * updateMany with a precondition to prevent duplicate triggers) and return
 * the triggered alerts.
 *
 * CROSS_UP / CROSS_DOWN require previous prices to detect actual crossings.
 * If previousPrices is not provided, CROSS_UP/CROSS_DOWN alerts are skipped.
 */
export async function evaluatePriceAlerts(
  currentPrices: Map<string, number>,
  previousPrices?: Map<string, number>,
): Promise<{
  triggered: Array<{ id: string; symbol: string; condition: string; price: number; triggeredAt: Date }>
}> {
  const triggeredAlerts: Array<{ id: string; symbol: string; condition: string; price: number; triggeredAt: Date }> = []

  try {
    const activeAlerts = await db.priceAlert.findMany({
      where: { active: true, triggered: false },
      take: 1000,
    })

    for (const alert of activeAlerts) {
      const currentPrice = currentPrices.get(alert.symbol)
      if (currentPrice == null) continue

      let isTriggered = false

      switch (alert.condition) {
        case 'ABOVE':
          isTriggered = currentPrice >= alert.price
          break
        case 'BELOW':
          isTriggered = currentPrice <= alert.price
          break
        case 'CROSS_UP': {
          const prevPrice = previousPrices?.get(alert.symbol)
          isTriggered = prevPrice !== undefined && prevPrice < alert.price && currentPrice >= alert.price
          break
        }
        case 'CROSS_DOWN': {
          const prevPrice = previousPrices?.get(alert.symbol)
          isTriggered = prevPrice !== undefined && prevPrice > alert.price && currentPrice <= alert.price
          break
        }
        default:
          continue
      }

      if (isTriggered) {
        const result = await db.priceAlert.updateMany({
          where: { id: alert.id, triggered: false },
          data: { triggered: true, triggeredAt: new Date() },
        })
        if (result.count > 0) {
          triggeredAlerts.push({
            id: alert.id,
            symbol: alert.symbol,
            condition: alert.condition,
            price: alert.price,
            triggeredAt: new Date(),
          })
        }
      }
    }

    if (triggeredAlerts.length > 0) {
      logger.info('TRADE_EXECUTION', `Price alerts triggered: ${triggeredAlerts.length}`, {
        metadata: {
          alerts: triggeredAlerts.map((a) => ({ id: a.id, symbol: a.symbol, condition: a.condition })),
        },
      })
    }
  } catch (err) {
    logger.error('TRADE_EXECUTION', 'Error evaluating price alerts', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  return { triggered: triggeredAlerts }
}

/**
 * Process a price update through the full pipeline.
 *
 * Execution order:
 *   1. Update currentPrice on open trades (so all subsequent stages use fresh prices)
 *   2. Trailing stops (adjust SL before checking SL triggers)
 *   3. SL/TP triggers (close trades that hit stops/targets)
 *   4. Partial close triggers (execute scaled exits)
 *   5. Price alert evaluation (CROSS_UP/CROSS_DOWN need previousPrices)
 *
 * Returns aggregate results from all pipeline stages.
 */
export async function processPriceUpdate(
  currentPrices: Map<string, number>,
  previousPrices?: Map<string, number>,
): Promise<PriceUpdateResult> {
  const startTime = Date.now()
  let trailingAdjusted = 0
  let slTriggered = 0
  let tpTriggered = 0
  let partialCloses = 0
  let errors = 0
  let triggeredAlerts: Array<{ id: string; symbol: string; condition: string; price: number; triggeredAt: Date }> = []
  let _trailingCooldownBlocked = 0
  let _trailingPhaseBlocked = 0
  let _trailingMaxCapHit = 0

  try {
    // Stage 1: Update currentPrice on open trades so all subsequent stages use fresh prices
    try {
      await Promise.all(
        Array.from(currentPrices).map(([symbol, price]) =>
          db.trade.updateMany({
            where: { status: { in: ['OPEN', 'PARTIAL_FILLED'] }, symbol },
            data: { currentPrice: price },
          })
        )
      )
    } catch (err) {
      errors++
      logger.error('TRADE_EXECUTION', 'Failed to update currentPrice on open trades', {
        details: err instanceof Error ? err.message : String(err),
      })
    }

    // Stage 2: Trailing stops — adjust SL levels before we check SL triggers
    const trailingResult = await processTrailingStopsForAllTrades(currentPrices)
    trailingAdjusted = trailingResult.adjusted
    errors += trailingResult.errors
    // Track new telemetry (used in log but not in return type to maintain backward compat)
    _trailingCooldownBlocked = trailingResult.cooldownBlocked
    _trailingPhaseBlocked = trailingResult.phaseBlocked
    _trailingMaxCapHit = trailingResult.maxCapHit

    // Stage 3: SL/TP triggers — close trades that hit their stops or targets
    const slTpResult = await processSlTpForAllOpenTrades(currentPrices)
    slTriggered = slTpResult.slTriggered
    tpTriggered = slTpResult.tpTriggered
    errors += slTpResult.errors

    // Stage 4: Partial close triggers — execute scaled exits at TP levels
    const partialResult = await checkPartialCloseTriggers(currentPrices)
    partialCloses = partialResult.triggered
    errors += partialResult.errors

    // Stage 5: Evaluate price alerts
    const alertResult = await evaluatePriceAlerts(currentPrices, previousPrices)
    triggeredAlerts = alertResult.triggered
  } catch (err) {
    errors++
    logger.error('TRADE_EXECUTION', 'Price update pipeline error', {
      details: err instanceof Error ? err.message : String(err),
      metadata: { symbolCount: currentPrices.size },
    })
  }

  const durationMs = Date.now() - startTime

  logger.info('TRADE_EXECUTION', `Price update pipeline completed`, {
    metadata: {
      symbolCount: currentPrices.size,
      trailingAdjusted,
      trailingCooldownBlocked: _trailingCooldownBlocked,
      trailingPhaseBlocked: _trailingPhaseBlocked,
      trailingMaxCapHit: _trailingMaxCapHit,
      slTriggered,
      tpTriggered,
      partialCloses,
      alertsTriggered: triggeredAlerts.length,
      errors,
      durationMs,
    },
  })

  return {
    trailingAdjusted,
    trailingCooldownBlocked: _trailingCooldownBlocked,
    trailingPhaseBlocked: _trailingPhaseBlocked,
    trailingMaxCapHit: _trailingMaxCapHit,
    slTriggered,
    tpTriggered,
    partialCloses,
    errors,
    durationMs,
    triggeredAlerts,
  }
}
