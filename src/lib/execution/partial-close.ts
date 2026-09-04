/*
 * Trade Execution Engine — PART 6/10: partial-close.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 85-86, 1250-1598):
 *   - PARTIAL CLOSE ENGINE (PartialCloseLevel, calculatePartialCloseLevels,
 *     executePartialClose, checkPartialCloseTriggers)
 *   - Module-private constant DEFAULT_ATR_ESTIMATE (sole consumer lives in
 *     this part)
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { updateDailyPerformance } from '@/lib/money-management'
import { trackSessionPerformance } from '@/lib/session-manager'
import { logAuditTrail } from '@/lib/risk-engine'
import type { TradeRecord, TradeStatus } from './types'
import { tradeEventBus, TRADE_EVENTS } from './lifecycle'
import { calculatePnl, calculatePnlPercent } from './pnl'

/** Default ATR estimate for partial close levels when no TP is set. */
const DEFAULT_ATR_ESTIMATE = 0.005

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
): Promise<{ success: boolean; closedTrade?: TradeRecord; remainingTrade?: TradeRecord; error?: string }> {
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

    // Track session performance
    await trackSessionPerformance({ isClose: true, pnl })

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
    const symbols = Array.from(priceUpdate.keys())
    const eligibleTrades = await db.trade.findMany({
      where: {
        status: { in: ['OPEN', 'PARTIAL_FILLED'] },
        lotSize: { gt: 0 },
        symbol: { in: symbols },
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
