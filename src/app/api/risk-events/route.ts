import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") ?? "20")
    const severity = searchParams.get("severity")
    const resolved = searchParams.get("resolved")

    const where: Record<string, unknown> = {}
    if (severity) where.severity = severity
    if (resolved !== null && resolved !== undefined) {
      where.resolved = resolved === "true"
    }

    const events = await db.riskEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    })

    // Stats
    const total = await db.riskEvent.count()
    const unresolved = await db.riskEvent.count({ where: { resolved: false } })
    const critical = await db.riskEvent.count({ where: { severity: "CRITICAL" } })
    const today = new Date().toISOString().split("T")[0]
    const todayEvents = await db.riskEvent.count({
      where: { createdAt: { gte: new Date(today) } },
    })

    return NextResponse.json({
      success: true,
      data: {
        events,
        stats: { total, unresolved, critical, today: todayEvents },
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to fetch risk events" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, resolved } = body

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 }
      )
    }

    const updated = await db.riskEvent.update({
      where: { id },
      data: { resolved: resolved ?? true, resolvedAt: resolved ? new Date() : null },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to update risk event" },
      { status: 500 }
    )
  }
}
