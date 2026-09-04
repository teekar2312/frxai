/*
 * Trade Execution Engine — PART 9/10: emergency-close.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 2009-2167):
 *   - EMERGENCY CLOSE ALL (emergencyCloseAll) — margin call / connection
 *     loss / manual emergency shutdown handler.
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { closeAllPositionsAtBridge } from '@/lib/mt5-connection'
import { updateDailyPerformance } from '@/lib/money-management'
import { logAuditTrail } from '@/lib/risk-engine'
import type { TradeStatus } from './types'
import { tradeEventBus, TRADE_EVENTS } from './lifecycle'
import { calculatePnl, calculatePnlPercent } from './pnl'

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
    // Attempt broker-side close-all via MT5 bridge
    try {
      const bridgeResult = await closeAllPositionsAtBridge()
      if (bridgeResult.success) {
        logger.info('TRADE_EXECUTION', `Bridge closed ${bridgeResult.closed} positions`)
      }
    } catch (err) {
      logger.warn('TRADE_EXECUTION', `Bridge close-all error: ${err instanceof Error ? err.message : String(err)}`)
    }

    const openTrades = await db.trade.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL_FILLED'] } },
    })

    logger.warn('TRADE_EXECUTION', `Emergency closing ${openTrades.length} positions`, {
      metadata: { reason, tradeCount: openTrades.length },
    })

    for (const trade of openTrades) {
      try {
        const fromStatus = trade.status as TradeStatus
        const exitCommission = trade.lotSize * 1 // $1/lot exit commission (FINEX spec)
        const totalCommission = trade.commission + exitCommission
        const pnl = calculatePnl(
          trade.direction,
          trade.entryPrice,
          trade.currentPrice,
          trade.lotSize,
          totalCommission,
        )
        const pnlPercent = calculatePnlPercent(pnl, trade.margin)

        // Atomic update with status precondition to prevent races
        const updateResult = await db.trade.updateMany({
          where: { id: trade.id, status: { in: ['OPEN', 'PARTIAL_FILLED'] } },
          data: {
            status: 'CLOSED',
            executionState: 'CANCELLED',
            closePrice: trade.currentPrice,
            currentPrice: trade.currentPrice,
            pnl,
            pnlPercent,
            commission: totalCommission,
            reason,
            closeTime: new Date(),
          },
        })

        if (updateResult.count === 0) {
          logger.warn('TRADE_EXECUTION', `Emergency close skipped for ${trade.id} — already closed`, {
            tradeId: trade.id,
            symbol: trade.symbol,
          })
          continue // skip this trade but continue with others
        }

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
          commission: totalCommission,
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
