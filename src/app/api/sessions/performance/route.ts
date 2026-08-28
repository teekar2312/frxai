import { NextResponse } from "next/server"
import { getTodaySessionPerformance, getSessionRiskBudget } from "@/lib/session-manager"
import { db } from "@/lib/db"

/**
 * GET /api/sessions/performance
 * Returns session performance and risk budget for today.
 */
export async function GET() {
  try {
    const performance = await getTodaySessionPerformance()

    // Calculate equity for risk budget
    const BASE_BALANCE = 10000
    const allClosed = await db.trade.findMany({ where: { status: 'CLOSED' } })
    const totalClosedPnl = allClosed.reduce((s, t) => s + t.pnl, 0)
    const openTrades = await db.trade.findMany({ where: { status: 'OPEN' } })
    const totalOpenPnl = openTrades.reduce((s, t) => s + t.pnl, 0)
    const equity = BASE_BALANCE + totalClosedPnl + totalOpenPnl

    const riskBudget = await getSessionRiskBudget(equity)

    return NextResponse.json({ success: true, data: { performance, riskBudget, equity } })
  } catch (error) {
    console.error('Error fetching session performance:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch session performance' },
      { status: 500 },
    )
  }
}
