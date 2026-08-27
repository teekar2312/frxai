import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.priceAlert.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Alert not found" },
        { status: 404 }
      )
    }

    const updateData: Record<string, unknown> = {}

    // Toggle active status
    if (body.active !== undefined) {
      updateData.active = body.active
    }

    // Acknowledge / mark as triggered
    if (body.acknowledged === true || body.triggered === true) {
      updateData.triggered = true
      updateData.triggeredAt = new Date()
    }

    // Allow updating price and message
    if (body.price !== undefined) updateData.price = body.price
    if (body.message !== undefined) updateData.message = body.message
    if (body.condition !== undefined) updateData.condition = body.condition

    const updated = await db.priceAlert.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error("Error updating alert:", error)
    return NextResponse.json(
      { success: false, error: "Failed to update alert" },
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

    const existing = await db.priceAlert.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Alert not found" },
        { status: 404 }
      )
    }

    await db.priceAlert.delete({ where: { id } })

    return NextResponse.json({ success: true, message: "Alert deleted" })
  } catch (error) {
    console.error("Error deleting alert:", error)
    return NextResponse.json(
      { success: false, error: "Failed to delete alert" },
      { status: 500 }
    )
  }
}
