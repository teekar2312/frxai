/*
 * Trade Execution Engine - FINEX Indonesia
 * ====================================================
 * Comprehensive trade lifecycle management with:
 *   1. Trade State Machine (valid transitions enforcement)
 *   2. Trade Lifecycle Events (event bus with pub/sub)
 *   3. SL/TP Trigger Engine (automatic stop-loss / take-profit)
 *   4. Trailing Stop Engine (dynamic SL adjustment)
 *   5. Partial Close Engine (scaled exit at TP levels)
 *   6. Position Sync Mechanism (broker ↔ local DB reconciliation)
 *   7. Price Update Pipeline (orchestrator for all price-driven checks)
 *   8. Emergency Close All (margin call / connection loss handler)
 *   9. Execution Pipeline Integration (full order → trade lifecycle)
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { executeOrderWithRetry, type OrderExecutionResult } from '@/lib/mt5-connection'
import { getTradingPhase, isMarketOpen } from '@/lib/mt5-connection'
import { updateDailyPerformance } from '@/lib/money-management'
import { logAuditTrail } from '@/lib/risk-engine'

// ============================================
// TYPES & ENUMS
// ============================================

export type TradeStatus =
  | 'PENDING'
  | 'OPEN'
  | 'PARTIAL_FILLED'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELLED'

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT'

/** A single valid transition between trade statuses. */
export interface TradeTransition {
  from: TradeStatus
  to: TradeStatus
  event: string
}

// ============================================
// CONSTANTS
// ============================================

/** The complete set of valid trade state transitions. */
export const VALID_TRANSITIONS: TradeTransition[] = [
  // Order lifecycle
  { from: 'PENDING', to: 'OPEN', event: 'ORDER_FILLED' },
  { from: 'PENDING', to: 'REJECTED', event: 'RISK_BROKER_REJECTION' },
  { from: 'PENDING', to: 'CANCELLED', event: 'USER_SYSTEM_CANCEL' },

  // Open position lifecycle
  { from: 'OPEN', to: 'CLOSED', event: 'SL_TP_MANUAL_CLOSE' },
  { from: 'OPEN', to: 'PARTIAL_FILLED', event: 'PARTIAL_CLOSE_EXECUTED' },

  // Partial-filled lifecycle
  { from: 'PARTIAL_FILLED', to: 'CLOSED', event: 'REMAINING_CLOSED' },
  { from: 'PARTIAL_FILLED', to: 'PARTIAL_FILLED', event: 'ANOTHER_PARTIAL' },

  // Emergency — any state can be cancelled
  { from: 'PENDING', to: 'CANCELLED', event: 'EMERGENCY_CLOSE_ALL' },
  { from: 'OPEN', to: 'CANCELLED', event: 'EMERGENCY_CLOSE_ALL' },
  { from: 'PARTIAL_FILLED', to: 'CANCELLED', event: 'EMERGENCY_CLOSE_ALL' },
]

/** Pip value per standard lot (100 000 units). */
const PIP_VALUE_PER_LOT = 100_000

/** Default ATR estimate for partial close levels when no TP is set. */
const DEFAULT_ATR_ESTIMATE = 0.005

// ============================================
// TRADE STATE MACHINE
// ============================================

/**
 * Validate whether a transition from `from` to `to` is allowed.
 * Returns true if the transition exists in VALID_TRANSITIONS.
 */
export function validateTransition(
  from: TradeStatus,
  to: TradeStatus,
): boolean {
  return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to)
}

/**
 * Get all valid next states from a given trade status.
 * Returns an array of TradeStatus values that are reachable.
 */
export function getAllowedTransitions(from: TradeStatus): TradeStatus[] {
  const seen = new Set<TradeStatus>()
  for (const t of VALID_TRANSITIONS) {
    if (t.from === from && !seen.has(t.to)) {
      seen.add(t.to)
    }
  }
  return Array.from(seen)
}

// ============================================
// TRADE LIFECYCLE EVENTS
// ============================================

/** Callback signature for trade lifecycle event listeners. */
export type TradeEventCallback = (event: TradeLifecycleEvent) => void | Promise<void>

/** Structured event emitted whenever a trade undergoes a lifecycle change. */
export interface TradeLifecycleEvent {
  tradeId: string
  symbol: string
  event: string
  fromStatus: string
  toStatus: string
  reason?: string
  pnl?: number
  metadata?: Record<string, unknown>
  timestamp: Date
}

/** Well-known lifecycle event names. */
export const TRADE_EVENTS = {
  TRADE_OPENED: 'TRADE_OPENED',
  TRADE_CLOSED: 'TRADE_CLOSED',
  SL_TRIGGERED: 'SL_TRIGGERED',
  TP_TRIGGERED: 'TP_TRIGGERED',
  TRAILING_STOP_ADJUSTED: 'TRAILING_STOP_ADJUSTED',
  PARTIAL_CLOSE_EXECUTED: 'PARTIAL_CLOSE_EXECUTED',
  TRADE_REJECTED: 'TRADE_REJECTED',
  TRADE_CANCELLED: 'TRADE_CANCELLED',
  MARGIN_CALL_CLOSE: 'MARGIN_CALL_CLOSE',
  EMERGENCY_CLOSE_ALL: 'EMERGENCY_CLOSE_ALL',
} as const

/**
 * EventBus for trade lifecycle events.
 * Supports named event listeners with unsubscribe capability.
 */
export class TradeEventBus {
  private listeners: Map<string, TradeEventCallback[]> = new Map()

  /**
   * Subscribe to a named event. Returns an unsubscribe function.
   */
  on(event: string, callback: TradeEventCallback): () => void {
    const existing = this.listeners.get(event) ?? []
    existing.push(callback)
    this.listeners.set(event, existing)

    // Return unsubscribe function
    return () => {
      const current = this.listeners.get(event)
      if (current) {
        this.listeners.set(
          event,
          current.filter((cb) => cb !== callback),
        )
      }
    }
  }

  /**
   * Emit an event to all registered listeners.
   * Listeners are invoked in registration order; async listeners are awaited.
   */
  async emit(event: TradeLifecycleEvent): Promise<void> {
    const callbacks = this.listeners.get(event.event) ?? []
    // Also notify wildcard listeners
    const wildcardCallbacks = this.listeners.get('*') ?? []
    const allCallbacks = [...callbacks, ...wildcardCallbacks]

    for (const cb of allCallbacks) {
      try {
        await cb(event)
      } catch (err) {
        logger.error('TRADE_EXECUTION', `Event listener error for ${event.event}`, {
          tradeId: event.tradeId,
          symbol: event.symbol,
          details: err instanceof Error ? err.message : String(err),
          metadata: { eventName: event.event, fromStatus: event.fromStatus, toStatus: event.toStatus },
        })
      }
    }
  }

  /** Remove all listeners. Useful for testing or shutdown. */
  removeAllListeners(): void {
    this.listeners.clear()
  }
}

/** Singleton event bus instance for trade lifecycle events. */
export const tradeEventBus = new TradeEventBus()

// ============================================
// PNL CALCULATION HELPERS
// ============================================

/**
 * Calculate PnL for a trade based on direction, entry price, close price, lot size, and commission.
 *   BUY:  (closePrice - entryPrice) * lotSize * 100000 - commission
 *   SELL: (entryPrice - closePrice) * lotSize * 100000 - commission
 */
