/*
 * Trade Execution Engine — PART 4/10: trigger-engine.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 326-650):
 *   - SL / TP TRIGGER ENGINE (checkSlTpTrigger, processSlTpForAllOpenTrades,
 *     closeTrade)
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { closePositionAtBridge } from '@/lib/mt5-connection'
import { updateDailyPerformance } from '@/lib/money-management'
import { trackSessionPerformance } from '@/lib/session-manager'
import { logAuditTrail } from '@/lib/risk-engine'
import type { TradeRecord, TradeStatus } from './types'
import { tradeEventBus, TRADE_EVENTS } from './lifecycle'
import { calculatePnl, calculatePnlPercent } from './pnl'

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
    const symbols = Array.from(priceUpdate.keys())
    // Hot path: runs on every price update (price-pipeline). Enumerated from
    // checkSlTpTrigger's argument object + the trailing-reason check + event
    // metadata: id, symbol, direction, currentPrice, sl, tp, lotSize,
    // entryPrice, commission, margin, strategy, trailingStop, lastSlAdjust.
    // The heavy JSON columns (indicatorSnapshot, partialCloses) are never read.
    const openTrades = await db.trade.findMany({
      where: { status: 'OPEN', symbol: { in: symbols } },
      select: {
        id: true,
        symbol: true,
        direction: true,
        currentPrice: true,
        sl: true,
        tp: true,
        lotSize: true,
        entryPrice: true,
        commission: true,
        margin: true,
        strategy: true,
        trailingStop: true,
        lastSlAdjust: true,
      },
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
): Promise<{ success: boolean; trade?: TradeRecord; error?: string }> {
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

    // Attempt to close position on the broker via MT5 bridge.
    // Only possible when the trade carries a broker ticket — the DB trade id
    // is meaningless to the bridge (the old call sent the cuid, which the
    // bridge always rejected with 400 "ticket must be a positive number").
    if (trade.mt5Ticket) {
      try {
        const bridgeResult = await closePositionAtBridge(trade.mt5Ticket)
        if (!bridgeResult.success) {
          logger.warn('TRADE_EXECUTION', `Bridge close failed for ticket ${trade.mt5Ticket}: ${bridgeResult.error}, proceeding with DB close`)
        } else if (bridgeResult.closePrice) {
          // Use bridge-reported close price if available
          closePrice = bridgeResult.closePrice
        }
      } catch (err) {
        logger.warn('TRADE_EXECUTION', `Bridge close error for ticket ${trade.mt5Ticket}: ${err instanceof Error ? err.message : String(err)}, proceeding with DB close`)
      }
    }

    const exitCommission = trade.lotSize * 1 // $1/lot exit commission (FINEX spec)
    const totalCommission = trade.commission + exitCommission
    const pnl = calculatePnl(
      trade.direction,
      trade.entryPrice,
      finalClosePrice,
      trade.lotSize,
      totalCommission,
    )
    const pnlPercent = calculatePnlPercent(pnl, trade.margin)

    // Atomic update with status precondition to prevent double-close
    const updateResult = await db.trade.updateMany({
      where: { id: tradeId, status: { in: ['OPEN', 'PARTIAL_FILLED'] } },
      data: {
        status: 'CLOSED',
        executionState: 'CANCELLED',
        closePrice: finalClosePrice,
        currentPrice: finalClosePrice,
        pnl,
        pnlPercent,
        commission: totalCommission,
        reason,
        closeTime: new Date(),
      },
    })

    if (updateResult.count === 0) {
      return { success: false, error: `Trade ${tradeId} was already closed or in an invalid state (race condition prevented double-close)` }
    }

    // Construct the updated trade object for event emission and return
    const updatedTrade = { ...trade, status: 'CLOSED' as const, closePrice: finalClosePrice, currentPrice: finalClosePrice, pnl, pnlPercent, commission: totalCommission, reason, closeTime: new Date(), executionState: 'CANCELLED' as const }

    // Emit trade closed event
    await tradeEventBus.emit({
      tradeId,
      symbol: trade.symbol,
      event: TRADE_EVENTS.TRADE_CLOSED,
      fromStatus,
      toStatus: 'CLOSED',
      reason,
      pnl,
      pnlPercent,
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
      commission: totalCommission,
      slippage: trade.slippage,
      sizingMethod: trade.sizingMethod ?? undefined,
    })

    // Track session performance
    await trackSessionPerformance({ isClose: true, pnl })

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
