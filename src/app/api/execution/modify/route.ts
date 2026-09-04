import { NextRequest, NextResponse } from 'next/server'
import { modifyPositionAtBridge } from '@/lib/mt5-connection'
import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { logAuditTrail } from '@/lib/risk-engine'
import { apiErrorResponse } from '@/lib/api-errors'

/**
 * PATCH /api/execution/modify — Modify SL/TP on an open trade
 *
 * Request body:
 *   tradeId: string (required)
 *   sl?: number
 *   tp?: number
 */

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { tradeId, sl, tp } = body

    if (!tradeId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: tradeId' },
        { status: 400 },
      )
    }

    if (sl === undefined && tp === undefined) {
      return NextResponse.json(
        { success: false, error: 'At least one of sl or tp must be provided' },
        { status: 400 },
      )
    }

    // Find the trade
    const trade = await db.trade.findUnique({ where: { id: tradeId } })

    if (!trade) {
      return NextResponse.json(
        { success: false, error: `Trade not found: ${tradeId}` },
        { status: 404 },
      )
    }

    if (trade.status !== 'OPEN') {
      return NextResponse.json(
        { success: false, error: `Trade ${tradeId} is not OPEN (status: ${trade.status})` },
        { status: 400 },
      )
    }

    if (!trade.mt5Ticket) {
      return NextResponse.json(
        { success: false, error: `Trade ${tradeId} has no MT5 ticket — cannot modify at broker` },
        { status: 400 },
      )
    }

    // Send modification to bridge
    try {
      const bridgeResult = await modifyPositionAtBridge({
        ticket: trade.mt5Ticket,
        symbol: trade.symbol,
        sl: sl !== undefined ? sl : undefined,
        tp: tp !== undefined ? tp : undefined,
      })

      if (!bridgeResult.success) {
        return NextResponse.json({
          success: false,
          error: bridgeResult.error || 'Bridge modification failed',
          mt5ErrorCode: bridgeResult.mt5ErrorCode,
        }, { status: 400 })
      }

      // Update DB
      const updateData: Record<string, unknown> = {}
      if (sl !== undefined) updateData.sl = sl
      if (tp !== undefined) updateData.tp = tp

      await db.trade.update({
        where: { id: tradeId },
        data: updateData,
      })

      // Audit trail
      const changes: string[] = []
      if (sl !== undefined) changes.push(`SL: ${trade.sl} → ${sl}`)
      if (tp !== undefined) changes.push(`TP: ${trade.tp} → ${tp}`)
      await logAuditTrail({
        action: 'MODIFY_TRADE',
        category: 'TRADE_EXECUTION',
        fieldName: 'sl/tp',
        oldValue: JSON.stringify({ sl: trade.sl, tp: trade.tp }),
        newValue: JSON.stringify({ sl, tp }),
        reason: changes.join(', '),
        performedBy: 'USER',
      })

      logger.info('TRADE_MODIFY', `Modified ${trade.symbol} trade ${tradeId}`, {
        symbol: trade.symbol,
        tradeId,
        metadata: { changes, mt5Ticket: trade.mt5Ticket },
      })

      return NextResponse.json({
        success: true,
        data: { tradeId, symbol: trade.symbol, sl: sl ?? trade.sl, tp: tp ?? trade.tp },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('TRADE_MODIFY', `Bridge modification failed for ${tradeId}`, {
        symbol: trade.symbol,
        tradeId,
        details: msg,
      })
      return NextResponse.json({ success: false, error: `Bridge error: ${msg}` }, { status: 502 })
    }
  } catch (err) {
    return apiErrorResponse(err, { route: 'PUT /api/execution/modify' })
  }
}
