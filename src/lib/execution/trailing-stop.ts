/*
 * Trade Execution Engine — PART 5/10: trailing-stop.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 88-92, 652-1248):
 *   - TRAILING STOP ENGINE (TrailingStep, TrailingStopResult, roundToTickSize,
 *     getEffectiveTrailingDist, isTrailingAllowedForPhase, adjustTrailingStop,
 *     processTrailingStopsForAllTrades)
 *   - Module-private constants DEFAULT_MAX_TRAILING_ADJUSTMENTS and
 *     MIN_IMPROVEMENT_TICKS (sole consumers live in this part)
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { getTradingPhase, validateSymbol } from '@/lib/mt5-connection'
import type { TradingPhase } from '@/lib/mt5-connection'
import { logAuditTrail } from '@/lib/risk-engine'
import { tradeEventBus, TRADE_EVENTS } from './lifecycle'

/** Default max trailing stop adjustments per trade (prevents runaway DB writes). */
const DEFAULT_MAX_TRAILING_ADJUSTMENTS = 50

/** Minimum price improvement to justify a DB write (fraction of tickSize). */
const MIN_IMPROVEMENT_TICKS = 1

// ============================================
// TRAILING STOP ENGINE
// ============================================

/**
 * A single step in a tiered trailing stop configuration.
 * Each step defines a profit threshold (in R-multiples of the initial trailingDist)
 * and the new tighter trailing distance to use once that threshold is reached.
 *
 * Example for a BUY trade with entryPrice=1000 and trailingDist=15:
 *   Step 1: { profitR: 0,   trailDist: 15 }  → activates at 1015, SL = highest - 15
 *   Step 2: { profitR: 1.5, trailDist: 10 }  → at 1022.5+, SL = highest - 10
 *   Step 3: { profitR: 3.0, trailDist: 5  }  → at 1045+,    SL = highest - 5
 */
export interface TrailingStep {
  /** Profit threshold in R-multiples (multiples of the initial trailingDist). */
  profitR: number
  /** Trailing distance to use at this step. Must be <= previous step's trailDist. */
  trailDist: number
}

/**
 * Result of trailing stop adjustment with detailed metadata.
 */
export interface TrailingStopResult {
  adjusted: boolean
  newSl?: number
  reason: string
  /** Which step of the tiered trailing was active. */
  activeStep?: number
  /** The effective trailing distance used for this calculation. */
  effectiveTrailDist?: number
  /** Whether the break-even floor was applied. */
  breakEvenApplied?: boolean
  /** Whether the cooldown prevented adjustment. */
  cooldownBlocked?: boolean
  /** Whether the max-adjustments cap was hit. */
  maxAdjustmentsHit?: boolean
}

/**
 * Round a price to the nearest valid tick for a given symbol.
 *
 * IDX stocks have varying tick sizes (1, 5, 25). Using raw arithmetic for
 * SL values produces non-standard prices that the broker will reject.
 * This function rounds the candidate SL to the nearest valid tick.
 *
 * When `direction` is 'SELL', rounds UP to the nearest tick (more conservative
 * for a SELL stop-loss). For 'BUY' or unspecified, rounds to the nearest tick.
 *
 * Falls back to rounding to 4 decimal places if the symbol is not in SYMBOL_MAP.
 */
export function roundToTickSize(price: number, symbol: string, direction?: 'BUY' | 'SELL'): number {
  const mapping = validateSymbol(symbol)
  if (mapping && mapping.tickSize > 0) {
    if (direction === 'SELL') {
      // Round UP for SELL SL (more conservative)
      return Math.ceil(price / mapping.tickSize) * mapping.tickSize
    }
    // Default: round to nearest tick
    return Math.round(price / mapping.tickSize) * mapping.tickSize
  }
  // Fallback: round to 4 decimal places for forex-style symbols
  return Math.round(price * 10000) / 10000
}

/**
 * Determine the effective trailing distance based on current profit and tiered steps.
 *
 * If `trailingSteps` is provided and non-empty, the function finds the most aggressive
 * (tightest) step whose profitR threshold has been met. Otherwise falls back to
 * the base `trailingDist`.
 *
 * Steps MUST be sorted by ascending profitR. Validation is performed to ensure
 * each subsequent step has a smaller or equal trailDist.
 *
 * @param baseTrailingDist  - The original trailing distance from the trade.
 * @param steps             - Tiered trailing steps (may be empty/null).
 * @param currentProfitAbs  - Absolute profit in price units (e.g., for BUY: currentPrice - entryPrice).
 * @returns The effective trailing distance and the active step index.
 */
