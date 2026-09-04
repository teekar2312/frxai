/*
 * Trade Execution Engine — PART 7/10: position-sync.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 1600-1798):
 *   - POSITION SYNC MECHANISM (BrokerPosition, syncPositionsWithBroker)
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { updateDailyPerformance } from '@/lib/money-management'
import { tradeEventBus, TRADE_EVENTS } from './lifecycle'
import { calculatePnl } from './pnl'

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
          const exitCommission = localTrade.lotSize * 1 // $1/lot exit commission (FINEX spec)
          const totalCommission = localTrade.commission + exitCommission
          const syncPnl = calculatePnl(
            localTrade.direction,
            localTrade.entryPrice,
            // Note: Using local currentPrice as broker doesn't provide close price for synced-out positions.
            // The price may be slightly stale if no recent price updates were received.
            localTrade.currentPrice,
            localTrade.lotSize,
            totalCommission,
          )
          await db.trade.update({
            where: { id: localTrade.id },
            data: {
              status: 'CLOSED',
              executionState: 'CANCELLED',
              closePrice: localTrade.currentPrice,
              reason: 'BROKER_SYNC',
              closeTime: new Date(),
              pnl: syncPnl,
              commission: totalCommission,
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

          // Update daily performance for broker-synced close
          await updateDailyPerformance({
            type: 'CLOSE',
            pnl: syncPnl,
            isWin: syncPnl > 0,
            commission: totalCommission,
            sizingMethod: localTrade.sizingMethod ?? undefined,
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
