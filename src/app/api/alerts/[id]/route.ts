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

    const VALID_CONDITIONS = ['ABOVE', 'BELOW', 'CROSS_UP', 'CROSS_DOWN']

    const updateData: Record<string, unknown> = {}

    // Validate and update condition
    if (body.condition !== undefined) {
      const normalized = String(body.condition).toUpperCase()
      if (!VALID_CONDITIONS.includes(normalized)) {
        return NextResponse.json(
          { success: false, error: `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}` },
          { status: 400 },
        )
      }
      updateData.condition = normalized
    }

    // Validate and update price
    if (body.price !== undefined) {
      const parsedPrice = typeof body.price === 'number' ? body.price : parseFloat(String(body.price))
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        return NextResponse.json(
          { success: false, error: 'price must be a finite positive number' },
          { status: 400 },
        )
      }
      updateData.price = parsedPrice
    }

    // Validate and update message
    if (body.message !== undefined) {
      updateData.message = String(body.message).slice(0, 200)
    }

    // Toggle active status
    if (body.active !== undefined) {
      updateData.active = Boolean(body.active)
    }

    // Acknowledge / mark as triggered
    if (body.acknowledged === true || body.triggered === true) {
      updateData.triggered = true
      updateData.triggeredAt = new Date()
    }

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

    try {
      await db.priceAlert.delete({ where: { id } })
      return NextResponse.json({ success: true, message: 'Alert deleted' })
    } catch (error: unknown) {
      const prismaError = error as { code?: string }
      if (prismaError.code === 'P2025') {
        return NextResponse.json({ success: false, error: 'Alert not found' }, { status: 404 })
      }
      throw error
    }
  } catch (error) {
    console.error('Error deleting alert:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete alert' },
      { status: 500 },
    )
  }
}
