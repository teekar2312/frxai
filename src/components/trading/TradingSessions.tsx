'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Globe, Clock, Activity, TrendingUp, TrendingDown, AlertTriangle, Timer } from 'lucide-react'

// Import shared session config from the session manager (via API response)
interface SessionData {
  name: string
  openHour: number
  closeHour: number
  color: string
  colorLight: string
  isActive: boolean
  opensIn?: number
  closesIn?: number
  city: string
  timezone: string
  crossesMidnight: boolean
}

const OVERLAPS = [
  { name: 'Tokyo-London', startHour: 7, endHour: 9, color: '#f97316' },
  { name: 'London-New York', startHour: 12, endHour: 16, color: '#ec4899' },
]

interface SessionsApiResponse {
  success: boolean
  data: {
    idx: {
      phase: string
      subSession: string
      isOpen: boolean
      sessionName: string
      timeToNextPhase: number
      nextPhase: string
    }
    currentTime: string
    utcHour: number
    isWeekend: boolean
    sessions: SessionData[]
    overlaps: Array<{ name: string; sessions: string[]; startHourUtc: number; endHourUtc: number; color: string; isActive: boolean; description: string }>
    activeSessions: string[]
    activeOverlaps: string[]
    recommendation: string
    sessionPerformance?: {
      morning: { date: string; sessionType: string; tradesOpened: number; tradesClosed: number; winTrades: number; lossTrades: number; pnl: number; winRate: number } | null
      afternoon: { date: string; sessionType: string; tradesOpened: number; tradesClosed: number; winTrades: number; lossTrades: number; pnl: number; winRate: number } | null
      fullDay: { date: string; sessionType: string; tradesOpened: number; tradesClosed: number; winTrades: number; lossTrades: number; pnl: number; winRate: number } | null
    }
    riskBudget?: {
      sessionType: string
      totalBudget: number
      usedBudget: number
      remainingBudget: number
      usedPct: number
      isLimitReached: boolean
      tradesThisSession: number
    }
  }
}