export function getEffectiveTrailingDist(
  baseTrailingDist: number,
  steps: TrailingStep[] | null | undefined,
  currentProfitAbs: number,
): { dist: number; activeStep: number } {
  if (!steps || steps.length === 0) {
    return { dist: baseTrailingDist, activeStep: 0 }
  }

  const profitR = baseTrailingDist > 0 ? currentProfitAbs / baseTrailingDist : 0
  let effectiveDist = baseTrailingDist
  let activeStep = 0

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (profitR >= step.profitR) {
      // Only apply if trailDist is valid and tighter than current
      if (step.trailDist > 0 && step.trailDist <= effectiveDist) {
        effectiveDist = step.trailDist
        activeStep = i
      }
    } else {
      break // Steps are sorted by profitR; no further steps will match
    }
  }

  return { dist: effectiveDist, activeStep }
}

/**
 * Check whether trailing stop evaluation should be skipped based on trading phase.
 *
 * Trailing stops should NOT adjust during:
 *   - PRE_CLOSE: prices are unreliable during closing auction
 *   - AFTER_HOURS: no real liquidity, stale prices
 *   - CLOSED: market is not active
 *
 * Only PRE_OPEN and OPEN phases allow trailing adjustments.
 */
export function isTrailingAllowedForPhase(phase: TradingPhase): boolean {
  return phase === 'OPEN' || phase === 'PRE_OPEN'
}

/**
 * Adjust the trailing stop for a trade based on a new price.
 *
 * Improvements over the original implementation:
 *
 *   1. **Tick-size rounding** (Fix 1): Candidate SL is rounded to the symbol's
 *      valid tick size to prevent broker rejections on IDX.
 *
 *   2. **Break-even floor** (Fix 2): For BUY, SL is floored at the commission-aware
 *      break-even price (entryPrice + commission per share). For SELL, SL is capped
 *      at (entryPrice - commission per share). Prevents turning a winning trade into
 *      a loser when commission is factored in. Falls back to entryPrice if commission
 *      or lotSize is not provided.
 *
 *   3. **Cooldown throttle** (Fix 3): If `lastSlAdjust` is provided and the
 *      cooldown has not elapsed, the adjustment is skipped (returned but not
 *      applied). Default cooldown is `trailingCooldownSec` or 5 seconds.
 *
 *   4. **Trading phase awareness** (Fix 4): If `currentPhase` is provided and
 *      the market is in PRE_CLOSE, CLOSED, or AFTER_HOURS, the adjustment is
 *      skipped entirely.
 *
 *   5. **Max adjustments cap** (Fix 5): If `trailingAdjustments` has reached
 *      `maxAdjustments` (default 50), no further adjustments are made.
 *
 *   6. **Tiered trailing steps** (Fix 6): If `trailingSteps` is provided, the
 *      trailing distance tightens as the trade moves further into profit.
 *
 * Activation threshold: the trailing stop does NOT fire until the trade has
 * moved at least `trailingDist` in the favorable direction:
 *   BUY:  price >= entryPrice + trailingDist
 *   SELL: price <= entryPrice - trailingDist
 *
 * Once activated:
 *   BUY:  Track the highest price. SL ratchets to (highest - effectiveTrailingDist).
 *         SL only moves UP, never down.
 *   SELL: Track the lowest price. SL ratchets to (lowest + effectiveTrailingDist).
 *         SL only moves DOWN, never up.
 */
