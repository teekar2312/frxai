import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const alerts = await db.priceAlert.findMany({
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ success: true, data: alerts })
  } catch (error) {
    console.error("Error fetching alerts:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch alerts" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { symbol, condition, price, message } = body

    if (!symbol || !condition || price == null) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: symbol, condition, price" },
        { status: 400 }
      )
    }

    const validConditions = ["ABOVE", "BELOW", "CROSS_UP", "CROSS_DOWN"]
    if (!validConditions.includes(condition)) {
      return NextResponse.json(
        { success: false, error: `condition must be one of: ${validConditions.join(", ")}` },
        { status: 400 }
      )
    }

    const alert = await db.priceAlert.create({
      data: {
        symbol,
        condition,
        price,
        message: message ?? null,
      },
    })

    return NextResponse.json({ success: true, data: alert }, { status: 201 })
  } catch (error) {
    console.error("Error creating alert:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create alert" },
      { status: 500 }
    )
  }
}
