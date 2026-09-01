import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10)
    const limit = (Number.isFinite(rawLimit) && rawLimit >= 1) ? Math.min(rawLimit, 100) : 20
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

    // Stats (respect applied filters — reuse same where clause)
    const total = await db.riskEvent.count({ where })
    const unresolved = await db.riskEvent.count({ where: { ...where, resolved: false } })
    const critical = await db.riskEvent.count({ where: { ...where, severity: "CRITICAL" } })
    const today = new Date().toISOString().split("T")[0]
    const todayEvents = await db.riskEvent.count({
      where: { ...where, createdAt: { gte: new Date(today) } },
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

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Valid id is required' },
        { status: 400 }
      )
    }

    const resolvedValue = typeof resolved === 'boolean' ? resolved : true

    const existing = await db.riskEvent.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Risk event not found' },
        { status: 404 }
      )
    }

    const updated = await db.riskEvent.update({
      where: { id },
      data: {
        resolved: resolvedValue,
        resolvedAt: resolvedValue ? new Date() : null,
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to update risk event" },
      { status: 500 }
    )
  }
}
