import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger, { getLogAnalytics } from "@/lib/trading-logger"

/** Deep Audit Fix #4: Cache log stats for 10 seconds to reduce DB load */
let cachedStats: Awaited<ReturnType<typeof getLogStats>> | null = null
let statsCacheTime = 0
const STATS_CACHE_MS = 10_000

/** Deep Audit Fix #4: Cache log analytics for 30 seconds */
let cachedAnalytics: Awaited<ReturnType<typeof getLogAnalytics>> | null = null
let analyticsCacheTime = 0
const ANALYTICS_CACHE_MS = 30_000

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limitRaw = parseInt(searchParams.get("limit") ?? "50", 10)
    const limit = Math.max(1, Math.min(isNaN(limitRaw) ? 50 : limitRaw, 200))
    const level = searchParams.get("level")
    const category = searchParams.get("category")
    const symbol = searchParams.get("symbol")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const includeAnalytics = searchParams.get("analytics") === "true"

    const where: Record<string, unknown> = {}
    if (level) where.level = level
    if (category) where.category = category
    if (symbol) where.symbol = symbol

    if (startDate || endDate) {
      where.createdAt = {} as Record<string, Date>
      if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate)
      if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate)
    }

    const logs = await db.tradingLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    })

    // Use cached stats
    const now = Date.now()
    if (!cachedStats || now - statsCacheTime > STATS_CACHE_MS) {
      cachedStats = await getLogStats()
      statsCacheTime = now
    }

    let analytics = null
    if (includeAnalytics) {
      if (!cachedAnalytics || now - analyticsCacheTime > ANALYTICS_CACHE_MS) {
        cachedAnalytics = await getLogAnalytics()
        analyticsCacheTime = now
      }
      analytics = cachedAnalytics
    }

    return NextResponse.json({ success: true, data: { logs, stats: cachedStats, analytics } })
  } catch (error) {
    logger.error("SYSTEM", "Error fetching logs", {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to fetch logs" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { level, message, source, details, category, symbol, tradeId, metadata } = body

    if (!message) {
      return NextResponse.json(
        { success: false, error: "Missing required field: message" },
        { status: 400 }
      )
    }

    // Invalidate cache on new log
    cachedStats = null
    cachedAnalytics = null

    const validLevels = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL", "FATAL"]
    const logLevel = validLevels.includes(level) ? level : "INFO"

    const validCategories = [
      "MT5_CONNECTION", "TRADE_EXECUTION", "RISK_MANAGEMENT",
      "MONEY_MANAGEMENT", "DATA_FEED", "AI_ENGINE", "SYSTEM", "NOTIFICATION", "API_RATE_LIMIT",
    ]
    const logCategory = validCategories.includes(category) ? category : "SYSTEM"

    const log = await db.tradingLog.create({
      data: {
        level: logLevel,
        category: logCategory,
        message,
        source: source ?? null,
        details: details ?? null,
        tradeId: tradeId ?? null,
        symbol: symbol ?? null,
        metadata: metadata ? JSON.stringify(metadata) : "{}",
      },
    })

    return NextResponse.json({ success: true, data: log }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to create log" },
      { status: 500 }
    )
  }
}

async function getLogStats() {
  const total = await db.tradingLog.count()
  const lastHour = new Date(Date.now() - 60 * 60 * 1000)

  const byLevel = await db.tradingLog.groupBy({ by: ["level"], _count: true })
  const byCategory = await db.tradingLog.groupBy({ by: ["category"], _count: true })
  const recentErrors = await db.tradingLog.count({
    where: { level: { in: ["ERROR", "CRITICAL", "FATAL"] }, createdAt: { gte: lastHour } },
  })
  const recentTotal = await db.tradingLog.count({ where: { createdAt: { gte: lastHour } } })

  return {
    total,
    lastHourTotal: recentTotal,
    lastHourErrors: recentErrors,
    byLevel: byLevel.map((g) => ({ level: g.level, count: g._count })),
    byCategory: byCategory.map((g) => ({ category: g.category, count: g._count })),
  }
}
