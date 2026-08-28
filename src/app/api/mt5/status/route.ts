import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"

export async function GET() {
  try {
    const state = await db.mt5ConnectionState.findFirst()

    const recentLogs = await db.mt5ConnectionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    })

    const totalEvents = await db.mt5ConnectionLog.count()
    const errorCount = await db.mt5ConnectionLog.count({ where: { event: "ERROR" } })
    const reconnectCount = await db.mt5ConnectionLog.count({ where: { event: "RECONNECTING" } })

    // Market hours info
    const { getTradingPhase, isMarketOpen } = await import("@/lib/mt5-connection")
    const tradingPhase = getTradingPhase()
    const marketIsOpen = isMarketOpen()

    return NextResponse.json({
      success: true,
      data: {
        status: state?.status || "DISCONNECTED",
        broker: state?.broker || "FINEX Indonesia",
        server: state?.server,
        accountNumber: state?.accountNumber,
        accountType: state?.accountType || "Real",
        latencyMs: state?.latencyMs || 0,
        uptimeSeconds: state?.uptimeSeconds || 0,
        reconnectCount: state?.reconnectCount || 0,
        lastHeartbeat: state?.lastHeartbeat?.toISOString() || null,
        lastError: state?.lastError || null,
        lastConnectedAt: state?.lastConnectedAt?.toISOString() || null,
        lastDisconnectedAt: state?.lastDisconnectedAt?.toISOString() || null,
        connectedAt: state?.connectedAt?.toISOString() || null,
        isMarketOpen: state?.isMarketOpen ?? marketIsOpen,
        tradingPhase: state?.tradingPhase || tradingPhase,
        consecutiveHeartbeatFailures: state?.consecutiveHeartbeatFailures || 0,
        recentLogs,
        stats: { totalEvents, errorCount, reconnectCount },
      },
    })
  } catch (error) {
    logger.error("MT5_CONNECTION", "Error fetching MT5 status", {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to fetch MT5 status" },
      { status: 500 }
    )
  }
}
