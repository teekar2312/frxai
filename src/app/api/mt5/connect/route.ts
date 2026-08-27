import { NextRequest, NextResponse } from "next/server"
import mt5Connection from "@/lib/mt5-connection"
import logger from "@/lib/trading-logger"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { login, password, server, action } = body

    if (action === "disconnect") {
      await mt5Connection.disconnect()
      return NextResponse.json({ success: true, data: { status: "DISCONNECTED" } })
    }

    if (!login || !password) {
      return NextResponse.json(
        { success: false, error: "login and password are required" },
        { status: 400 }
      )
    }

    const result = await mt5Connection.connect(
      Number(login),
      String(password),
      server || "FINEX-Server"
    )

    if (result.success) {
      return NextResponse.json({
        success: true,
        data: {
          status: mt5Connection.getStatus(),
          metrics: mt5Connection.getMetrics(),
        },
      })
    }

    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.critical("MT5_CONNECTION", `Connection request failed: ${msg}`)
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    )
  }
}