export function calculatePnl(
  direction: string,
  entryPrice: number,
  closePrice: number,
  lotSize: number,
  commission: number = 0,
): number {
  if (direction === 'BUY') {
    return (closePrice - entryPrice) * lotSize * PIP_VALUE_PER_LOT - commission
  }
  // SELL
  return (entryPrice - closePrice) * lotSize * PIP_VALUE_PER_LOT - commission
}

/**
 * Calculate PnL percentage relative to the margin used.
 */
export function calculatePnlPercent(pnl: number, margin: number): number {
  if (margin <= 0) return 0
  return (pnl / margin) * 100
}

// ============================================
// SL / TP TRIGGER ENGINE
// ============================================

/**
 * Check if a new price triggers the SL or TP for a given trade.
 *
 * For BUY:  TP triggers when price >= tp,  SL triggers when price <= sl
 * For SELL: TP triggers when price <= tp,  SL triggers when price >= sl
 *
 * Returns null if neither SL nor TP is set, otherwise an object describing
 * the trigger state and the resulting PnL.
 */
export function checkSlTpTrigger(
  trade: {
    id: string
    direction: string
    currentPrice: number
    sl: number | null
    tp: number | null
    lotSize: number
    entryPrice: number
    commission: number
    margin: number
    symbol: string
    strategy: string | null
  },
  newPrice: number,
): { triggered: boolean; type: 'SL' | 'TP' | null; pnl: number } | null {
  const { direction, sl, tp, lotSize, entryPrice, commission } = trade

  // Neither SL nor TP set — nothing to check
  if (sl === null && tp === null) return null

  const pnl = calculatePnl(direction, entryPrice, newPrice, lotSize, commission)

  if (direction === 'BUY') {
    // TP: price rises to or above take-profit level
    if (tp !== null && newPrice >= tp) {
      return { triggered: true, type: 'TP', pnl }
    }
    // SL: price drops to or below stop-loss level
    if (sl !== null && newPrice <= sl) {
      return { triggered: true, type: 'SL', pnl }
    }
  } else {
    // SELL
    // TP: price falls to or below take-profit level
    if (tp !== null && newPrice <= tp) {
      return { triggered: true, type: 'TP', pnl }
    }
    // SL: price rises to or above stop-loss level
    if (sl !== null && newPrice >= sl) {
      return { triggered: true, type: 'SL', pnl }
    }
  }

  return { triggered: false, type: null, pnl }
}

/**
 * Process SL/TP triggers for all open trades given a price update map.
 *
 * Fetches every OPEN trade, checks each against the new price for its symbol,
 * and closes any that have triggered SL or TP. Emits lifecycle events and
 * updates daily performance for each closed trade.
 *
 * Returns aggregate counts of SL triggers, TP triggers, and errors.
 */
