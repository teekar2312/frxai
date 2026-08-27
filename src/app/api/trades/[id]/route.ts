import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

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

      const pnlPercent = (pnl / existing.margin) * 100

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
      updateData.pnlPercent = (pnl / existing.margin) * 100
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
    console.error("Error updating trade:", error)
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

    return NextResponse.json({ success: true, message: "Trade deleted" })
  } catch (error) {
    console.error("Error deleting trade:", error)
    return NextResponse.json(
      { success: false, error: "Failed to delete trade" },
      { status: 500 }
    )
  }
}
