import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get("range") ?? "1M"

    // Calculate date cutoff properly in WIB timezone (Asia/Jakarta, UTC+7)
    const now = new Date()
    const wibFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' })
    const nowWibStr = wibFormatter.format(now) // 'YYYY-MM-DD' in WIB

    // Parse the WIB date as a local moment with +07:00 offset
    const nowWib = new Date(nowWibStr + 'T00:00:00+07:00')
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
    const cutoffDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(cutoff)

    const records = await db.dailyPerformance.findMany({
      where: {
        date: { gte: cutoffDateStr },
      },
      orderBy: { date: "asc" },
    })

    const data = records.map((r) => ({
      date: r.date,
      balance: r.endBalance,
      equity: r.startBalance + r.totalPnl,
    }))

    return NextResponse.json({ success: true, data })
  } catch (error) {
    logger.error('API', 'Error fetching equity curve', { details: String(error) })
    return NextResponse.json(
      { success: false, error: "Failed to fetch equity curve" },
      { status: 500 }
    )
  }
}
