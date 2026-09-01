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

    // Get actual balance from DailyPerformance
    const lastPerf = await db.dailyPerformance.findFirst({ orderBy: { date: 'desc' } })
    const baseBalance = lastPerf ? lastPerf.endBalance : 10000

    // Calculate equity for risk budget (90-day window for closed trades)
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const allClosed = await db.trade.findMany({ where: { status: 'CLOSED', closeTime: { gte: ninetyDaysAgo } } })
    const totalClosedPnl = allClosed.reduce((s, t) => s + t.pnl, 0)
    const openTrades = await db.trade.findMany({ where: { status: 'OPEN' } })
    const totalOpenPnl = openTrades.reduce((s, t) => s + t.pnl, 0)
    const equity = baseBalance + totalClosedPnl + totalOpenPnl

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
