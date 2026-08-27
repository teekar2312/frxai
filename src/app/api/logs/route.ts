import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") ?? "50")
    const level = searchParams.get("level")
    const source = searchParams.get("source")

    const where: Record<string, unknown> = {}
    if (level) where.level = level
    if (source) where.source = source

    const logs = await db.tradingLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    })

    return NextResponse.json({ success: true, data: logs })
  } catch (error) {
    console.error("Error fetching logs:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch logs" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { level, message, source, details } = body

    if (!message) {
      return NextResponse.json(
        { success: false, error: "Missing required field: message" },
        { status: 400 }
      )
    }

    const validLevels = ["INFO", "WARN", "ERROR", "DEBUG"]
    const logLevel = validLevels.includes(level) ? level : "INFO"

    const log = await db.tradingLog.create({
      data: {
        level: logLevel,
        message,
        source: source ?? null,
        details: details ?? null,
      },
    })

    return NextResponse.json({ success: true, data: log }, { status: 201 })
  } catch (error) {
    console.error("Error creating log:", error)
    return NextResponse.json(
      { success: false, error: "Failed to create log" },
      { status: 500 }
    )
  }
}
