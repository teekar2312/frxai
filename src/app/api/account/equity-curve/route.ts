import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get("range") ?? "1M"

    // Calculate date cutoff in UTC+7 (WIB)
    const now = new Date()
    // WIB is UTC+7, so UTC equivalent is 7 hours behind
    const wibOffsetMs = 7 * 60 * 60 * 1000
    const nowWib = new Date(now.getTime() + wibOffsetMs)

    const cutoff = new Date(nowWib)
    switch (range) {
      case "1D":
        cutoff.setDate(cutoff.getDate() - 1)
        break
      case "1W":
        cutoff.setDate(cutoff.getDate() - 7)
        break
      case "1M":
        cutoff.setMonth(cutoff.getMonth() - 1)
        break
      case "3M":
        cutoff.setMonth(cutoff.getMonth() - 3)
        break
      default:
        cutoff.setMonth(cutoff.getMonth() - 1)
    }

    // Convert back to UTC for DB comparison (date field is YYYY-MM-DD string)
    const cutoffDateStr = cutoff.toISOString().split("T")[0]

    const records = await db.dailyPerformance.findMany({
      where: {
        date: { gte: cutoffDateStr },
      },
      orderBy: { date: "asc" },
    })

    const data = records.map((r) => ({
      date: r.date,
      balance: r.startBalance,
      equity: r.startBalance + r.totalPnl,
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("Error fetching equity curve:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch equity curve" },
      { status: 500 }
    )
  }
}
