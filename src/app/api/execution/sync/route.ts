import { NextResponse } from 'next/server'
import { getPositionsFromBridge } from '@/lib/mt5-connection'
import { syncPositionsWithBroker, type BrokerPosition } from '@/lib/trade-execution-engine'
import mt5Connection from '@/lib/mt5-connection'
import logger from '@/lib/trading-logger'

/**
 * POST /api/execution/sync — Sync local DB positions with broker
 *
 * Fetches live positions from the MT5 bridge and reconciles
 * with the local Trade table.
 */

export async function POST() {
  try {
    if (!mt5Connection.isConnected()) {
      return NextResponse.json(
        { success: false, error: 'MT5 is not connected' },
        { status: 400 },
      )
    }

    // Get broker positions
    const rawPositions = await getPositionsFromBridge()

    // Map bridge response to BrokerPosition interface
    const brokerPositions: BrokerPosition[] = rawPositions.map((p: Record<string, unknown>) => ({
      mt5Ticket: String(p.ticket ?? p.mt5Ticket ?? ''),
      symbol: String(p.symbol ?? ''),
      direction: String(p.direction ?? p.type ?? ''),
      lotSize: Number(p.lotSize ?? p.volume ?? 0),
      entryPrice: Number(p.entryPrice ?? p.price_open ?? 0),
      currentPrice: Number(p.currentPrice ?? p.price_current ?? 0),
      sl: Number(p.sl ?? 0),
      tp: Number(p.tp ?? 0),
    }))

    logger.info('POSITION_SYNC', `Fetched ${brokerPositions.length} positions from broker`)

    // Sync with local DB
    const syncResult = await syncPositionsWithBroker(brokerPositions)

    return NextResponse.json({
      success: true,
      data: {
        brokerPositionCount: brokerPositions.length,
        ...syncResult,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('POSITION_SYNC', `Sync failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
