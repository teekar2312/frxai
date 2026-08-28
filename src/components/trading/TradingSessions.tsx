'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Globe, Clock } from 'lucide-react'

interface SessionData {
  name: string
  openHour: number
  closeHour: number
  color: string
  colorLight: string
}

const SESSIONS: SessionData[] = [
  { name: 'Sydney', openHour: 21, closeHour: 6, color: '#8b5cf6', colorLight: '#c4b5fd' },
  { name: 'Tokyo', openHour: 0, closeHour: 9, color: '#f59e0b', colorLight: '#fcd34d' },
  { name: 'London', openHour: 7, closeHour: 16, color: '#10b981', colorLight: '#6ee7b7' },
  { name: 'New York', openHour: 12, closeHour: 21, color: '#ef4444', colorLight: '#fca5a5' },
]

const OVERLAPS = [
  { name: 'Tokyo-London', startHour: 7, endHour: 9, color: '#f97316' },
  { name: 'London-New York', startHour: 12, endHour: 16, color: '#ec4899' },
]

interface SessionsResponse {
  currentUtcHour: number
  currentUtcMinute: number
}

function isSessionActive(session: SessionData, currentHour: number): boolean {
  if (session.openHour < session.closeHour) {
    return currentHour >= session.openHour && currentHour < session.closeHour
  }
  // Wraps midnight (e.g. Sydney 21-6)
  return currentHour >= session.openHour || currentHour < session.closeHour
}

function getSessionHourPosition(session: SessionData, hour: number): number | null {
  if (session.openHour < session.closeHour) {
    if (hour >= session.openHour && hour < session.closeHour) {
      return ((hour - session.openHour) / (session.closeHour - session.openHour)) * 100
    }
    return null
  }
  // Wraps midnight
  const totalHours = (24 - session.openHour) + session.closeHour
  let offset: number
  if (hour >= session.openHour) {
    offset = hour - session.openHour
  } else if (hour < session.closeHour) {
    offset = (24 - session.openHour) + hour
  } else {
    return null
  }
  return (offset / totalHours) * 100
}

function getBarStyles(session: SessionData): React.CSSProperties {
  const totalHours = session.openHour < session.closeHour
    ? session.closeHour - session.openHour
    : (24 - session.openHour) + session.closeHour

  const startPct = (session.openHour / 24) * 100
  const widthPct = (totalHours / 24) * 100

  return {
    position: 'absolute' as const,
    left: `${startPct}%`,
    width: `${widthPct}%`,
    backgroundColor: session.color,
    opacity: 0.25,
    borderRadius: '4px',
    height: '100%',
  }
}

