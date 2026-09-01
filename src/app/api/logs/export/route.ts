import { NextRequest, NextResponse } from "next/server"
import { exportLogs } from "@/lib/trading-logger"
import type { LogLevel, LogCategory } from "@/lib/trading-logger"

const VALID_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL", "FATAL"]
const VALID_CATEGORIES: LogCategory[] = [
  "MT5_CONNECTION",
  "TRADE_EXECUTION",
  "RISK_MANAGEMENT",
  "MONEY_MANAGEMENT",
  "DATA_FEED",
  "AI_ENGINE",
  "SYSTEM",
  "NOTIFICATION",
  "API_RATE_LIMIT",
]

const DEFAULT_LIMIT = 10000
const MAX_LIMIT = 50000

/**
 * GET /api/logs/export?level=ERROR&category=MT5_CONNECTION&startDate=...&endDate=...&format=json|csv&limit=10000
 * Exports trading logs as a downloadable file (JSON or CSV).
 *
 * Security: limit caps at 50000, default startDate to 7 days ago to prevent OOM.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const level = searchParams.get("level")
    const category = searchParams.get("category")
    let startDateStr = searchParams.get("startDate")
    const endDateStr = searchParams.get("endDate")
    const format = searchParams.get("format") ?? "json"
    const limitParam = parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10)

    // Validate limit
    if (isNaN(limitParam) || limitParam < 1) {
      return NextResponse.json(
        { success: false, error: "limit must be a positive integer" },
        { status: 400 },
      )
    }
    if (limitParam > MAX_LIMIT) {
      return NextResponse.json(
        { success: false, error: `limit cannot exceed ${MAX_LIMIT}. Use a smaller range or add startDate filter.` },
        { status: 400 },
      )
    }

    if (format !== "json" && format !== "csv") {
      return NextResponse.json(
        { success: false, error: "format must be 'json' or 'csv'" },
        { status: 400 },
      )
    }

    // Default startDate to 7 days ago (WIB) if not provided
    if (!startDateStr) {
      const wibNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
      const sevenDaysAgo = new Date(wibNow)
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      sevenDaysAgo.setHours(0, 0, 0, 0)
      startDateStr = sevenDaysAgo.toISOString()
    }

    const params: {
      level?: LogLevel
      category?: LogCategory
      startDate?: Date
      endDate?: Date
      format: "json" | "csv"
      limit: number
    } = { format: format as "json" | "csv", limit: limitParam }

    if (level && VALID_LEVELS.includes(level as LogLevel)) {
      params.level = level as LogLevel
    }
    if (category && VALID_CATEGORIES.includes(category as LogCategory)) {
      params.category = category as LogCategory
    }
    if (startDateStr) {
      const d = new Date(startDateStr)
      if (!isNaN(d.getTime())) params.startDate = d
    }
    if (endDateStr) {
      const d = new Date(endDateStr)
      if (!isNaN(d.getTime())) params.endDate = d
    }

    const content = await exportLogs(params)

    const contentType = format === "csv" ? "text/csv" : "application/json"
    const ext = format === "csv" ? "csv" : "json"
    const filename = `finex-logs-export-${new Date().toISOString().slice(0, 10)}.${ext}`

    return new NextResponse(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Log export failed" },
      { status: 500 },
    )
  }
}