export async function processSlTpForAllOpenTrades(
  priceUpdate: Map<string, number>,
): Promise<{ slTriggered: number; tpTriggered: number; errors: number }> {
  let slTriggered = 0
  let tpTriggered = 0
  let errors = 0

  try {
    const openTrades = await db.trade.findMany({
      where: { status: 'OPEN' },
    })

    logger.info('TRADE_EXECUTION', `Checking SL/TP for ${openTrades.length} open trades`, {
      metadata: { symbolCount: priceUpdate.size },
    })

    for (const trade of openTrades) {
      const newPrice = priceUpdate.get(trade.symbol)
      if (newPrice === undefined) continue

      try {
        const result = checkSlTpTrigger(
          {
            id: trade.id,
            direction: trade.direction,
            currentPrice: trade.currentPrice,
            sl: trade.sl,
            tp: trade.tp,
            lotSize: trade.lotSize,
            entryPrice: trade.entryPrice,
            commission: trade.commission,
            margin: trade.margin,
            symbol: trade.symbol,
            strategy: trade.strategy,
          },
          newPrice,
        )

        if (!result || !result.triggered || !result.type) continue

        // Determine close reason: distinguish trailing-stop-triggered SL from manual SL
        let reason: string = result.type === 'SL' ? 'SL' : 'TP'
        if (result.type === 'SL' && trade.trailingStop && trade.lastSlAdjust) {
          reason = 'Trailing Stop'
        }
        const eventName = result.type === 'SL' ? TRADE_EVENTS.SL_TRIGGERED : TRADE_EVENTS.TP_TRIGGERED

        if (result.type === 'SL') slTriggered++
        else tpTriggered++

        // Close the trade
        const closeResult = await closeTrade(trade.id, reason, newPrice)
        if (!closeResult.success) {
          errors++
          logger.error('TRADE_EXECUTION', `Failed to close trade on ${reason} trigger`, {
            tradeId: trade.id,
            symbol: trade.symbol,
            details: closeResult.error,
          })
        } else {
          // Emit the specific SL/TP event
          await tradeEventBus.emit({
            tradeId: trade.id,
            symbol: trade.symbol,
            event: eventName,
            fromStatus: 'OPEN',
            toStatus: 'CLOSED',
            reason,
            pnl: result.pnl,
            metadata: {
              triggerPrice: newPrice,
              sl: trade.sl,
              tp: trade.tp,
              lotSize: trade.lotSize,
              strategy: trade.strategy,
            },
            timestamp: new Date(),
          })
        }
      } catch (err) {
        errors++
        logger.error('TRADE_EXECUTION', `Error checking SL/TP for trade`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          details: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    errors++
    logger.error('TRADE_EXECUTION', 'Failed to fetch open trades for SL/TP check', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  if (slTriggered > 0 || tpTriggered > 0) {
    logger.info('TRADE_EXECUTION', `SL/TP triggers processed: ${slTriggered} SL, ${tpTriggered} TP`, {
      metadata: { slTriggered, tpTriggered, errors },
    })
  }

  return { slTriggered, tpTriggered, errors }
}

/**
 * Close a trade fully.
 *
 * Validates the state transition (OPEN or PARTIAL_FILLED → CLOSED),
 * calculates final PnL, updates the database record, emits a TRADE_CLOSED
 * lifecycle event, and updates daily performance.
 *
 * @param tradeId  - The trade ID to close.
 * @param reason   - Why the trade is being closed (SL, TP, Manual, etc.).
 * @param closePrice - Optional explicit close price. Falls back to currentPrice.
 */
export async function closeTrade(
  tradeId: string,
  reason: string,
  closePrice?: number,
): Promise<{ success: boolean; trade?: any; error?: string }> {
  try {
    const trade = await db.trade.findUnique({ where: { id: tradeId } })
    if (!trade) {
      return { success: false, error: `Trade ${tradeId} not found` }
    }

    const fromStatus = trade.status as TradeStatus

    // Validate transition
    if (
      fromStatus !== 'OPEN' &&
      fromStatus !== 'PARTIAL_FILLED'
    ) {
      return {
        success: false,
        error: `Invalid transition: ${fromStatus} → CLOSED. Trade must be OPEN or PARTIAL_FILLED.`,
      }
    }

    const finalClosePrice = closePrice ?? trade.currentPrice
    const pnl = calculatePnl(
      trade.direction,
      trade.entryPrice,
      finalClosePrice,
      trade.lotSize,
      trade.commission,
    )
    const pnlPercent = calculatePnlPercent(pnl, trade.margin)

    const updatedTrade = await db.trade.update({
      where: { id: tradeId },
      data: {
        status: 'CLOSED',
        executionState: 'CANCELLED',
        closePrice: finalClosePrice,
        currentPrice: finalClosePrice,
        pnl,
        pnlPercent,
        reason,
        closeTime: new Date(),
      },
    })

    // Emit trade closed event
    await tradeEventBus.emit({
      tradeId,
      symbol: trade.symbol,
      event: TRADE_EVENTS.TRADE_CLOSED,
      fromStatus,
      toStatus: 'CLOSED',
      reason,
      pnl,
      metadata: {
        closePrice: finalClosePrice,
        entryPrice: trade.entryPrice,
        lotSize: trade.lotSize,
        direction: trade.direction,
        strategy: trade.strategy,
      },
      timestamp: new Date(),
    })

    // Update daily performance
    await updateDailyPerformance({
      type: 'CLOSE',
      pnl,
      isWin: pnl > 0,
      commission: trade.commission,
      slippage: trade.slippage,
      sizingMethod: trade.sizingMethod ?? undefined,
    })

    // Audit trail
    await logAuditTrail({
      action: 'TRADE_CLOSED',
      category: 'TRADE_EXECUTION',
      fieldName: 'status',
      oldValue: fromStatus,
      newValue: 'CLOSED',
      reason,
      performedBy: 'SYSTEM',
    })

    logger.info('TRADE_EXECUTION', `Trade closed: ${tradeId}`, {
      tradeId,
      symbol: trade.symbol,
      source: 'closeTrade',
      metadata: {
        reason,
        closePrice: finalClosePrice,
        pnl,
        pnlPercent,
        direction: trade.direction,
        lotSize: trade.lotSize,
      },
    })

    return { success: true, trade: updatedTrade }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('TRADE_EXECUTION', `Failed to close trade ${tradeId}`, {
      tradeId,
      details: errMsg,
    })
    return { success: false, error: errMsg }
  }
}

// ============================================
// TRAILING STOP ENGINE
// ============================================

/**
 * Adjust the trailing stop for a trade based on a new price.
 *
 * Activation threshold: the trailing stop does NOT fire until the trade has
 * moved at least `trailingDist` in the favorable direction:
 *   BUY:  price >= entryPrice + trailingDist
 *   SELL: price <= entryPrice - trailingDist
 *
 * Once activated:
 *   BUY:  Track the highest price. SL ratchets to (highest - trailingDist).
 *         SL only moves UP, never down.
 *   SELL: Track the lowest price. SL ratchets to (lowest + trailingDist).
 *         SL only moves DOWN, never up.
 *
 * Returns the adjustment details including the new SL (if adjusted).
 */
export function adjustTrailingStop(
  trade: {
    id: string
    direction: string
    entryPrice: number
    currentPrice: number
    trailingStop: boolean
    trailingDist: number | null
    sl: number | null
    highestPrice: number | null
    lowestPrice: number | null
  },
  newPrice: number,
): { adjusted: boolean; newSl?: number; reason: string } {
  // Trailing stop must be enabled with a valid distance
  if (!trade.trailingStop || trade.trailingDist === null || trade.trailingDist <= 0) {
    return { adjusted: false, reason: 'Trailing stop not enabled or no distance set' }
  }

  const { direction, entryPrice, trailingDist } = trade
  const currentHighest = trade.highestPrice ?? trade.currentPrice
  const currentLowest = trade.lowestPrice ?? trade.currentPrice
  const currentSl = trade.sl

  // --- Activation threshold: the trade must be in profit by at least trailingDist ---
  // BUY:  price must reach entryPrice + trailingDist before trailing starts
  // SELL: price must fall to  entryPrice - trailingDist before trailing starts
  if (direction === 'BUY') {
    if (newPrice < entryPrice + trailingDist) {
      return {
        adjusted: false,
        reason: `Activation threshold not met: price ${newPrice} < entry ${entryPrice} + dist ${trailingDist}`,
      }
    }
  } else {
    if (newPrice > entryPrice - trailingDist) {
      return {
        adjusted: false,
        reason: `Activation threshold not met: price ${newPrice} > entry ${entryPrice} - dist ${trailingDist}`,
      }
    }
  }

  if (direction === 'BUY') {
    // Update highest price tracking
    const newHighest = Math.max(currentHighest, newPrice)
    const candidateSl = newHighest - trailingDist

    // Only adjust if: (1) no existing SL, or (2) new SL is higher (more favorable)
    if (currentSl === null || candidateSl > currentSl) {
      return {
        adjusted: true,
        newSl: candidateSl,
        reason: `Price reached new high ${newHighest}, SL moved to ${candidateSl.toFixed(4)}`,
      }
    }

    return {
      adjusted: false,
      reason: `Current SL ${currentSl} already above candidate ${candidateSl.toFixed(4)}`,
    }
  } else {
    // SELL
    // Update lowest price tracking
    const newLowest = Math.min(currentLowest, newPrice)
    const candidateSl = newLowest + trailingDist

    // Only adjust if: (1) no existing SL, or (2) new SL is lower (more favorable for SELL)
    if (currentSl === null || candidateSl < currentSl) {
      return {
        adjusted: true,
        newSl: candidateSl,
        reason: `Price reached new low ${newLowest}, SL moved to ${candidateSl.toFixed(4)}`,
      }
    }

    return {
      adjusted: false,
      reason: `Current SL ${currentSl} already below candidate ${candidateSl.toFixed(4)}`,
    }
  }
}

/**
 * Process trailing stops for all open trades given a price update map.
 *
 * Fetches all OPEN trades with trailingStop=true, applies the trailing stop
 * adjustment logic, updates the database for adjusted trades, and emits
 * TRAILING_STOP_ADJUSTED events.
 *
 * Returns aggregate counts of adjustments and errors.
 */
export async function processTrailingStopsForAllTrades(
  priceUpdate: Map<string, number>,
): Promise<{ adjusted: number; errors: number }> {
  let adjusted = 0
  let errors = 0

  try {
    const trailingTrades = await db.trade.findMany({
      where: {
        status: 'OPEN',
        trailingStop: true,
      },
    })

    if (trailingTrades.length === 0) {
      return { adjusted: 0, errors: 0 }
    }

    logger.info('TRADE_EXECUTION', `Processing trailing stops for ${trailingTrades.length} trades`, {
      metadata: { symbolCount: priceUpdate.size },
    })

    for (const trade of trailingTrades) {
      const newPrice = priceUpdate.get(trade.symbol)
      if (newPrice === undefined) continue

      try {
        const result = adjustTrailingStop(
          {
            id: trade.id,
            direction: trade.direction,
            entryPrice: trade.entryPrice,
            currentPrice: trade.currentPrice,
            trailingStop: trade.trailingStop,
            trailingDist: trade.trailingDist,
            sl: trade.sl,
            highestPrice: trade.highestPrice,
            lowestPrice: trade.lowestPrice,
          },
          newPrice,
        )

        if (!result.adjusted || result.newSl === undefined) continue

        // Update the trade in DB
        await db.trade.update({
          where: { id: trade.id },
          data: {
            sl: result.newSl,
            highestPrice: trade.direction === 'BUY'
              ? Math.max(trade.highestPrice ?? trade.currentPrice, newPrice)
              : trade.highestPrice,
            lowestPrice: trade.direction === 'SELL'
              ? Math.min(trade.lowestPrice ?? trade.currentPrice, newPrice)
              : trade.lowestPrice,
            lastSlAdjust: new Date(),
          },
        })

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
            direction: trade.direction,
          },
          timestamp: new Date(),
        })

        // Audit trail for SL modification
        await logAuditTrail({
          action: 'TRAILING_STOP_ADJUSTED',
          category: 'TRADE_EXECUTION',
          fieldName: 'sl',
          oldValue: trade.sl !== null ? String(trade.sl) : null,
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

  if (adjusted > 0) {
    logger.info('TRADE_EXECUTION', `Trailing stops adjusted: ${adjusted}`, {
      metadata: { adjusted, errors },
    })
  }

  return { adjusted, errors }
}

// ============================================
// PARTIAL CLOSE ENGINE
// ============================================

/** A single partial close level defining when and how much to close. */
export interface PartialCloseLevel {
  /** Percentage of the original position to close (0-100). */
  percentage: number
  /** Which TP target this level is associated with. */
  closeAt: 'TP1' | 'TP2' | 'TP3'
  /** Whether this level has already been executed. */
  executed: boolean
  /** When this level was executed. */
  executedAt?: Date
  /** The trade ID of the closed portion record, if executed. */
  tradeId?: string
  /** The price target for this level. */
  targetPrice: number
}

/**
 * Calculate three partial close levels for a trade.
 *
 * When TP is set:
 *   TP1 at 50% of the TP distance from entry (close 30%)
 *   TP2 at 75% of the TP distance from entry (close 30%)
 *   TP3 at the original TP level (close remaining 40%)
 *
 * When no TP is set, uses ATR-based estimates:
 *   TP1 at entry ± 1*ATR (close 30%)
 *   TP2 at entry ± 2*ATR (close 30%)
 *   TP3 at entry ± 3*ATR (close remaining 40%)
 */
export function calculatePartialCloseLevels(
  trade: {
    entryPrice: number
    direction: string
    tp: number | null
    sl: number | null
    lotSize: number
  },
): PartialCloseLevel[] {
  const { entryPrice, direction, tp } = trade
  const isBuy = direction === 'BUY'
  const atr = DEFAULT_ATR_ESTIMATE

  if (tp !== null) {
    const tpDistance = Math.abs(tp - entryPrice)

    // TP1 at 50% of the TP distance
    const tp1Price = isBuy
      ? entryPrice + tpDistance * 0.5
      : entryPrice - tpDistance * 0.5

    // TP2 at 75% of the TP distance
    const tp2Price = isBuy
      ? entryPrice + tpDistance * 0.75
      : entryPrice - tpDistance * 0.75

    // TP3 at the full TP
    const tp3Price = tp

    return [
      { percentage: 30, closeAt: 'TP1', executed: false, targetPrice: Math.round(tp1Price * 10000) / 10000 },
      { percentage: 30, closeAt: 'TP2', executed: false, targetPrice: Math.round(tp2Price * 10000) / 10000 },
      { percentage: 40, closeAt: 'TP3', executed: false, targetPrice: Math.round(tp3Price * 10000) / 10000 },
    ]
  }

  // ATR-based fallback when no TP is set
  const tp1Price = isBuy ? entryPrice + atr : entryPrice - atr
  const tp2Price = isBuy ? entryPrice + atr * 2 : entryPrice - atr * 2
  const tp3Price = isBuy ? entryPrice + atr * 3 : entryPrice - atr * 3

  return [
    { percentage: 30, closeAt: 'TP1', executed: false, targetPrice: Math.round(tp1Price * 10000) / 10000 },
    { percentage: 30, closeAt: 'TP2', executed: false, targetPrice: Math.round(tp2Price * 10000) / 10000 },
    { percentage: 40, closeAt: 'TP3', executed: false, targetPrice: Math.round(tp3Price * 10000) / 10000 },
  ]
}

/**
 * Execute a partial close on a trade.
 *
 * Creates a NEW trade record for the closed portion (with parentId pointing
 * to the original trade, status=CLOSED). The original trade keeps its ID
 * but has its lotSize reduced, partialCloses incremented, and executionState
 * set to PARTIAL_FILLED.
 *
 * @param tradeId         - The original trade ID to partially close.
 * @param closePercentage - Percentage of the current lotSize to close (0-100).
 * @param reason          - Optional reason string for the partial close.
 */
export async function executePartialClose(
  tradeId: string,
  closePercentage: number,
  reason?: string,
): Promise<{ success: boolean; closedTrade?: any; remainingTrade?: any; error?: string }> {
  try {
    // Fetch the original trade
    const trade = await db.trade.findUnique({ where: { id: tradeId } })
    if (!trade) {
      return { success: false, error: `Trade ${tradeId} not found` }
    }

    // Validate state — must be OPEN or PARTIAL_FILLED
    const fromStatus = trade.status as TradeStatus
    if (fromStatus !== 'OPEN' && fromStatus !== 'PARTIAL_FILLED') {
      return {
        success: false,
        error: `Cannot partial close trade in status ${fromStatus}. Must be OPEN or PARTIAL_FILLED.`,
      }
    }

    // Validate close percentage
    if (closePercentage <= 0 || closePercentage > 100) {
      return { success: false, error: `Invalid close percentage: ${closePercentage}. Must be between 0 and 100.` }
    }

    const currentLotSize = trade.lotSize
    const closeLotSize = Math.round(currentLotSize * (closePercentage / 100) * 10000) / 10000
    const remainingLotSize = Math.round((currentLotSize - closeLotSize) * 10000) / 10000

    // Edge case: closing would result in zero or negative remaining lot
    if (remainingLotSize <= 0) {
      return { success: false, error: `Partial close would leave zero remaining lot size (current: ${currentLotSize}, close: ${closeLotSize}). Use full close instead.` }
    }

    const closeReason = reason ?? `PARTIAL_CLOSE_${closePercentage}%`
    const closePrice = trade.currentPrice
    const pnl = calculatePnl(trade.direction, trade.entryPrice, closePrice, closeLotSize, trade.commission * (closeLotSize / currentLotSize))
    const pnlPercent = calculatePnlPercent(pnl, trade.margin * (closeLotSize / currentLotSize))

    // Create a new CLOSED trade record for the closed portion
    const closedTrade = await db.trade.create({
      data: {
        symbol: trade.symbol,
        direction: trade.direction,
        lotSize: closeLotSize,
        entryPrice: trade.entryPrice,
        currentPrice: closePrice,
        sl: trade.sl,
        tp: trade.tp,
        trailingStop: false,
        pnl,
        pnlPercent,
        status: 'CLOSED',
        executionState: 'CANCELLED',
        strategy: trade.strategy,
        timeframe: trade.timeframe,
        marketCond: trade.marketCond,
        aiConfidence: trade.aiConfidence,
        leverage: trade.leverage,
        commission: trade.commission * (closeLotSize / currentLotSize),
        slippage: trade.slippage * (closeLotSize / currentLotSize),
        margin: trade.margin * (closeLotSize / currentLotSize),
        openTime: trade.openTime,
        closeTime: new Date(),
        closePrice,
        reason: closeReason,
        sizingMethod: trade.sizingMethod,
        riskAmount: trade.riskAmount ? trade.riskAmount * (closeLotSize / currentLotSize) : null,
        sector: trade.sector,
        parentId: trade.id,
        originalLotSize: trade.originalLotSize ?? trade.lotSize,
        partialCloses: 0,
        highestPrice: trade.highestPrice,
        lowestPrice: trade.lowestPrice,
        indicatorSnapshot: trade.indicatorSnapshot,
      },
    })

    // Update the original trade: reduce lot size, increment partial closes
    const remainingTrade = await db.trade.update({
      where: { id: tradeId },
      data: {
        lotSize: remainingLotSize,
        partialCloses: trade.partialCloses + 1,
        executionState: 'PARTIAL_FILLED',
        // Store the original lot size on first partial close
        originalLotSize: trade.originalLotSize ?? trade.lotSize,
      },
    })

    // Emit partial close event
    await tradeEventBus.emit({
      tradeId,
      symbol: trade.symbol,
      event: TRADE_EVENTS.PARTIAL_CLOSE_EXECUTED,
      fromStatus,
      toStatus: 'PARTIAL_FILLED',
      reason: closeReason,
      pnl,
      metadata: {
        closedTradeId: closedTrade.id,
        closePercentage,
        closeLotSize,
        remainingLotSize,
        closePrice,
        partialCloseNumber: trade.partialCloses + 1,
        direction: trade.direction,
      },
      timestamp: new Date(),
    })

    // Update daily performance
    await updateDailyPerformance({
      type: 'CLOSE',
      pnl,
      isWin: pnl > 0,
      commission: trade.commission * (closeLotSize / currentLotSize),
      sizingMethod: trade.sizingMethod ?? undefined,
    })

    // Audit trail
    await logAuditTrail({
      action: 'PARTIAL_CLOSE_EXECUTED',
      category: 'TRADE_EXECUTION',
      fieldName: 'lotSize',
      oldValue: String(currentLotSize),
      newValue: String(remainingLotSize),
      reason: closeReason,
      performedBy: 'SYSTEM',
    })

    logger.info('TRADE_EXECUTION', `Partial close executed for ${trade.symbol}`, {
      tradeId,
      symbol: trade.symbol,
      metadata: {
        closedTradeId: closedTrade.id,
        closePercentage,
        closeLotSize,
        remainingLotSize,
        pnl,
        reason: closeReason,
      },
    })

    return { success: true, closedTrade, remainingTrade }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('TRADE_EXECUTION', `Failed to execute partial close for ${tradeId}`, {
      tradeId,
      details: errMsg,
    })
    return { success: false, error: errMsg }
  }
}

/**
 * Check partial close triggers for all trades given a price update map.
 *
 * For trades that are OPEN or PARTIAL_FILLED (and have TP targets that
 * can define partial close levels), checks if the price has reached the
 * next unexecuted partial close level. Executes the partial close if so.
 *
 * Returns aggregate counts of triggered partial closes and errors.
 */
export async function checkPartialCloseTriggers(
  priceUpdate: Map<string, number>,
): Promise<{ triggered: number; errors: number }> {
  let triggered = 0
  let errors = 0

  try {
    const eligibleTrades = await db.trade.findMany({
      where: {
        status: { in: ['OPEN', 'PARTIAL_FILLED'] },
        lotSize: { gt: 0 },
      },
    })

    for (const trade of eligibleTrades) {
      const newPrice = priceUpdate.get(trade.symbol)
      if (newPrice === undefined) continue

      try {
        const levels = calculatePartialCloseLevels({
          entryPrice: trade.entryPrice,
          direction: trade.direction,
          tp: trade.tp,
          sl: trade.sl,
          lotSize: trade.lotSize,
        })

        // Determine which levels have already been executed
        // based on the number of partial closes
        const executedCount = trade.partialCloses

        // Find the next unexecuted level
        if (executedCount >= levels.length) continue

        const nextLevel = levels[executedCount]
        if (nextLevel.executed) continue

        // Check if price has reached the target
        const isBuy = trade.direction === 'BUY'
        const priceReached = isBuy
          ? newPrice >= nextLevel.targetPrice
          : newPrice <= nextLevel.targetPrice

        if (!priceReached) continue

        // Execute the partial close
        const result = await executePartialClose(
          trade.id,
          nextLevel.percentage,
          `PARTIAL_CLOSE_${nextLevel.closeAt}@${nextLevel.targetPrice}`,
        )

        if (result.success) {
          triggered++
        } else {
          errors++
          logger.warn('TRADE_EXECUTION', `Partial close trigger failed for ${trade.id}`, {
            tradeId: trade.id,
            symbol: trade.symbol,
            details: result.error,
          })
        }
      } catch (err) {
        errors++
        logger.error('TRADE_EXECUTION', `Error checking partial close for trade`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          details: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    errors++
    logger.error('TRADE_EXECUTION', 'Failed to fetch trades for partial close check', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  if (triggered > 0) {
    logger.info('TRADE_EXECUTION', `Partial closes triggered: ${triggered}`, {
      metadata: { triggered, errors },
    })
  }

  return { triggered, errors }
}

// ============================================
// POSITION SYNC MECHANISM
// ============================================

/** A broker position as reported by MT5. */
export interface BrokerPosition {
  mt5Ticket: string
  symbol: string
  direction: string
  lotSize: number
  entryPrice: number
  currentPrice: number
  sl: number
  tp: number
}

/**
 * Synchronize local DB open trades with broker positions.
 *
 * Compares the set of local OPEN trades against the broker's position list
 * and reconciles differences:
 *   - **Missing**: Positions in broker but not in local DB (potential data gap)
 *   - **Extra**: Positions in local DB but not in broker (broker closed them
 *     — marks them as CLOSED with reason='BROKER_SYNC')
 *   - **Mismatches**: Positions in both but with different prices/SL/TP
 *     (updates local DB to match broker)
 *
 * Returns sync statistics.
 */
export async function syncPositionsWithBroker(
  brokerPositions: Array<BrokerPosition>,
): Promise<{ synced: number; missing: string[]; extra: string[]; updated: number }> {
  const missing: string[] = []
  const extra: string[] = []
  let synced = 0
  let updated = 0

  try {
    const localOpenTrades = await db.trade.findMany({
      where: { status: 'OPEN' },
    })

    // Build lookup maps
    const localBySymbol: Map<string, typeof localOpenTrades> = new Map()
    for (const t of localOpenTrades) {
      const list = localBySymbol.get(t.symbol) ?? []
      list.push(t)
      localBySymbol.set(t.symbol, list)
    }

    const brokerByTicket: Map<string, BrokerPosition> = new Map()
    const brokerBySymbol: Map<string, BrokerPosition[]> = new Map()
    for (const bp of brokerPositions) {
      brokerByTicket.set(bp.mt5Ticket, bp)
      const list = brokerBySymbol.get(bp.symbol) ?? []
      list.push(bp)
      brokerBySymbol.set(bp.symbol, list)
    }

    // Find extra positions (local has them but broker doesn't)
    for (const localTrade of localOpenTrades) {
      const brokerTrades = brokerBySymbol.get(localTrade.symbol) ?? []
      const matched = brokerTrades.find(
        (bp) =>
          bp.direction === localTrade.direction &&
          Math.abs(bp.lotSize - localTrade.lotSize) < 0.001 &&
          Math.abs(bp.entryPrice - localTrade.entryPrice) < 0.01,
      )

      if (!matched) {
        extra.push(localTrade.id)
        // Mark the local trade as closed — broker has closed it
        try {
          await db.trade.update({
            where: { id: localTrade.id },
            data: {
              status: 'CLOSED',
              executionState: 'CANCELLED',
              closePrice: localTrade.currentPrice,
              reason: 'BROKER_SYNC',
              closeTime: new Date(),
              pnl: calculatePnl(
                localTrade.direction,
                localTrade.entryPrice,
                localTrade.currentPrice,
                localTrade.lotSize,
                localTrade.commission,
              ),
            },
          })
          synced++

          await tradeEventBus.emit({
            tradeId: localTrade.id,
            symbol: localTrade.symbol,
            event: TRADE_EVENTS.TRADE_CLOSED,
            fromStatus: 'OPEN',
            toStatus: 'CLOSED',
            reason: 'BROKER_SYNC',
            timestamp: new Date(),
          })

          logger.warn('TRADE_EXECUTION', `Broker sync: closing extra local trade ${localTrade.id}`, {
            tradeId: localTrade.id,
            symbol: localTrade.symbol,
            metadata: { reason: 'Position exists locally but not in broker' },
          })
        } catch (err) {
          logger.error('TRADE_EXECUTION', `Failed to close extra trade during broker sync`, {
            tradeId: localTrade.id,
            details: err instanceof Error ? err.message : String(err),
          })
        }
      } else {
        // Check for mismatches in price/sl/tp
        const priceMismatch = Math.abs(matched.currentPrice - localTrade.currentPrice) > 0.001
        const slMismatch = matched.sl !== localTrade.sl &&
          !(matched.sl === 0 && localTrade.sl === null) &&
          !(matched.sl === localTrade.sl)
        const tpMismatch = matched.tp !== localTrade.tp &&
          !(matched.tp === 0 && localTrade.tp === null) &&
          !(matched.tp === localTrade.tp)

        if (priceMismatch || slMismatch || tpMismatch) {
          try {
            await db.trade.update({
              where: { id: localTrade.id },
              data: {
                currentPrice: matched.currentPrice,
                sl: matched.sl || null,
                tp: matched.tp || null,
              },
            })
            updated++
            synced++

            logger.info('TRADE_EXECUTION', `Broker sync: updated trade ${localTrade.id}`, {
              tradeId: localTrade.id,
              symbol: localTrade.symbol,
              metadata: {
                priceMismatch,
                slMismatch,
                tpMismatch,
                brokerPrice: matched.currentPrice,
                brokerSl: matched.sl,
                brokerTp: matched.tp,
              },
            })
          } catch (err) {
            logger.error('TRADE_EXECUTION', `Failed to update trade during broker sync`, {
              tradeId: localTrade.id,
              details: err instanceof Error ? err.message : String(err),
            })
          }
        }
      }
    }

    // Find missing positions (broker has them but local doesn't)
    for (const bp of brokerPositions) {
      const localTrades = localBySymbol.get(bp.symbol) ?? []
      const matched = localTrades.find(
        (t) =>
          t.direction === bp.direction &&
          Math.abs(t.lotSize - bp.lotSize) < 0.001 &&
          Math.abs(t.entryPrice - bp.entryPrice) < 0.01,
      )

      if (!matched) {
        missing.push(bp.mt5Ticket)
      }
    }

    logger.info('TRADE_EXECUTION', `Broker sync complete`, {
      metadata: { synced, updated, missingCount: missing.length, extraCount: extra.length },
    })
  } catch (err) {
    logger.error('TRADE_EXECUTION', 'Broker sync failed', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  return { synced, missing, extra, updated }
}

// ============================================
// PRICE UPDATE PIPELINE (ORCHESTRATOR)
// ============================================

/** Result of a price update pipeline run. */
export interface PriceUpdateResult {
  trailingAdjusted: number
  slTriggered: number
  tpTriggered: number
  partialCloses: number
  errors: number
  durationMs: number
}

/**
 * Process a price update through the full pipeline.
 *
 * Execution order:
 *   1. Trailing stops (adjust SL before checking SL triggers)
 *   2. SL/TP triggers (close trades that hit stops/targets)
 *   3. Partial close triggers (execute scaled exits)
 *
 * Returns aggregate results from all pipeline stages.
 */
export async function processPriceUpdate(
  priceUpdate: Map<string, number>,
): Promise<PriceUpdateResult> {
  const startTime = Date.now()
  let trailingAdjusted = 0
  let slTriggered = 0
  let tpTriggered = 0
  let partialCloses = 0
  let errors = 0

  try {
    // Stage 1: Trailing stops — adjust SL levels before we check SL triggers
    const trailingResult = await processTrailingStopsForAllTrades(priceUpdate)
    trailingAdjusted = trailingResult.adjusted
    errors += trailingResult.errors

    // Stage 2: SL/TP triggers — close trades that hit their stops or targets
    const slTpResult = await processSlTpForAllOpenTrades(priceUpdate)
    slTriggered = slTpResult.slTriggered
    tpTriggered = slTpResult.tpTriggered
    errors += slTpResult.errors

    // Stage 3: Partial close triggers — execute scaled exits at TP levels
    const partialResult = await checkPartialCloseTriggers(priceUpdate)
    partialCloses = partialResult.triggered
    errors += partialResult.errors
  } catch (err) {
    errors++
    logger.error('TRADE_EXECUTION', 'Price update pipeline error', {
      details: err instanceof Error ? err.message : String(err),
      metadata: { symbolCount: priceUpdate.size },
    })
  }

  const durationMs = Date.now() - startTime

  logger.info('TRADE_EXECUTION', `Price update pipeline completed`, {
    metadata: {
      symbolCount: priceUpdate.size,
      trailingAdjusted,
      slTriggered,
      tpTriggered,
      partialCloses,
      errors,
      durationMs,
    },
  })

  return { trailingAdjusted, slTriggered, tpTriggered, partialCloses, errors, durationMs }
}

// ============================================
// EMERGENCY CLOSE ALL
// ============================================

/**
 * Emergency close all open positions.
 *
 * Closes ALL open positions regardless of SL/TP settings. Used for:
 *   - Margin calls
 *   - Connection loss
 *   - Manual emergency shutdown
 *   - Risk engine escalation
 *
 * Each trade is closed at its current price with the given reason.
 * Emits an EMERGENCY_CLOSE_ALL event for each trade and updates daily
 * performance. Uses the CANCELLED state for the trade since the close
 * is forced by the system, not by normal SL/TP/manual action.
 *
 * @param reason - The emergency reason (default: 'EMERGENCY').
 */
export async function emergencyCloseAll(
  reason: string = 'EMERGENCY',
): Promise<{ closed: number; errors: number; totalPnl: number }> {
  let closed = 0
  let errors = 0
  let totalPnl = 0

  logger.critical('TRADE_EXECUTION', `EMERGENCY CLOSE ALL initiated: ${reason}`, {
    metadata: { reason },
  })

  try {
    const openTrades = await db.trade.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL_FILLED'] } },
    })

    logger.warn('TRADE_EXECUTION', `Emergency closing ${openTrades.length} positions`, {
      metadata: { reason, tradeCount: openTrades.length },
    })

    for (const trade of openTrades) {
      try {
        const fromStatus = trade.status as TradeStatus
        const pnl = calculatePnl(
          trade.direction,
          trade.entryPrice,
          trade.currentPrice,
          trade.lotSize,
          trade.commission,
        )
        const pnlPercent = calculatePnlPercent(pnl, trade.margin)

        // Update trade to CLOSED status via CANCELLED execution state
        await db.trade.update({
          where: { id: trade.id },
          data: {
            status: 'CLOSED',
            executionState: 'CANCELLED',
            closePrice: trade.currentPrice,
            pnl,
            pnlPercent,
            reason,
            closeTime: new Date(),
          },
        })

        totalPnl += pnl
        closed++

        // Emit emergency close event
        await tradeEventBus.emit({
          tradeId: trade.id,
          symbol: trade.symbol,
          event: TRADE_EVENTS.EMERGENCY_CLOSE_ALL,
          fromStatus,
          toStatus: 'CLOSED',
          reason,
          pnl,
          metadata: {
            closePrice: trade.currentPrice,
            lotSize: trade.lotSize,
            direction: trade.direction,
            strategy: trade.strategy,
          },
          timestamp: new Date(),
        })

        // Update daily performance for each closed trade
        await updateDailyPerformance({
          type: 'CLOSE',
          pnl,
          isWin: pnl > 0,
          commission: trade.commission,
          slippage: trade.slippage,
          sizingMethod: trade.sizingMethod ?? undefined,
        })

        logger.warn('TRADE_EXECUTION', `Emergency closed trade ${trade.id}`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          metadata: {
            reason,
            pnl,
            pnlPercent,
            lotSize: trade.lotSize,
          },
        })
      } catch (err) {
        errors++
        logger.error('TRADE_EXECUTION', `Failed to emergency close trade ${trade.id}`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          details: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    errors++
    logger.error('TRADE_EXECUTION', 'Failed to fetch open trades for emergency close', {
      details: err instanceof Error ? err.message : String(err),
    })
  }

  // Audit trail for emergency action
  await logAuditTrail({
    action: 'EMERGENCY_CLOSE_ALL',
    category: 'TRADE_EXECUTION',
    reason,
    performedBy: 'SYSTEM',
  })

  logger.critical('TRADE_EXECUTION', `EMERGENCY CLOSE ALL completed`, {
    metadata: { closed, errors, totalPnl, reason },
  })

  return { closed, errors, totalPnl }
}

// ============================================
// EXECUTION PIPELINE INTEGRATION
// ============================================

/** Parameters for the full trade execution pipeline. */
export interface ExecuteTradeParams {
  symbol: string
  direction: 'BUY' | 'SELL'
  lotSize: number
  price: number
  sl?: number
  tp?: number
  strategy?: string
  timeframe?: string
  marketCond?: string
  aiConfidence?: number
  indicatorSnapshot?: string
  comment?: string
}

/** Result of the full trade execution pipeline. */
export interface ExecuteTradeResult {
  success: boolean
  trade?: any
  orderResult?: OrderExecutionResult
  error?: string
}

/**
 * Full trade execution pipeline.
 *
 * Orchestrates the complete lifecycle of opening a new trade:
 *
 *   1. Create a PendingOrder record (status=PENDING)
 *   2. Call executeOrderWithRetry to submit to MT5
 *   3. On success:
 *      a. Create Trade record (status=OPEN)
 *      b. Update PendingOrder to FILLED with linkedTradeId
 *      c. Emit TRADE_OPENED event
 *      d. Update daily performance (OPEN)
 *   4. On failure:
 *      a. Update PendingOrder to REJECTED
 *      b. Create Trade record with status=REJECTED
 *      c. Emit TRADE_REJECTED event
 *   5. Log all operations with correlation
 *   6. Return the result
 *
 * @param params - Trade execution parameters.
 */
export async function executeTrade(
  params: ExecuteTradeParams,
): Promise<ExecuteTradeResult> {
  const {
    symbol,
    direction,
    lotSize,
    price,
    sl,
    tp,
    strategy,
    timeframe,
    marketCond,
    aiConfidence,
    indicatorSnapshot,
    comment,
  } = params

  const correlationId = `EXEC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  logger.info('TRADE_EXECUTION', `Starting execution pipeline for ${symbol} ${direction}`, {
    symbol,
    source: 'executeTrade',
    tradeId: correlationId,
    metadata: {
      direction,
      lotSize,
      price,
      sl: sl ?? null,
      tp: tp ?? null,
      strategy,
      timeframe,
      aiConfidence,
      comment,
    },
  })

  // Step 1: Create PendingOrder record
  let pendingOrder: any
  try {
    pendingOrder = await db.pendingOrder.create({
      data: {
        symbol,
        orderType: 'MARKET',
        direction,
        lotSize,
        price,
        sl: sl ?? null,
        tp: tp ?? null,
        status: 'PENDING',
        strategy: strategy ?? null,
        timeframe: timeframe ?? null,
      },
    })

    logger.info('TRADE_EXECUTION', `Pending order created: ${pendingOrder.id}`, {
      symbol,
      tradeId: correlationId,
      metadata: { pendingOrderId: pendingOrder.id, orderType: 'MARKET' },
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('TRADE_EXECUTION', `Failed to create pending order for ${symbol}`, {
      symbol,
      tradeId: correlationId,
      details: errMsg,
    })
    return { success: false, error: `Failed to create pending order: ${errMsg}` }
  }

  // Step 2: Submit order to MT5 via retry pipeline
  let orderResult: OrderExecutionResult
  try {
    orderResult = await executeOrderWithRetry({
      symbol,
      direction,
      lotSize,
      price,
      sl,
      tp,
      comment: comment ?? `FINEX-${strategy ?? 'MANUAL'}-${correlationId}`,
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('TRADE_EXECUTION', `Order execution threw error for ${symbol}`, {
      symbol,
      tradeId: correlationId,
      details: errMsg,
    })

    // Update pending order to rejected
    try {
      await db.pendingOrder.update({
        where: { id: pendingOrder.id },
        data: {
          status: 'REJECTED',
          reason: `EXECUTION_ERROR: ${errMsg}`,
          mt5ErrorDesc: errMsg,
        },
      })
    } catch (updateErr) {
      logger.error('TRADE_EXECUTION', `Failed to update pending order to REJECTED`, {
        symbol,
        tradeId: correlationId,
        details: updateErr instanceof Error ? updateErr.message : String(updateErr),
      })
    }

    // Create rejected trade record
    try {
      await db.trade.create({
        data: {
          symbol,
          direction,
          lotSize,
          entryPrice: price,
          currentPrice: price,
          sl: sl ?? null,
          tp: tp ?? null,
          status: 'REJECTED',
          executionState: 'CANCELLED',
          strategy: strategy ?? null,
          timeframe: timeframe ?? null,
          marketCond: marketCond ?? null,
          aiConfidence: aiConfidence ?? null,
          indicatorSnapshot: indicatorSnapshot ?? null,
          rejectReason: `EXECUTION_ERROR: ${errMsg}`,
          mt5ErrorDesc: errMsg,
        },
      })
    } catch (createErr) {
      logger.error('TRADE_EXECUTION', `Failed to create rejected trade record`, {
        symbol,
        tradeId: correlationId,
        details: createErr instanceof Error ? createErr.message : String(createErr),
      })
    }

    return { success: false, error: `Order execution error: ${errMsg}` }
  }

  // Step 3: Handle result — success or failure
  if (!orderResult.success) {
    // ---- FAILURE PATH ----
    logger.warn('TRADE_EXECUTION', `Order rejected for ${symbol} after ${orderResult.attempts} attempts`, {
      symbol,
      tradeId: correlationId,
      metadata: {
        mt5ErrorCode: orderResult.mt5ErrorCode,
        mt5ErrorDesc: orderResult.mt5ErrorDesc,
        attempts: orderResult.attempts,
        totalLatencyMs: orderResult.totalLatencyMs,
      },
    })

    // Update pending order to REJECTED
    try {
      await db.pendingOrder.update({
        where: { id: pendingOrder.id },
        data: {
          status: 'REJECTED',
          reason: orderResult.mt5ErrorDesc ?? 'UNKNOWN_REJECTION',
          mt5ErrorCode: orderResult.mt5ErrorCode ?? null,
          mt5ErrorDesc: orderResult.mt5ErrorDesc ?? null,
        },
      })
    } catch (err) {
      logger.error('TRADE_EXECUTION', `Failed to update pending order to REJECTED`, {
        symbol,
        tradeId: correlationId,
        details: err instanceof Error ? err.message : String(err),
      })
    }

    // Create rejected trade record
    let rejectedTrade: any
    try {
      rejectedTrade = await db.trade.create({
        data: {
          symbol,
          direction,
          lotSize,
          entryPrice: price,
          currentPrice: price,
          sl: sl ?? null,
          tp: tp ?? null,
          status: 'REJECTED',
          executionState: 'CANCELLED',
          strategy: strategy ?? null,
          timeframe: timeframe ?? null,
          marketCond: marketCond ?? null,
          aiConfidence: aiConfidence ?? null,
          indicatorSnapshot: indicatorSnapshot ?? null,
          rejectReason: orderResult.mt5ErrorDesc ?? 'UNKNOWN_REJECTION',
          mt5ErrorCode: orderResult.mt5ErrorCode ?? null,
          mt5ErrorDesc: orderResult.mt5ErrorDesc ?? null,
        },
      })
    } catch (err) {
      logger.error('TRADE_EXECUTION', `Failed to create rejected trade record`, {
        symbol,
        tradeId: correlationId,
        details: err instanceof Error ? err.message : String(err),
      })
    }

    // Emit trade rejected event
    await tradeEventBus.emit({
      tradeId: correlationId,
      symbol,
      event: TRADE_EVENTS.TRADE_REJECTED,
      fromStatus: 'PENDING',
      toStatus: 'REJECTED',
      reason: orderResult.mt5ErrorDesc ?? 'UNKNOWN_REJECTION',
      metadata: {
        mt5ErrorCode: orderResult.mt5ErrorCode,
        attempts: orderResult.attempts,
        totalLatencyMs: orderResult.totalLatencyMs,
        direction,
        lotSize,
        price,
      },
      timestamp: new Date(),
    })

    // Audit trail
    await logAuditTrail({
      action: 'TRADE_REJECTED',
      category: 'TRADE_EXECUTION',
      fieldName: 'status',
      oldValue: 'PENDING',
      newValue: 'REJECTED',
      reason: orderResult.mt5ErrorDesc ?? 'UNKNOWN_REJECTION',
      performedBy: 'SYSTEM',
    })

    return {
      success: false,
      trade: rejectedTrade,
      orderResult,
      error: orderResult.mt5ErrorDesc ?? 'Order rejected by broker',
    }
  }

  // ---- SUCCESS PATH ----
  const fillPrice = orderResult.fillPrice ?? price
  const fillLot = orderResult.fillLot ?? lotSize
  const slippage = Math.abs(fillPrice - price) * fillLot * PIP_VALUE_PER_LOT

  // Calculate margin: (entryPrice * lotSize * 100000) / leverage
  const leverage = 25 // Default leverage
  const margin = (fillPrice * fillLot * PIP_VALUE_PER_LOT) / leverage

  // Create the Trade record
  let trade: any
  try {
    trade = await db.trade.create({
      data: {
        symbol,
        direction,
        lotSize: fillLot,
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        sl: sl ?? null,
        tp: tp ?? null,
        pnl: 0,
        pnlPercent: 0,
        status: 'OPEN',
        executionState: 'FILLED',
        strategy: strategy ?? null,
        timeframe: timeframe ?? null,
        marketCond: marketCond ?? null,
        aiConfidence: aiConfidence ?? null,
        leverage,
        commission: 0, // Commission applied at close
        slippage,
        margin,
        openTime: new Date(),
        indicatorSnapshot: indicatorSnapshot ?? null,
        highestPrice: fillPrice,
        lowestPrice: fillPrice,
        originalLotSize: fillLot,
        partialCloses: 0,
      },
    })

    logger.info('TRADE_EXECUTION', `Trade created: ${trade.id}`, {
      symbol,
      tradeId: trade.id,
      metadata: {
        direction,
        fillPrice,
        fillLot,
        sl: sl ?? null,
        tp: tp ?? null,
        margin,
        slippage,
        orderId: orderResult.orderId,
        attempts: orderResult.attempts,
        totalLatencyMs: orderResult.totalLatencyMs,
      },
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('TRADE_EXECUTION', `Failed to create trade record for ${symbol}`, {
      symbol,
      tradeId: correlationId,
      details: errMsg,
    })

    // Update pending order to reflect the issue
    try {
      await db.pendingOrder.update({
        where: { id: pendingOrder.id },
        data: {
          status: 'REJECTED',
          reason: `TRADE_CREATE_ERROR: ${errMsg}`,
        },
      })
    } catch (_) {
      // Best effort
    }

    return { success: false, error: `Failed to create trade record: ${errMsg}` }
  }

  // Update PendingOrder to FILLED with linked trade ID
  try {
    await db.pendingOrder.update({
      where: { id: pendingOrder.id },
      data: {
        status: 'FILLED',
        orderId: orderResult.orderId ?? null,
        linkedTradeId: trade.id,
      },
    })
  } catch (err) {
    logger.warn('TRADE_EXECUTION', `Failed to update pending order to FILLED (non-critical)`, {
      symbol,
      tradeId: trade.id,
      details: err instanceof Error ? err.message : String(err),
    })
    // Non-critical: trade is already open, just the pending order link is broken
  }

  // Emit TRADE_OPENED event
  await tradeEventBus.emit({
    tradeId: trade.id,
    symbol,
    event: TRADE_EVENTS.TRADE_OPENED,
    fromStatus: 'PENDING',
    toStatus: 'OPEN',
    metadata: {
      direction,
      fillPrice,
      fillLot,
      sl: sl ?? null,
      tp: tp ?? null,
      margin,
      slippage,
      orderId: orderResult.orderId,
      attempts: orderResult.attempts,
      totalLatencyMs: orderResult.totalLatencyMs,
      strategy,
      timeframe,
      aiConfidence,
      marketCond,
    },
    timestamp: new Date(),
  })

  // Update daily performance (OPEN)
  await updateDailyPerformance({ type: 'OPEN' })

  // Audit trail
  await logAuditTrail({
    action: 'TRADE_OPENED',
    category: 'TRADE_EXECUTION',
    fieldName: 'status',
    oldValue: 'PENDING',
    newValue: 'OPEN',
    reason: `Order filled via ${orderResult.orderId ?? 'unknown'}`,
    performedBy: 'SYSTEM',
  })

  logger.info('TRADE_EXECUTION', `Execution pipeline completed successfully for ${symbol} ${direction}`, {
    symbol,
    tradeId: trade.id,
    metadata: {
      tradeId: trade.id,
      fillPrice,
      fillLot,
      orderId: orderResult.orderId,
      totalLatencyMs: orderResult.totalLatencyMs,
    },
  })

  return { success: true, trade, orderResult }
}
