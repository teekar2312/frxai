/*
 * Trade Execution Engine — PART 10/10: pipeline.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 82-83, 2169-2620):
 *   - EXECUTION PIPELINE INTEGRATION (ExecuteTradeParams, ExecuteTradeResult,
 *     executeTrade) — full order → trade lifecycle
 *   - Module-private constant PIP_VALUE_PER_LOT (duplicate of the identical
 *     immutable literal in pnl.ts, needed here for slippage/margin math;
 *     kept private to preserve the original export set)
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { executeOrderWithRetry, type OrderExecutionResult } from '@/lib/mt5-connection'
import { updateDailyPerformance } from '@/lib/money-management'
import { trackSessionPerformance } from '@/lib/session-manager'
import { logAuditTrail } from '@/lib/risk-engine'
import type { TradeRecord, PendingOrderRecord } from './types'
import { tradeEventBus, TRADE_EVENTS } from './lifecycle'

/** Pip value per standard lot (100 000 units). */
const PIP_VALUE_PER_LOT = 100_000

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
  trade?: TradeRecord
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
  let pendingOrder: PendingOrderRecord
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
    let rejectedTrade: TradeRecord | undefined
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
  // Leverage defaults to 25 (not stored in RiskConfig)
  const leverage = 25
  const margin = (fillPrice * fillLot * PIP_VALUE_PER_LOT) / leverage

  // Create the Trade record
  let trade: TradeRecord | undefined
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
        commission: fillLot * 1, // $1 per lot entry commission (FINEX spec)
        slippage,
        margin,
        openTime: new Date(),
        indicatorSnapshot: indicatorSnapshot ?? null,
        highestPrice: fillPrice,
        lowestPrice: fillPrice,
        originalLotSize: fillLot,
        partialCloses: 0,
        // Broker ticket — the key for modify/close against the bridge
        // (was never persisted before; /api/execution/modify always 400'd)
        mt5Ticket: orderResult.ticket ?? null,
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
        mt5Ticket: orderResult.ticket ?? null,
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
      mt5Ticket: orderResult.ticket ?? null,
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

  // Track session performance (trade opened)
  await trackSessionPerformance({ isClose: false })

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