export function adjustTrailingStop(
  trade: {
    id: string
    direction: string
    symbol?: string
    entryPrice: number
    currentPrice: number
    trailingStop: boolean
    trailingDist: number | null
    sl: number | null
    highestPrice: number | null
    lowestPrice: number | null
    lastSlAdjust?: Date | null
    trailingSteps?: string | null
    trailingAdjustments?: number
    trailingCooldownSec?: number
    /** Round-trip commission for break-even calculation. */
    commission?: number
    /** Lot size for commission-per-share calculation. */
    lotSize?: number
  },
  newPrice: number,
  options?: {
    currentPhase?: TradingPhase
    maxAdjustments?: number
    now?: Date
  },
): TrailingStopResult {
  // Trailing stop must be enabled with a valid distance
  if (!trade.trailingStop || trade.trailingDist === null || trade.trailingDist <= 0) {
    return { adjusted: false, reason: 'Trailing stop not enabled or no distance set' }
  }

  const { direction, entryPrice } = trade
  const now = options?.now ?? new Date()

  // --- Fix 4: Trading phase awareness ---
  // Skip trailing adjustments during PRE_CLOSE, CLOSED, AFTER_HOURS
  if (options?.currentPhase && !isTrailingAllowedForPhase(options.currentPhase)) {
    return {
      adjusted: false,
      reason: `Trailing skipped: market phase ${options.currentPhase} does not allow adjustments`,
    }
  }

  // --- Fix 5: Max adjustments cap ---
  const currentAdjustments = trade.trailingAdjustments ?? 0
  const maxAdj = options?.maxAdjustments ?? DEFAULT_MAX_TRAILING_ADJUSTMENTS
  if (currentAdjustments >= maxAdj) {
    return {
      adjusted: false,
      reason: `Trailing skipped: max adjustments (${maxAdj}) reached`,
      maxAdjustmentsHit: true,
    }
  }

  // --- Parse tiered trailing steps ---
  let steps: TrailingStep[] | null = null
  if (trade.trailingSteps) {
    try {
      const parsed = JSON.parse(trade.trailingSteps)
      if (Array.isArray(parsed) && parsed.length > 0) {
        steps = parsed as TrailingStep[]
      }
    } catch {
      // Invalid JSON — fall back to simple trailing
      logger.warn('TRADE_EXECUTION', `Invalid trailingSteps JSON for trade, falling back to simple trailing`, {
        tradeId: trade.id,
        symbol: trade.symbol,
        details: trade.trailingSteps?.slice(0, 100) ?? 'N/A',
      })
    }
  }

  // --- Calculate current profit for tiered trailing ---
  const profitAbs = direction === 'BUY'
    ? newPrice - entryPrice
    : entryPrice - newPrice
  const { dist: effectiveTrailingDist, activeStep } = getEffectiveTrailingDist(
    trade.trailingDist,
    steps,
    profitAbs,
  )

  const currentHighest = trade.highestPrice ?? trade.currentPrice
  const currentLowest = trade.lowestPrice ?? trade.currentPrice
  const currentSl = trade.sl

  // --- Activation threshold: the trade must be in profit by at least trailingDist ---
  if (direction === 'BUY') {
    if (newPrice < entryPrice + effectiveTrailingDist) {
      return {
        adjusted: false,
        reason: `Activation threshold not met: price ${newPrice} < entry ${entryPrice} + dist ${effectiveTrailingDist}`,
        effectiveTrailDist: effectiveTrailingDist,
        activeStep,
      }
    }
  } else {
    if (newPrice > entryPrice - effectiveTrailingDist) {
      return {
        adjusted: false,
        reason: `Activation threshold not met: price ${newPrice} > entry ${entryPrice} - dist ${effectiveTrailingDist}`,
        effectiveTrailDist: effectiveTrailingDist,
        activeStep,
      }
    }
  }

  // --- Fix 3: Cooldown throttle ---
  const cooldownSec = trade.trailingCooldownSec ?? 5
  if (trade.lastSlAdjust && cooldownSec > 0) {
    const elapsed = (now.getTime() - new Date(trade.lastSlAdjust).getTime()) / 1000
    if (elapsed < cooldownSec) {
      return {
        adjusted: false,
        reason: `Cooldown active: ${elapsed.toFixed(1)}s elapsed, need ${cooldownSec}s`,
        cooldownBlocked: true,
        effectiveTrailDist: effectiveTrailingDist,
        activeStep,
      }
    }
  }

  if (direction === 'BUY') {
    const newHighest = Math.max(currentHighest, newPrice)
    let candidateSl = newHighest - effectiveTrailingDist

    // --- Fix 2: Break-even floor (commission-aware) ---
    // SL must never be set below the true break-even price for a BUY trade.
    // True break-even accounts for round-trip commission.
    let breakEvenApplied = false
    const breakEvenFloor = (trade.commission != null && trade.lotSize != null && trade.lotSize > 0)
      ? entryPrice + (trade.commission / (trade.lotSize * 100))
      : entryPrice
    if (candidateSl < breakEvenFloor) {
      candidateSl = breakEvenFloor
      breakEvenApplied = true
    }

    // --- Fix 1: Tick-size rounding ---
    // Round to nearest tick (for BUY SL, round to nearest valid tick)
    if (trade.symbol) {
      candidateSl = roundToTickSize(candidateSl, trade.symbol, 'BUY')
      // After rounding, re-check break-even floor
      if (candidateSl < breakEvenFloor) {
        candidateSl = breakEvenFloor
        breakEvenApplied = true
      }
    }

    // Only adjust if: (1) no existing SL, or (2) new SL is higher by at least MIN_IMPROVEMENT_TICKS
    const tickSize = trade.symbol ? (validateSymbol(trade.symbol)?.tickSize ?? 0.0001) : 0.0001
    const minImprovement = tickSize * MIN_IMPROVEMENT_TICKS

    if (currentSl === null || candidateSl > currentSl + minImprovement) {
      const stepInfo = steps && steps.length > 0
        ? ` [step ${activeStep}, dist=${effectiveTrailingDist}]`
        : ''
      return {
        adjusted: true,
        newSl: candidateSl,
        reason: `Price reached new high ${newHighest.toFixed(2)}, SL moved to ${candidateSl.toFixed(4)}${stepInfo}${breakEvenApplied ? ' (break-even floor)' : ''}`,
        activeStep,
        effectiveTrailDist: effectiveTrailingDist,
        breakEvenApplied,
      }
    }

    return {
      adjusted: false,
      reason: `Current SL ${currentSl} already above candidate ${candidateSl.toFixed(4)}`,
      effectiveTrailDist: effectiveTrailingDist,
      activeStep,
    }
  } else {
    // SELL
    const newLowest = Math.min(currentLowest, newPrice)
    let candidateSl = newLowest + effectiveTrailingDist

    // --- Fix 2: Break-even floor (commission-aware) ---
    // SL must never be set above the true break-even price for a SELL trade.
    // True break-even accounts for round-trip commission.
    let breakEvenApplied = false
    const breakEvenFloor = (trade.commission != null && trade.lotSize != null && trade.lotSize > 0)
      ? entryPrice - (trade.commission / (trade.lotSize * 100))
      : entryPrice
    if (candidateSl > breakEvenFloor) {
      candidateSl = breakEvenFloor
      breakEvenApplied = true
    }

    // --- Fix 1: Tick-size rounding (unified via roundToTickSize) ---
    // Round UP for SELL SL (more conservative)
    if (trade.symbol) {
      candidateSl = roundToTickSize(candidateSl, trade.symbol, 'SELL')
      // After rounding up, re-check break-even floor
      if (candidateSl > breakEvenFloor) {
        candidateSl = breakEvenFloor
        breakEvenApplied = true
      }
    }

    // Only adjust if: (1) no existing SL, or (2) new SL is lower by at least MIN_IMPROVEMENT_TICKS
    const tickSize = trade.symbol ? (validateSymbol(trade.symbol)?.tickSize ?? 0.0001) : 0.0001
    const minImprovement = tickSize * MIN_IMPROVEMENT_TICKS

    if (currentSl === null || candidateSl < currentSl - minImprovement) {
      const stepInfo = steps && steps.length > 0
        ? ` [step ${activeStep}, dist=${effectiveTrailingDist}]`
        : ''
      return {
        adjusted: true,
        newSl: candidateSl,
        reason: `Price reached new low ${newLowest.toFixed(2)}, SL moved to ${candidateSl.toFixed(4)}${stepInfo}${breakEvenApplied ? ' (break-even floor)' : ''}`,
        activeStep,
        effectiveTrailDist: effectiveTrailingDist,
        breakEvenApplied,
      }
    }

    return {
      adjusted: false,
      reason: `Current SL ${currentSl} already below candidate ${candidateSl.toFixed(4)}`,
      effectiveTrailDist: effectiveTrailingDist,
      activeStep,
    }
  }
}

