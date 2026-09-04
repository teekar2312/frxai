import { NextResponse } from "next/server"
import { autoResolveStaleRiskEvents } from "@/lib/risk-engine"

/**
 * POST /api/risk/auto-resolve
 * Triggers auto-resolution of stale (unresolved) risk events.
 * Optional body: { "maxAgeMinutes": 60 }
 */
export async function POST(request: Request) {
  try {
    let maxAgeMinutes = 60
    try {
      const body = await request.json()
      if (body.maxAgeMinutes && typeof body.maxAgeMinutes === "number") {
        maxAgeMinutes = body.maxAgeMinutes
      }
    } catch {
      // No body or invalid JSON — use default
    }

    const resolvedCount = await autoResolveStaleRiskEvents(maxAgeMinutes)

    return NextResponse.json({
      success: true,
      data: { resolvedCount },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: "Auto-resolve failed" },
      { status: 500 },
    )
  }
}
