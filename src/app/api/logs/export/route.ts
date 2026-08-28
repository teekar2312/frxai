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

/**
 * GET /api/logs/export?level=ERROR&category=MT5_CONNECTION&startDate=...&endDate=...&format=json|csv
 * Exports trading logs as a downloadable file (JSON or CSV).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const level = searchParams.get("level")
    const category = searchParams.get("category")
    const startDateStr = searchParams.get("startDate")
    const endDateStr = searchParams.get("endDate")
    const format = searchParams.get("format") ?? "json"

    if (format !== "json" && format !== "csv") {
      return NextResponse.json(
        { success: false, error: "format must be 'json' or 'csv'" },
        { status: 400 },
      )
    }

    const params: {
      level?: LogLevel
      category?: LogCategory
      startDate?: Date
      endDate?: Date
      format: "json" | "csv"
    } = { format: format as "json" | "csv" }

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