export default function TradingSessions() {
  const [currentHour, setCurrentHour] = useState<number>(new Date().getUTCHours())
  const [currentMinute, setCurrentMinute] = useState<number>(new Date().getUTCMinutes())
  const [loading, setLoading] = useState(true)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (res.ok) {
        const json: SessionsResponse = await res.json()
        setCurrentHour(json.currentUtcHour)
        setCurrentMinute(json.currentUtcMinute)
      }
    } catch {
      // use local time
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(() => {
      const now = new Date()
      setCurrentHour(now.getUTCHours())
      setCurrentMinute(now.getUTCMinutes())
    }, 60000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  // Also update local time every second for the clock
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date()
      setCurrentHour(now.getUTCHours())
      setCurrentMinute(now.getUTCMinutes())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const currentPosPct = ((currentHour + currentMinute / 60) / 24) * 100

  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Globe className="h-5 w-5 text-emerald-500" />
          Trading Sessions
        </h2>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>UTC {String(currentHour).padStart(2, '0')}:{String(currentMinute).padStart(2, '0')}</span>
        </div>
      </div>

      {/* Session Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SESSIONS.map((session) => {
          const active = isSessionActive(session, currentHour)
          const closeStr = String(session.closeHour).padStart(2, '0')
          const openStr = String(session.openHour).padStart(2, '0')
          return (
            <Card key={session.name} className="py-4">
              <CardContent className="flex flex-col items-center gap-2 p-4">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${session.color}20` }}
                >
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: session.color }}
                  />
                </div>
                <p className="text-sm font-semibold">{session.name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {openStr}:00 - {closeStr}:00 UTC
                </p>
                <Badge
                  variant={active ? 'default' : 'outline'}
                  className={active ? '' : 'text-muted-foreground'}
                  style={active ? { backgroundColor: session.color } : {}}
                >
                  {active ? 'Active' : 'Closed'}
                </Badge>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 24h Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">24-Hour Session Timeline (UTC)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Timeline Bar */}
          <div className="relative">
            {/* Hour labels */}
            <div className="flex justify-between mb-1">
              {hours.filter((h) => h % 3 === 0).map((h) => (
                <span key={h} className="text-[10px] text-muted-foreground font-mono w-0">
                  {String(h).padStart(2, '0')}
                </span>
              ))}
            </div>

            {/* Main bar */}
            <div className="relative h-10 rounded-md bg-muted/50 overflow-hidden">
              {/* Session background segments */}
              {SESSIONS.map((session) => (
                <div key={session.name} style={getBarStyles(session)} />
              ))}

              {/* Overlap zones - drawn on top with stronger color */}
              {OVERLAPS.map((overlap) => {
                const leftPct = (overlap.startHour / 24) * 100
                const widthPct = ((overlap.endHour - overlap.startHour) / 24) * 100
                return (
                  <div
                    key={overlap.name}
                    className="absolute top-0 h-full"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: overlap.color,
                      opacity: 0.15,
                      borderLeft: `2px solid ${overlap.color}`,
                      borderRight: `2px solid ${overlap.color}`,
                    }}
                  />
                )
              })}

              {/* Session labels inside bar */}
              {SESSIONS.map((session) => {
                const totalHours = session.openHour < session.closeHour
                  ? session.closeHour - session.openHour
                  : (24 - session.openHour) + session.closeHour
                const midPct = session.openHour < session.closeHour
                  ? ((session.openHour + totalHours / 2) / 24) * 100
                  : (((session.openHour + totalHours / 2) % 24) / 24) * 100
                return (
                  <div
                    key={`label-${session.name}`}
                    className="absolute top-1 text-[9px] font-semibold whitespace-nowrap pointer-events-none"
                    style={{
                      left: `${midPct}%`,
                      transform: 'translateX(-50%)',
                      color: session.color,
                    }}
                  >
                    {session.name}
                  </div>
                )
              })}

              {/* Current time indicator */}
              <div
                className="absolute top-0 h-full w-0.5 bg-white z-10"
                style={{ left: `${currentPosPct}%` }}
              >
                <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-white border-2 border-foreground" />
              </div>
            </div>

            {/* Hour labels bottom */}
            <div className="flex justify-between mt-1">
              {hours.filter((h) => h % 3 === 0).map((h) => (
                <span key={h} className="text-[10px] text-muted-foreground font-mono w-0">
                  {String(h).padStart(2, '0')}
                </span>
              ))}
            </div>
          </div>

          {/* Overlap zones legend */}
          <div className="flex flex-wrap gap-3 pt-2">
            {OVERLAPS.map((overlap) => {
              const isOverlapActive = currentHour >= overlap.startHour && currentHour < overlap.endHour
              return (
                <div key={overlap.name} className="flex items-center gap-2 text-xs">
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: overlap.color, opacity: isOverlapActive ? 1 : 0.4 }}
                  />
                  <span className={isOverlapActive ? 'font-medium' : 'text-muted-foreground'}>
                    {overlap.name} ({String(overlap.startHour).padStart(2, '0')}:00-{String(overlap.endHour).padStart(2, '0')}:00 UTC)
                  </span>
                  {isOverlapActive && (
                    <Badge variant="outline" className="h-4 text-[10px] px-1" style={{ color: overlap.color, borderColor: overlap.color }}>
                      LIVE
                    </Badge>
                  )}
                </div>
              )
            })}
          </div>

          {/* Session color legend */}
          <div className="flex flex-wrap gap-3 border-t pt-3">
            {SESSIONS.map((session) => {
              const active = isSessionActive(session, currentHour)
              return (
                <div key={`legend-${session.name}`} className="flex items-center gap-1.5 text-xs">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: session.color, opacity: active ? 1 : 0.4 }}
                  />
                  <span className={active ? 'font-medium' : 'text-muted-foreground'}>{session.name}</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}