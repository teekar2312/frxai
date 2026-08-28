import { NextResponse } from "next/server"

interface TradingSession {
  name: string
  city: string
  timezone: string
  openHour: number
  closeHour: number
  isActive: boolean
  opensIn?: number
  closesIn?: number
}

function getSessionStatus(openHour: number, closeHour: number, nowUtcHour: number): {
  isActive: boolean
  opensIn?: number
  closesIn?: number
} {
  // Handle sessions that cross midnight (e.g., Sydney 21:00-06:00 UTC)
  if (openHour > closeHour) {
    const isActive = nowUtcHour >= openHour || nowUtcHour < closeHour
    let closesIn: number | undefined
    let opensIn: number | undefined
    if (isActive) {
      closesIn = nowUtcHour >= openHour
        ? (24 - nowUtcHour + closeHour)
        : closeHour - nowUtcHour
    } else {
      opensIn = openHour - nowUtcHour
    }
    return { isActive, closesIn, opensIn }
  }

  const isActive = nowUtcHour >= openHour && nowUtcHour < closeHour
  const closesIn = isActive ? closeHour - nowUtcHour : openHour - nowUtcHour
  const opensIn = isActive ? undefined : closesIn
  return { isActive, closesIn, opensIn }
}

export async function GET() {
  try {
    const now = new Date()
    const utcHour = now.getUTCHours()
    const utcMinutes = now.getUTCMinutes()
    const fractionalHour = utcHour + utcMinutes / 60
    const dayOfWeek = now.getUTCDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    const sessions: TradingSession[] = [
      {
        name: "Sydney",
        city: "Sydney",
        timezone: "AEST (UTC+10)",
        openHour: 21,
        closeHour: 6,
        ...getSessionStatus(21, 6, utcHour),
      },
      {
        name: "Tokyo",
        city: "Tokyo",
        timezone: "JST (UTC+9)",
        openHour: 0,
        closeHour: 9,
        ...getSessionStatus(0, 9, utcHour),
      },
      {
        name: "London",
        city: "London",
        timezone: "GMT (UTC+0)",
        openHour: 7,
        closeHour: 16,
        ...getSessionStatus(7, 16, utcHour),
      },
      {
        name: "New York",
        city: "New York",
        timezone: "EST (UTC-5)",
        openHour: 12,
        closeHour: 21,
        ...getSessionStatus(12, 21, utcHour),
      },
    ]

    // Determine overlaps
    const sydneyActive = sessions[0].isActive
    const tokyoActive = sessions[1].isActive
    const londonActive = sessions[2].isActive
    const nyActive = sessions[3].isActive

    const overlaps = [
      {
        name: "Sydney-Tokyo",
        sessions: ["Sydney", "Tokyo"],
        isActive: sydneyActive && tokyoActive,
        description: "Asian session overlap",
      },
      {
        name: "Tokyo-London",
        sessions: ["Tokyo", "London"],
        isActive: tokyoActive && londonActive,
        description: "Asian-European transition",
      },
      {
        name: "London-New York",
        sessions: ["London", "New York"],
        isActive: londonActive && nyActive,
        description: "Highest liquidity overlap",
      },
    ]

    const activeSessions = sessions.filter((s) => s.isActive).map((s) => s.name)
    const activeOverlaps = overlaps.filter((o) => o.isActive).map((o) => o.name)

    return NextResponse.json({
      success: true,
      data: {
        currentTime: now.toISOString(),
        utcHour,
        isWeekend,
        sessions,
        overlaps,
        activeSessions,
        activeOverlaps,
        recommendation: isWeekend
          ? "Market is closed for the weekend"
          : activeSessions.length === 0
            ? "No active sessions - low liquidity period"
            : `Active: ${activeSessions.join(", ")}${activeOverlaps.length > 0 ? ` (Overlaps: ${activeOverlaps.join(", ")})` : ""}`,
      },
    })
  } catch (error) {
    console.error("Error fetching sessions:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch sessions" },
      { status: 500 }
    )
  }
}