function getBarStyles(session: SessionData): React.CSSProperties {
  const totalHours = session.crossesMidnight
    ? (24 - session.openHour) + session.closeHour
    : session.closeHour - session.openHour

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

function formatCountdown(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default function TradingSessions() {
  const [data, setData] = useState<SessionsApiResponse | null>(null)
  const [currentHour, setCurrentHour] = useState<number>(new Date().getUTCHours())
  const [currentMinute, setCurrentMinute] = useState<number>(new Date().getUTCMinutes())
  const [loading, setLoading] = useState(true)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions?include=performance')
      if (res.ok) {
        const json: SessionsApiResponse = await res.json()
        setData(json)
      }
    } catch {
      // use local time
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchSessions])

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date()
      setCurrentHour(now.getUTCHours())
      setCurrentMinute(now.getUTCMinutes())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const sessions = data?.data.sessions ?? []
  const overlaps = data?.data.overlaps ?? []
  const idx = data?.data.idx
  const activeSessions = data?.data.activeSessions ?? []
  const activeOverlaps = data?.data.activeOverlaps ?? []
  const performance = data?.data.sessionPerformance
  const riskBudget = data?.data.riskBudget
  const recommendation = data?.data.recommendation ?? ''
  const isWeekend = data?.data.isWeekend ?? false

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

      {/* IDX Session Status Card */}
      <Card className="border-l-4 border-l-emerald-500">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold">IDX Market — {idx?.sessionName ?? 'Loading...'}</p>
                <p className="text-xs text-muted-foreground">
                  Phase: {idx?.phase ?? '-'} | Sub-session: {idx?.subSession ?? '-'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={idx?.isOpen ? 'default' : 'outline'} className={idx?.isOpen ? 'bg-emerald-600' : ''}>
                {idx?.isOpen ? 'OPEN' : 'CLOSED'}
              </Badge>
              {idx && idx.timeToNextPhase < 600 && (
                <div className="flex items-center gap-1 text-xs text-amber-500">
                  <Timer className="h-3.5 w-3.5" />
                  {formatCountdown(idx.timeToNextPhase)}
                </div>
              )}
            </div>
          </div>
          {/* Session Risk Budget */}
          {riskBudget && (
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs border-t pt-3">
              <div>
                <span className="text-muted-foreground">Budget Used</span>
                <p className="font-medium text-foreground">${riskBudget.usedBudget.toFixed(2)} / ${riskBudget.totalBudget.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Remaining</span>
                <p className={`font-medium ${riskBudget.isLimitReached ? 'text-red-500' : 'text-emerald-500'}`}>
                  ${riskBudget.remainingBudget.toFixed(2)} ({100 - riskBudget.usedPct}%)
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Session Trades</span>
                <p className="font-medium text-foreground">{riskBudget.tradesThisSession}</p>
              </div>
            </div>
          )}
          {/* Session Performance Mini */}
          {performance && (performance.morning || performance.afternoon) && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs border-t pt-3">
              {performance.morning && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Morning</span>
                  <span className={`font-medium ${performance.morning.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {performance.morning.pnl >= 0 ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
                    {' '}${performance.morning.pnl.toFixed(2)} ({performance.morning.winRate.toFixed(0)}% WR)
                  </span>
                </div>
              )}
              {performance.afternoon && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Afternoon</span>
                  <span className={`font-medium ${performance.afternoon.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {performance.afternoon.pnl >= 0 ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
                    {' '}${performance.afternoon.pnl.toFixed(2)} ({performance.afternoon.winRate.toFixed(0)}% WR)
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forex Session Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {sessions.map((session) => {
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
                  variant={session.isActive ? 'default' : 'outline'}
                  className={session.isActive ? '' : 'text-muted-foreground'}
                  style={session.isActive ? { backgroundColor: session.color } : {}}
                >
                  {session.isActive ? 'Active' : 'Closed'}
                </Badge>
                {session.isActive && session.closesIn && (
                  <p className="text-[10px] text-muted-foreground">Closes in {session.closesIn}h</p>
                )}
                {!session.isActive && session.opensIn && (
                  <p className="text-[10px] text-muted-foreground">Opens in {session.opensIn}h</p>
                )}
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
          <div className="relative">
            <div className="flex justify-between mb-1">
              {hours.filter((h) => h % 3 === 0).map((h) => (
                <span key={h} className="text-[10px] text-muted-foreground font-mono w-0">
                  {String(h).padStart(2, '0')}
                </span>
              ))}
            </div>

            <div className="relative h-10 rounded-md bg-muted/50 overflow-hidden">
              {sessions.map((session) => (
                <div key={session.name} style={getBarStyles(session)} />
              ))}

              {OVERLAPS.map((overlap) => {
                const leftPct = (overlap.startHour / 24) * 100
                const widthPct = ((overlap.endHour - overlap.startHour) / 24) * 100
                const isActive = currentHour >= overlap.startHour && currentHour < overlap.endHour
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

              {sessions.map((session) => {
                const totalHours = session.crossesMidnight
                  ? (24 - session.openHour) + session.closeHour
                  : session.closeHour - session.openHour
                const midPct = session.crossesMidnight
                  ? (((session.openHour + totalHours / 2) % 24) / 24) * 100
                  : (((session.openHour + totalHours / 2)) / 24) * 100
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

              <div
                className="absolute top-0 h-full w-0.5 bg-white z-10"
                style={{ left: `${currentPosPct}%` }}
              >
                <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-white border-2 border-foreground" />
              </div>
            </div>

            <div className="flex justify-between mt-1">
              {hours.filter((h) => h % 3 === 0).map((h) => (
                <span key={h} className="text-[10px] text-muted-foreground font-mono w-0">
                  {String(h).padStart(2, '0')}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            {overlaps.map((overlap) => {
              const isActive = currentHour >= overlap.startHourUtc && currentHour < overlap.endHourUtc
              return (
                <div key={overlap.name} className="flex items-center gap-2 text-xs">
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: overlap.color, opacity: isActive ? 1 : 0.4 }}
                  />
                  <span className={isActive ? 'font-medium' : 'text-muted-foreground'}>
                    {overlap.name} ({String(overlap.startHourUtc).padStart(2, '0')}:00-{String(overlap.endHourUtc).padStart(2, '0')}:00 UTC)
                  </span>
                  {isActive && (
                    <Badge variant="outline" className="h-4 text-[10px] px-1" style={{ color: overlap.color, borderColor: overlap.color }}>
                      LIVE
                    </Badge>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-3 border-t pt-3">
            {sessions.map((session) => (
              <div key={`legend-${session.name}`} className="flex items-center gap-1.5 text-xs">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: session.color, opacity: session.isActive ? 1 : 0.4 }}
                />
                <span className={session.isActive ? 'font-medium' : 'text-muted-foreground'}>{session.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recommendation */}
      {recommendation && (
        <div className={`flex items-center gap-2 rounded-md p-3 text-sm ${isWeekend ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-muted'}`}>
          {isWeekend ? <AlertTriangle className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
          <span>{recommendation}</span>
        </div>
      )}
    </div>
  )
}