/**
 * Process trailing stops for all open trades given a price update map.
 *
 * Fetches all OPEN and PARTIAL_FILLED trades with trailingStop=true, applies the trailing stop
 * adjustment logic (with all 6 improvements: tick-size rounding, break-even
 * floor, cooldown throttle, trading phase awareness, max-adjustments cap,
 * and tiered trailing steps), updates the database for adjusted trades,
 * and emits TRAILING_STOP_ADJUSTED events.
 *
 * Peak tracking (highestPrice/lowestPrice) is always updated on every tick,
 * even when SL is not adjusted (cooldown, phase block, or below minImprovement),
 * to prevent stale peaks from causing premature stop-outs.
 *
 * Returns aggregate counts of adjustments, cooldown-blocked, phase-blocked, and errors.
 */
export async function processTrailingStopsForAllTrades(
  priceUpdate: Map<string, number>,
): Promise<{ adjusted: number; cooldownBlocked: number; phaseBlocked: number; maxCapHit: number; errors: number }> {
  let adjusted = 0
  let cooldownBlocked = 0
  let phaseBlocked = 0
  let maxCapHit = 0
  let errors = 0

  // Get current trading phase once for all trades (Fix 4)
  const currentPhase = getTradingPhase()
  const now = new Date()

  try {
    const symbols = Array.from(priceUpdate.keys())
    // Hot path: runs on every price update (price-pipeline). Enumerated from
    // the peak-tracking map + adjustTrailingStop's argument object + the
    // updateMany/event/audit reads (trailingActivatedAt, breakEvenApplied,
    // trailingAdjustments). indicatorSnapshot/partialCloses are never read.
    const trailingTrades = await db.trade.findMany({
      where: {
        status: { in: ['OPEN', 'PARTIAL_FILLED'] },
        trailingStop: true,
        symbol: { in: symbols },
      },
      select: {
        id: true,
        symbol: true,
        direction: true,
        entryPrice: true,
        currentPrice: true,
        trailingStop: true,
        trailingDist: true,
        sl: true,
        highestPrice: true,
        lowestPrice: true,
        lastSlAdjust: true,
        trailingSteps: true,
        trailingAdjustments: true,
        trailingCooldownSec: true,
        trailingActivatedAt: true,
        breakEvenApplied: true,
        commission: true,
        lotSize: true,
      },
    })

    if (trailingTrades.length === 0) {
      return { adjusted: 0, cooldownBlocked: 0, phaseBlocked: 0, maxCapHit: 0, errors: 0 }
    }

    logger.info('TRADE_EXECUTION', `Processing trailing stops for ${trailingTrades.length} trades`, {
      metadata: { symbolCount: priceUpdate.size, phase: currentPhase },
    })

    // Always update highestPrice/lowestPrice for ALL trailing trades on every tick,
    // even if SL is not adjusted (cooldown, phase block, below minImprovement).
    // This prevents stale peaks from causing premature stop-outs.
    const peakUpdates = trailingTrades.map(trade => {
      const newPrice = priceUpdate.get(trade.symbol)
      if (newPrice === undefined) return Promise.resolve()
      const updates: Record<string, number> = {}
      if (trade.direction === 'BUY') {
        const newHigh = Math.max(trade.highestPrice ?? trade.currentPrice, newPrice)
        if (newHigh !== (trade.highestPrice ?? trade.currentPrice)) updates.highestPrice = newHigh
      } else {
        const newLow = Math.min(trade.lowestPrice ?? trade.currentPrice, newPrice)
        if (newLow !== (trade.lowestPrice ?? trade.currentPrice)) updates.lowestPrice = newLow
      }
      return Object.keys(updates).length > 0
        ? db.trade.update({ where: { id: trade.id }, data: updates })
        : Promise.resolve()
    })
    await Promise.all(peakUpdates)

    for (const trade of trailingTrades) {
      const newPrice = priceUpdate.get(trade.symbol)
      if (newPrice === undefined) continue

      try {
        // Re-read peak values after the batch update above so adjustTrailingStop
        // uses the freshest highestPrice/lowestPrice
        const freshHighest = trade.direction === 'BUY'
          ? Math.max(trade.highestPrice ?? trade.currentPrice, newPrice)
          : trade.highestPrice
        const freshLowest = trade.direction === 'SELL'
          ? Math.min(trade.lowestPrice ?? trade.currentPrice, newPrice)
          : trade.lowestPrice

        const result = adjustTrailingStop(
          {
            id: trade.id,
            symbol: trade.symbol,
            direction: trade.direction,
            entryPrice: trade.entryPrice,
            currentPrice: trade.currentPrice,
            trailingStop: trade.trailingStop,
            trailingDist: trade.trailingDist,
            sl: trade.sl,
            highestPrice: freshHighest,
            lowestPrice: freshLowest,
            lastSlAdjust: trade.lastSlAdjust,
            trailingSteps: trade.trailingSteps,
            trailingAdjustments: trade.trailingAdjustments,
            trailingCooldownSec: trade.trailingCooldownSec,
            commission: trade.commission,
            lotSize: trade.lotSize,
          },
          newPrice,
          { currentPhase, now },
        )

        if (!result.adjusted || result.newSl === undefined) {
          // Track why the adjustment was skipped for logging
          if (result.cooldownBlocked) cooldownBlocked++
          if (result.maxAdjustmentsHit) maxCapHit++
          if (/phase|market|session/i.test(result.reason)) phaseBlocked++
          continue
        }

        // Atomic DB update: only update if trade is still open (not closed by SL/TP concurrently)
        const updateResult = await db.trade.updateMany({
          where: { id: trade.id, status: { in: ['OPEN', 'PARTIAL_FILLED'] } },
          data: {
            sl: result.newSl,
            lastSlAdjust: now,
            trailingAdjustments: (trade.trailingAdjustments ?? 0) + 1,
            // Set activation timestamp on first successful adjustment
            trailingActivatedAt: trade.trailingActivatedAt ?? now,
            breakEvenApplied: result.breakEvenApplied ? true : trade.breakEvenApplied,
          },
        })

        if (updateResult.count === 0) {
          // Trade was closed during trailing evaluation — skip silently
          logger.warn('TRADE_EXECUTION', `Trailing stop adjustment skipped: trade ${trade.id} was closed during evaluation`, {
            tradeId: trade.id,
            symbol: trade.symbol,
          })
          continue
        }

        adjusted++

        // Emit trailing stop adjusted event
        await tradeEventBus.emit({
          tradeId: trade.id,
          symbol: trade.symbol,
          event: TRADE_EVENTS.TRAILING_STOP_ADJUSTED,
          fromStatus: 'OPEN',
          toStatus: 'OPEN',
          reason: result.reason,
          metadata: {
            newSl: result.newSl,
            previousSl: trade.sl,
            newPrice,
            trailingDist: trade.trailingDist,
            effectiveTrailDist: result.effectiveTrailDist,
            activeStep: result.activeStep,
            breakEvenApplied: result.breakEvenApplied,
            direction: trade.direction,
            adjustmentNumber: (trade.trailingAdjustments ?? 0) + 1,
          },
          timestamp: now,
        })

        // Audit trail for SL modification
        await logAuditTrail({
          action: 'TRAILING_STOP_ADJUSTED',
          category: 'TRADE_EXECUTION',
          fieldName: 'sl',
          oldValue: trade.sl !== null ? String(trade.sl) : undefined,
          newValue: String(result.newSl),
          reason: result.reason,
          performedBy: 'SYSTEM',
        })

        logger.info('TRADE_EXECUTION', `Trailing stop adjusted for ${trade.symbol}`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          metadata: {
            previousSl: trade.sl,
            newSl: result.newSl,
            reason: result.reason,
            activeStep: result.activeStep,
            effectiveTrailDist: result.effectiveTrailDist,
            adjustmentNumber: (trade.trailingAdjustments ?? 0) + 1,
          },
        })
      } catch (err) {
        errors++
        logger.error('TRADE_EXECUTION', `Error adjusting trailing stop`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          details: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    errors++
    logger.error('TRADE_EXECUTION', 'Failed to fetch trailing stop trades', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  if (adjusted > 0 || cooldownBlocked > 0 || phaseBlocked > 0 || maxCapHit > 0) {
    logger.info('TRADE_EXECUTION', `Trailing stops processed: ${adjusted} adjusted, ${cooldownBlocked} cooldown-blocked, ${maxCapHit} max-cap-hit`, {
      metadata: { adjusted, cooldownBlocked, phaseBlocked, maxCapHit, errors },
    })
  }

  return { adjusted, cooldownBlocked, phaseBlocked, maxCapHit, errors }
}
