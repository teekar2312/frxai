import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { updateDailyPerformance } from "@/lib/money-management"
import logger from "@/lib/trading-logger"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.trade.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Trade not found" },
        { status: 404 }
      )
    }

    // Handle closing a trade
    if (body.status === "CLOSED") {
      const closePrice = body.closePrice ?? existing.currentPrice
      const reason = body.reason ?? "Manual"

      let pnl = 0
      if (existing.direction === "BUY") {
        pnl = (closePrice - existing.entryPrice) * existing.lotSize * 100000
      } else {
        pnl = (existing.entryPrice - closePrice) * existing.lotSize * 100000
      }
      pnl -= existing.commission

      const pnlPercent = existing.margin > 0 ? (pnl / existing.margin) * 100 : 0

      const updated = await db.trade.update({
        where: { id },
        data: {
          status: "CLOSED",
          closePrice,
          closeTime: new Date(),
          pnl,
          pnlPercent,
          reason,
          currentPrice: closePrice,
        },
      })

      // Update daily performance
      await updateDailyPerformance({
        type: "CLOSE",
        pnl,
        isWin: pnl > 0,
      })

      logger.info("TRADE_EXECUTION", `Trade closed: ${existing.direction} ${existing.symbol} | PnL: $${pnl.toFixed(2)} | Reason: ${reason}`, {
        tradeId: id,
        symbol: existing.symbol,
        metadata: {
          direction: existing.direction,
          lotSize: existing.lotSize,
          entryPrice: existing.entryPrice,
          closePrice,
          pnl,
          pnlPercent,
          reason,
          strategy: existing.strategy,
        },
      })

      return NextResponse.json({ success: true, data: updated })
    }

    // Handle partial updates (SL, TP, trailing, currentPrice)
    const updateData: Record<string, unknown> = {}
    if (body.sl !== undefined) updateData.sl = body.sl
    if (body.tp !== undefined) updateData.tp = body.tp
    if (body.trailingStop !== undefined) updateData.trailingStop = body.trailingStop
    if (body.trailingDist !== undefined) updateData.trailingDist = body.trailingDist
    if (body.currentPrice !== undefined) {
      updateData.currentPrice = body.currentPrice
      // Recalculate PnL
      let pnl = 0
      if (existing.direction === "BUY") {
        pnl = (body.currentPrice - existing.entryPrice) * existing.lotSize * 100000
      } else {
        pnl = (existing.entryPrice - body.currentPrice) * existing.lotSize * 100000
      }
      pnl -= existing.commission
      updateData.pnl = pnl
      updateData.pnlPercent = existing.margin > 0 ? (pnl / existing.margin) * 100 : 0
    }
    if (body.strategy !== undefined) updateData.strategy = body.strategy
    if (body.timeframe !== undefined) updateData.timeframe = body.timeframe
    if (body.marketCond !== undefined) updateData.marketCond = body.marketCond

    const updated = await db.trade.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    logger.error("TRADE_EXECUTION", "Error updating trade", {
      tradeId: (await params).id,
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to update trade" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.trade.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Trade not found" },
        { status: 404 }
      )
    }

    await db.trade.delete({ where: { id } })

    logger.info("TRADE_EXECUTION", `Trade deleted: ${existing.symbol} ${existing.direction} ${existing.lotSize} lot`, {
      tradeId: id,
      symbol: existing.symbol,
    })

    return NextResponse.json({ success: true, message: "Trade deleted" })
  } catch (error) {
    logger.error("TRADE_EXECUTION", "Error deleting trade", {
      tradeId: (await params).id,
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to delete trade" },
      { status: 500 }
    )
  }
}
