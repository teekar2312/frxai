import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET() {
  try {
    const state = await db.mt5ConnectionState.findFirst()

    // Recent connection logs
    const recentLogs = await db.mt5ConnectionLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    })

    // Connection stats
    const totalEvents = await db.mt5ConnectionLog.count()
    const errorCount = await db.mt5ConnectionLog.count({ where: { event: "ERROR" } })
    const reconnectCount = await db.mt5ConnectionLog.count({ where: { event: "RECONNECTING" } })

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
        recentLogs,
        stats: {
          totalEvents,
          errorCount,
          reconnectCount,
        },
      },
    })
  } catch (error) {
    console.error("MT5 status error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch MT5 status" },
      { status: 500 }
    )
  }
}
