import { NextResponse } from "next/server"
import { getPreTradeHaltStatus } from "@/lib/money-management"

/**
 * GET /api/money-management/halt-status
 * Returns the pre-trade halt status combining consecutive loss,
 * equity curve, session risk, and market hours checks.
 */
export async function GET() {
  try {
    const haltStatus = await getPreTradeHaltStatus()
    return NextResponse.json({ success: true, data: haltStatus })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to fetch halt status" },
      { status: 500 },
    )
  }
}
