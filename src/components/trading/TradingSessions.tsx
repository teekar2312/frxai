'use client'

import { useEffect, useState, useCallback } from 'react'
import { useApiQuery } from '@/hooks/use-api-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Globe, Clock, Activity, TrendingUp, TrendingDown, AlertTriangle, Timer, Settings2, Zap } from 'lucide-react'
import { toast } from 'sonner'

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

const TIMELINE_OVERLAPS = [
  { name: 'Tokyo-London', startHour: 7, endHour: 9, color: '#f97316' },
  { name: 'New York - London', startHour: 12, endHour: 16, color: '#ec4899' },
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

interface SessionToggle {
  key: string
  label: string
  enabled: boolean
  type: 'idx' | 'forex' | 'overlap'
}

interface SessionTradingConfig {
  idxSessions: SessionToggle[]
  forexOverlaps: SessionToggle[]
  updatedAt: string
}

interface SessionConfigApiResponse {
  success: boolean
  data: {
    config: SessionTradingConfig
    activeOverlaps: Array<{ key: string; label: string; name: string }>
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

// Overlap icon colors for visual distinction
const OVERLAY_COLORS: Record<string, string> = {
  'overlap_tokyo_london': '#f97316',
  'overlap_ny_london': '#ec4899',
  'overlap_sydney_tokyo': '#8b5cf6',
}

export default function TradingSessions() {
  const [currentHour, setCurrentHour] = useState<number>(new Date().getUTCHours())
  const [currentMinute, setCurrentMinute] = useState<number>(new Date().getUTCMinutes())

  // Session config state — mirrors the config poll payload so
  // handleToggleSession keeps applying the PUT response directly
  // (server truth wins on every 60s poll).
  const [sessionConfig, setSessionConfig] = useState<SessionTradingConfig | null>(null)
  const [activeOverlapKeys, setActiveOverlapKeys] = useState<Set<string>>(new Set())
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)

  // Sessions poll (30s) — the full envelope is kept as data shape so every
  // render read (data?.data.*) stays byte-identical.
  const { data } = useApiQuery<SessionsApiResponse>({
    url: '/api/sessions?include=performance',
    intervalMs: 30_000,
    transform: (json) => json as SessionsApiResponse,
  })

  // Session-config poll (60s)
  const { data: sessionConfigPayload } = useApiQuery<SessionConfigApiResponse['data']>({
    url: '/api/sessions/config',
    intervalMs: 60_000, // refresh config every 60s
    transform: (json) => {
      const payload = (json as SessionConfigApiResponse | null)?.data
      return payload && Array.isArray(payload.activeOverlaps) ? payload : undefined
    },
  })

  useEffect(() => {
    if (sessionConfigPayload !== null) {
      setSessionConfig(sessionConfigPayload.config)
      setActiveOverlapKeys(new Set(sessionConfigPayload.activeOverlaps.map((o) => o.key)))
    }
  }, [sessionConfigPayload])

  const handleToggleSession = useCallback(async (type: 'idx' | 'overlap', key: string, enabled: boolean) => {
    setUpdatingKey(key)
    try {
      const payload: Record<string, Array<{ key: string; enabled: boolean }>> = {}
      if (type === 'idx') {
        payload.idxSessions = [{ key, enabled }]
      } else {
        payload.forexOverlaps = [{ key, enabled }]
      }

      const res = await fetch('/api/sessions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const json = await res.json()
        setSessionConfig(json.data)
        toast.success(
          enabled ? 'Sesi diaktifkan' : 'Sesi dinonaktifkan',
          { description: type === 'overlap' ? 'Overlap session diperbarui' : 'Sesi IDX diperbarui' }
        )
      } else {
        toast.error('Gagal memperbarui konfigurasi sesi')
      }
    } catch {
      toast.error('Gagal memperbarui konfigurasi sesi')
    } finally {
      setUpdatingKey(null)
    }
  }, [])

  // Update clock every second — not a fetch, stays a plain interval.
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

      {/* ============ SESSION SELECTION PANEL ============ */}
      <Card className="border-l-4 border-l-violet-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-violet-500" />
            Pemilihan Sesi Trading
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* IDX Sessions */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sesi IDX</p>
            <div className="space-y-3">
              {sessionConfig?.idxSessions.map((s) => {
                const isCurrentlyActive =
                  (s.key === 'idx_morning' && idx?.subSession === 'MORNING' && idx?.isOpen) ||
                  (s.key === 'idx_afternoon' && idx?.subSession === 'AFTERNOON' && idx?.isOpen)
                return (
                  <div key={s.key} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <Activity className="h-4 w-4 text-emerald-500" />
                      <div>
                        <Label className="text-sm font-medium cursor-pointer" htmlFor={`toggle-${s.key}`}>
                          {s.label}
                        </Label>
                        <p className="text-[10px] text-muted-foreground">
                          Trading otomatis {s.enabled ? 'diizinkan' : 'dinonaktifkan'} selama sesi ini
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isCurrentlyActive && (
                        <Badge variant="default" className="bg-emerald-600 text-[10px] h-5">
                          AKTIF
                        </Badge>
                      )}
                      <Switch
                        id={`toggle-${s.key}`}
                        checked={s.enabled}
                        disabled={updatingKey === s.key}
                        onCheckedChange={(checked) => handleToggleSession('idx', s.key, checked)}
                      />
                    </div>
                  </div>
                )
              }) ?? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="animate-pulse">Loading...</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Forex Overlap Sessions */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Overlap Sesi Forex
            </p>
            <p className="text-[10px] text-muted-foreground mb-3">
              Aktifkan overlap untuk menambah bonus quality score saat sesi overlap aktif.
              Overlap memberikan likuiditas lebih tinggi dan volatilitas lebih baik.
            </p>
            <div className="space-y-3">
              {sessionConfig?.forexOverlaps.map((overlap) => {
                const isTimeActive = activeOverlapKeys.has(overlap.key)
                const isOverlapCurrentlyActive = overlaps.some(
                  o => o.isActive && (
                    (overlap.key === 'overlap_tokyo_london' && o.name === 'Tokyo-London') ||
                    (overlap.key === 'overlap_ny_london' && o.name === 'New York - London') ||
                    (overlap.key === 'overlap_sydney_tokyo' && o.name === 'Sydney-Tokyo')
                  )
                )
                const displayActive = isTimeActive || isOverlapCurrentlyActive
                const color = OVERLAY_COLORS[overlap.key] ?? '#f97316'

                return (
                  <div
                    key={overlap.key}
                    className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                      displayActive && overlap.enabled ? 'bg-muted/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${color}20` }}
                      >
                        <Zap className="h-4 w-4" style={{ color }} />
                      </div>
                      <div>
                        <Label className="text-sm font-medium cursor-pointer" htmlFor={`toggle-${overlap.key}`}>
                          {overlap.label}
                        </Label>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-muted-foreground">
                            {overlap.key === 'overlap_ny_london' && 'Likuiditas tertinggi — bonus +15 quality score'}
                            {overlap.key === 'overlap_tokyo_london' && 'Transisi Asia-Eropa — bonus +10 quality score'}
                            {overlap.key === 'overlap_sydney_tokyo' && 'Sesi Asia — bonus +5 quality score'}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {displayActive && overlap.enabled && (
                        <Badge
                          variant="outline"
                          className="text-[10px] h-5 animate-pulse"
                          style={{ color, borderColor: color }}
                        >
                          OVERLAP AKTIF
                        </Badge>
                      )}
                      {displayActive && !overlap.enabled && (
                        <Badge variant="secondary" className="text-[10px] h-5">
                          AKTIF (nonaktif)
                        </Badge>
                      )}
                      <Switch
                        id={`toggle-${overlap.key}`}
                        checked={overlap.enabled}
                        disabled={updatingKey === overlap.key}
                        onCheckedChange={(checked) => handleToggleSession('overlap', overlap.key, checked)}
                      />
                    </div>
                  </div>
                )
              }) ?? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="animate-pulse">Loading...</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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

              {TIMELINE_OVERLAPS.map((overlap) => {
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
                      opacity: isActive ? 0.25 : 0.15,
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
              const isEnabled = sessionConfig?.forexOverlaps.find(
                o =>
                  (o.key === 'overlap_tokyo_london' && overlap.name === 'Tokyo-London') ||
                  (o.key === 'overlap_ny_london' && overlap.name === 'New York - London') ||
                  (o.key === 'overlap_sydney_tokyo' && overlap.name === 'Sydney-Tokyo')
              )?.enabled ?? false

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
                  {isEnabled && !isActive && (
                    <Badge variant="secondary" className="h-4 text-[10px] px-1">
                      ON
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
