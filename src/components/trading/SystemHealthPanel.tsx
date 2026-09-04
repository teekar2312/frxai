'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import {
  Activity,
  AlertTriangle,
  BellRing,
  Cable,
  CheckCircle2,
  Database,
  Gauge,
  HardDrive,
  HeartPulse,
  Layers,
  Leaf,
  Loader2,
  MemoryStick,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Timer,
  Zap,
} from 'lucide-react'
import { useApiQuery } from '@/hooks/use-api-query'
import { ChannelCard } from './system-health/ChannelCard'
import { ConfigEntryRow } from './system-health/ConfigEntryRow'
import { CheckRow, MemoryBar, NotifStatusBadge, SeverityBadge, StatusBadge } from './system-health/badges'
import {
  CONFIG_SCOPES,
  formatAge,
  formatClock,
  formatUptime,
  HEAP_LIMIT_MB,
  POLL_HEALTH_MS,
  POLL_METRICS_MS,
  POLL_NOTIF_MS,
  RSS_LIMIT_MB,
  type ChannelConfig,
  type ConfigEntry,
  type HealthData,
  type MetricsData,
  type NotificationItem,
  type TestResult,
} from './system-health/types'

/** Payload of GET /api/notifications?limit=20 — was the inline useState type. */
type NotifLogPayload = {
  notifications: NotificationItem[]
  stats: { total: number; sent: number; failed: number; pending: number }
}

// ============================================
// MAIN PANEL
// ============================================

export default function SystemHealthPanel() {
  // ---- Health state ----
  // `health` stays a local mirror: runFullCheck (on-demand readiness sweep on
  // a different URL — not hook-compatible) lands its response here directly.
  const [health, setHealth] = useState<HealthData | null>(null)
  const [fullChecking, setFullChecking] = useState(false)

  // ---- Health / metrics / notif-log polls (was fetchHealth + fetchMetrics +
  // fetchNotifLog + three setIntervals) ----
  const { data: fetchedHealth, loading: healthLoading, error: healthError } = useApiQuery<HealthData>({
    url: '/api/health',
    intervalMs: POLL_HEALTH_MS,
    transform: (json) => {
      const d = (json as { data?: unknown } | null)?.data
      return d && typeof d === 'object' ? (d as HealthData) : undefined
    },
  })
  // Mirror poll data → the health state shared by render + runFullCheck.
  useEffect(() => {
    if (fetchedHealth !== null) setHealth(fetchedHealth)
  }, [fetchedHealth])

  const { data: metrics, loading: metricsLoading, error: metricsError } = useApiQuery<MetricsData>({
    url: '/api/metrics',
    intervalMs: POLL_METRICS_MS,
    transform: (json) => {
      const d = (json as { success?: unknown; data?: unknown } | null)
      return d?.success && d.data ? (d.data as MetricsData) : undefined
    },
  })

  const { data: notifLog, loading: notifLogLoading, refresh: notifLogRefresh } = useApiQuery<NotifLogPayload>({
    url: '/api/notifications?limit=20',
    intervalMs: POLL_NOTIF_MS,
    transform: (json) => {
      const d = (json as { success?: unknown; data?: unknown } | null)
      return d?.success && d.data ? (d.data as NotifLogPayload) : undefined
    },
  })

  // ---- Notification state ----
  const [channels, setChannels] = useState<{ telegram: ChannelConfig; discord: ChannelConfig } | null>(null)
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [channelSaving, setChannelSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState<TestResult[] | null>(null)

  // ---- Runtime config state ----
  const [configScope, setConfigScope] = useState('all')
  const [configEntries, setConfigEntries] = useState<ConfigEntry[]>([])
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configBusyKey, setConfigBusyKey] = useState<string | null>(null)

  // ============================================
  // FETCHERS
  // ============================================

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/config', { cache: 'no-store' })
      const json = await res.json()
      if (json?.success && json.data) {
        setChannels(json.data)
      }
    } catch {
      // silent — cards keep stale data
    } finally {
      setChannelsLoading(false)
    }
  }, [])

  const fetchConfig = useCallback(async (scope: string) => {
    setConfigLoading(true)
    setConfigError(null)
    try {
      const qs = scope && scope !== 'all' ? `?scope=${encodeURIComponent(scope)}` : ''
      const res = await fetch(`/api/config${qs}`, { cache: 'no-store' })
      const json = await res.json()
      if (json?.success && json.data) {
        setConfigEntries(json.data.entries ?? [])
      } else {
        setConfigError('Failed to load config entries')
      }
    } catch {
      setConfigError('Failed to reach /api/config')
    } finally {
      setConfigLoading(false)
    }
  }, [])

  // ============================================
  // EFFECTS (initial load — health/metrics/notif-log self-fetch via useApiQuery)
  // ============================================

  useEffect(() => {
    fetchChannels()
    fetchConfig('all')
  }, [fetchChannels, fetchConfig])

  // ============================================
  // DERIVED DATA
  // ============================================

  const routeStats = useMemo(() => {
    let total = 0
    const byRoute = new Map<string, number>()
    if (metrics) {
      for (const c of metrics.counters) {
        if (c.name !== 'api_requests_total') continue
        total += c.value
        const route = c.labels.route ?? 'unknown'
        byRoute.set(route, (byRoute.get(route) ?? 0) + c.value)
      }
    }
    const routes = Array.from(byRoute.entries())
      .map(([route, value]) => ({ route, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
    return { total, routes }
  }, [metrics])

  const latencyRows = useMemo(() => {
    if (!metrics) return [] as Array<{ name: string; label: string; p95: number; p99: number; count: number }>
    const rows: Array<{ name: string; label: string; p95: number; p99: number; count: number }> = []
    for (const h of metrics.histograms) {
      if (h.name !== 'api_request_duration_ms' && h.name !== 'health_check_duration_ms') continue
      const method = h.labels.method ? `${h.labels.method} ` : ''
      const target = h.labels.route ?? h.labels.type ?? 'overall'
      rows.push({ name: h.name, label: `${method}${target}`, p95: h.stats.p95, p99: h.stats.p99, count: h.stats.count })
    }
    return rows.sort((a, b) => b.p95 - a.p95).slice(0, 6)
  }, [metrics])

  // ============================================
  // ACTIONS
  // ============================================

  const runFullCheck = async () => {
    setFullChecking(true)
    try {
      const res = await fetch('/api/health?type=readiness', { cache: 'no-store' })
      const json = await res.json()
      if (json?.data) {
        setHealth(json.data as HealthData)
        const status = json.data.status as HealthData['status']
        if (status === 'HEALTHY') {
          toast.success('Full readiness check passed', { description: `All dependencies OK (${json.data.latencyMs}ms)` })
        } else if (status === 'DEGRADED') {
          toast.warning('System is DEGRADED', { description: 'Some dependencies failed — see component checks' })
        } else {
          toast.error('System is UNHEALTHY', { description: 'Database check failed' })
        }
      } else {
        toast.error('Full check returned an invalid response')
      }
    } catch {
      toast.error('Failed to run full readiness check')
    } finally {
      setFullChecking(false)
    }
  }

  const patchChannel = async (channel: 'TELEGRAM' | 'DISCORD', patch: Record<string, unknown>): Promise<boolean> => {
    setChannelSaving(true)
    try {
      const res = await fetch('/api/notifications/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, ...patch }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message || 'Failed to update channel config')
        return false
      }
      toast.success(`${channel} config updated`, { description: Object.keys(patch).join(', ') })
      await fetchChannels()
      return true
    } catch {
      toast.error('Network error updating channel config')
      return false
    } finally {
      setChannelSaving(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    setTestResults(null)
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' })
      const json = await res.json()
      if (json?.success && json.data) {
        setTestResults(json.data.results ?? [])
        const sent = (json.data.results as TestResult[]).filter((r) => r.status === 'SENT').length
        if (sent > 0) {
          toast.success(`Test dispatched to ${sent} channel${sent > 1 ? 's' : ''}`, { description: json.data.summary })
        } else {
          toast.warning('No channel delivered the test', { description: 'Enable a channel & configure its target first' })
        }
        // The TEST event is logged — refresh the log
        void notifLogRefresh()
      } else {
        toast.error('Test notification failed')
      }
    } catch {
      toast.error('Network error sending test notification')
    } finally {
      setTesting(false)
    }
  }

  const saveConfigValue = async (key: string, value: unknown): Promise<boolean> => {
    setConfigBusyKey(key)
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message || `Failed to set ${key}`)
        return false
      }
      toast.success(`${key} updated`, { description: `Runtime value: ${String(value)}` })
      await fetchConfig(configScope)
      return true
    } catch {
      toast.error(`Network error updating ${key}`)
      return false
    } finally {
      setConfigBusyKey(null)
    }
  }

  const resetConfigKey = async (key: string): Promise<boolean> => {
    setConfigBusyKey(key)
    try {
      const res = await fetch(`/api/config?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message || `Failed to reset ${key}`)
        return false
      }
      toast.success(`${key} reset`, { description: 'Runtime override removed' })
      await fetchConfig(configScope)
      return true
    } catch {
      toast.error(`Network error resetting ${key}`)
      return false
    } finally {
      setConfigBusyKey(null)
    }
  }

  const handleScopeChange = (scope: string) => {
    setConfigScope(scope)
    fetchConfig(scope)
  }

  // ============================================
  // RENDER
  // ============================================

  const status = health?.status
  const statusAccent =
    status === 'HEALTHY' ? 'text-emerald-600' : status === 'DEGRADED' ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Activity className={`h-5 w-5 ${statusAccent}`} />
            System Health
          </h2>
          <p className="text-xs text-muted-foreground">
            Live monitoring · auto-refresh every 12–15s
            {health && <span className="ml-1 font-mono">· checked {formatAge(health.timestamp)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {healthError && (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <AlertTriangle className="h-3 w-3" />
              HEALTH API ERROR
            </Badge>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={runFullCheck} disabled={fullChecking}>
            {fullChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
            Run Full Check
          </Button>
        </div>
      </div>

      <Tabs defaultValue="health">
        <TabsList className="bg-muted p-1 h-auto gap-0.5">
          <TabsTrigger value="health" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5">
            <HeartPulse className="h-3.5 w-3.5" />
            Health &amp; Metrics
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5">
            <BellRing className="h-3.5 w-3.5" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Runtime Config
          </TabsTrigger>
        </TabsList>

        {/* ================= HEALTH & METRICS ================= */}
        <TabsContent value="health" className="space-y-4">
          {/* Overview + component checks */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Overall Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {healthLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-7 w-28" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : healthError && !health ? (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="text-xs">{healthError}</span>
                  </div>
                ) : health ? (
                  <>
                    <div className="flex items-center justify-between">
                      <StatusBadge status={health.status} />
                      <span className="text-[10px] font-mono text-muted-foreground">v{health.version}</span>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Timer className="h-3.5 w-3.5" />
                          Uptime
                        </span>
                        <span className="font-mono font-medium">{formatUptime(health.uptimeSeconds)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5" />
                          Check latency
                        </span>
                        <span className={`font-mono font-medium ${health.latencyMs > 500 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {health.latencyMs}ms
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Probe type</span>
                        <span className="font-mono">{health.type}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Last check</span>
                        <span className="font-mono">{formatClock(health.timestamp)}</span>
                      </div>
                    </div>
                    <Button size="sm" className="w-full gap-1.5" onClick={runFullCheck} disabled={fullChecking}>
                      {fullChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
                      Run Full Readiness Check
                    </Button>
                  </>
                ) : null}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Layers className="h-4 w-4 text-emerald-600" />
                    Component Checks
                  </CardTitle>
                  {health?.type === 'readiness' ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-600 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      FULL SWEEP
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      LIVENESS — run full check for bridge/disk
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {healthLoading ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CheckRow label="Database" icon={Database} check={health?.checks.database ?? null} />
                    <CheckRow label="MT5 Bridge" icon={Cable} check={health?.checks.mt5Bridge ?? null} />
                    <CheckRow label="Memory" icon={MemoryStick} check={health?.checks.memory ?? null} />
                    <CheckRow label="Disk" icon={HardDrive} check={health?.checks.disk ?? null} />
                    {health?.checks.environment && (
                      <CheckRow label="Environment" icon={Leaf} check={health.checks.environment} />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* API traffic */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Gauge className="h-4 w-4 text-emerald-600" />
                    API Traffic
                  </CardTitle>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {metrics ? `since start · ${formatUptime(metrics.uptimeSeconds)}` : '—'}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {metricsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-5 w-full" />
                    ))}
                  </div>
                ) : metricsError && !metrics ? (
                  <div className="flex items-center gap-2 text-xs text-red-600">
                    <AlertTriangle className="h-4 w-4" /> {metricsError}
                  </div>
                ) : routeStats.routes.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No API traffic recorded yet — metrics counters are empty.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Total requests</span>
                      <span className="font-mono text-sm font-semibold">{routeStats.total.toLocaleString()}</span>
                    </div>
                    <div className="space-y-1.5">
                      {routeStats.routes.map((r, i) => (
                        <div key={r.route} className="flex items-center gap-2">
                          <span className="w-4 shrink-0 text-[10px] text-muted-foreground font-mono">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={r.route}>
                            {r.route}
                          </span>
                          <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${Math.max(4, (r.value / (routeStats.routes[0]?.value || 1)) * 100)}%` }}
                            />
                          </div>
                          <span className="w-12 shrink-0 text-right font-mono text-xs font-medium">{r.value.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rate limiting */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Rate Limiting
                  </CardTitle>
                  {metrics?.rateLimit && (
                    <Badge
                      variant="secondary"
                      className={
                        metrics.rateLimit.enabled
                          ? 'text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'text-[10px] bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                      }
                    >
                      {metrics.rateLimit.enabled ? 'ENABLED' : 'DISABLED'}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {metricsLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : metrics?.rateLimit ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border p-2 text-center">
                        <div className="text-lg font-bold font-mono text-emerald-600">{metrics.rateLimit.totalHits.toLocaleString()}</div>
                        <div className="text-[10px] text-muted-foreground">HITS</div>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <div className={`text-lg font-bold font-mono ${metrics.rateLimit.totalBlocked > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {metrics.rateLimit.totalBlocked.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-muted-foreground">BLOCKED</div>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <div className="text-lg font-bold font-mono">{metrics.rateLimit.activeKeys}</div>
                        <div className="text-[10px] text-muted-foreground">ACTIVE KEYS</div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[10px] text-muted-foreground">
                        Sliding window budgets (per IP, {Math.round(metrics.rateLimit.windowMs / 1000)}s):
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        {(['READ', 'WRITE', 'AI', 'DRAFT'] as const).map((tier) => {
                          const budget = metrics.rateLimit?.budgets?.[tier]
                          return (
                            <div key={tier} className="rounded-md bg-muted/50 px-2 py-1.5 text-center">
                              <div className="text-[10px] text-muted-foreground">{tier}</div>
                              <div className="font-mono text-xs font-semibold">
                                {budget === undefined || budget > 1e9 ? '∞' : budget}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">{metricsError || 'No rate limit data'}</p>
                )}
              </CardContent>
            </Card>

            {/* Process memory */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <MemoryStick className="h-4 w-4 text-emerald-600" />
                  Process Memory
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {metricsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : metrics ? (
                  <>
                    <MemoryBar label="Heap used (process_memory_mb)" valueMb={metrics.process.memoryMb} limitMb={HEAP_LIMIT_MB} />
                    <MemoryBar label="RSS (process_rss_mb)" valueMb={metrics.process.rssMb} limitMb={RSS_LIMIT_MB} />
                    <p className="text-[10px] text-muted-foreground">
                      Snapshot {formatClock(metrics.capturedAt)} · {formatAge(metrics.capturedAt)} · metrics gauge poll 15s
                    </p>
                  </>
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">{metricsError || 'No memory data'}</p>
                )}
              </CardContent>
            </Card>

            {/* Latency histograms */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Timer className="h-4 w-4 text-emerald-600" />
                  Latency (p95)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {metricsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-5 w-full" />
                    ))}
                  </div>
                ) : latencyRows.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No latency samples yet (api_request_duration_ms / health_check_duration_ms).
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {latencyRows.map((row, i) => (
                      <Tooltip key={`${row.name}-${row.label}-${i}`}>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={`${row.name} · ${row.label}`}>
                              {row.label}
                            </span>
                            <Badge variant="outline" className="text-[9px] shrink-0">
                              {row.name === 'api_request_duration_ms' ? 'API' : 'HEALTH'}
                            </Badge>
                            <span
                              className={`w-16 shrink-0 text-right font-mono text-xs font-semibold ${
                                row.p95 > 1000 ? 'text-red-600' : row.p95 > 300 ? 'text-amber-600' : 'text-emerald-600'
                              }`}
                            >
                              {Math.round(row.p95)}ms
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div className="font-mono text-xs">
                            count={row.count} · p99={Math.round(row.p99)}ms
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Errors */}
          {(healthError || metricsError) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Live polling issue
              </div>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {healthError && <li>Health: {healthError}{health ? ' (showing stale data)' : ''}</li>}
                {metricsError && <li>Metrics: {metricsError}{metrics ? ' (showing stale data)' : ''}</li>}
              </ul>
            </div>
          )}
        </TabsContent>

        {/* ================= NOTIFICATIONS ================= */}
        <TabsContent value="notifications" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {channelsLoading ? (
              <>
                <Card>
                  <CardContent className="space-y-3 p-6">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-3 p-6">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </CardContent>
                </Card>
              </>
            ) : channels ? (
              <>
                <ChannelCard cfg={channels.telegram} saving={channelSaving} onPatch={patchChannel} />
                <ChannelCard cfg={channels.discord} saving={channelSaving} onPatch={patchChannel} />
              </>
            ) : (
              <Card className="lg:col-span-2">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Failed to load notification channel config.
                </CardContent>
              </Card>
            )}
          </div>

          {/* Test dispatch */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Send className="h-4 w-4 text-emerald-600" />
                  Test Dispatch
                </CardTitle>
                <Button size="sm" className="gap-1.5" onClick={sendTest} disabled={testing}>
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Send Test
                </Button>
              </div>
            </CardHeader>
            {testResults && (
              <CardContent className="pt-0">
                <div className="space-y-1.5">
                  {testResults.map((r) => (
                    <div key={r.channel} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                      <span className="font-mono font-medium">{r.channel}</span>
                      <NotifStatusBadge status={r.status} />
                      {r.error && <span className="min-w-0 flex-1 truncate text-red-600 dark:text-red-400" title={r.error}>{r.error}</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Recent log */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <BellRing className="h-4 w-4 text-emerald-600" />
                  Recent Notifications
                </CardTitle>
                {notifLog?.stats && (
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <Badge variant="secondary" className="gap-1 font-mono">
                      {notifLog.stats.total} total
                    </Badge>
                    <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-mono">
                      {notifLog.stats.sent} sent
                    </Badge>
                    <Badge variant="secondary" className="gap-1 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 font-mono">
                      {notifLog.stats.failed} failed
                    </Badge>
                    <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-mono">
                      {notifLog.stats.pending} pending
                    </Badge>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {notifLogLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !notifLog || notifLog.notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <BellRing className="h-5 w-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    No notifications yet — trigger a test or a trade event.
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[360px]">
                  <div className="divide-y">
                    {notifLog.notifications.map((n) => (
                      <div key={n.id} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="mt-0.5 shrink-0">
                          <NotifStatusBadge status={n.status} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="truncate text-xs font-medium">{n.title}</span>
                            <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                              {n.channel}
                            </Badge>
                            <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                              {n.eventType}
                            </Badge>
                            <SeverityBadge severity={n.severity} />
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground" title={n.body}>
                            {n.body}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="font-mono">{formatAge(n.sentAt ?? n.createdAt)}</span>
                            {n.attempts > 1 && <span className="font-mono">· {n.attempts} attempts</span>}
                            {n.lastError && (
                              <span className="min-w-0 truncate text-red-600 dark:text-red-400" title={n.lastError}>
                                · {n.lastError}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= RUNTIME CONFIG ================= */}
        <TabsContent value="config" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Settings2 className="h-4 w-4 text-emerald-600" />
                    Runtime Configuration
                  </CardTitle>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    4-layer hierarchy: default → env → database → runtime override (persisted)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={configScope} onValueChange={handleScopeChange}>
                    <SelectTrigger className="h-8 w-[170px] text-xs">
                      <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFIG_SCOPES.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {s === 'all' ? 'All scopes' : s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => fetchConfig(configScope)}
                    disabled={configLoading}
                  >
                    {configLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {configLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-1">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-72" />
                      </div>
                      <Skeleton className="h-7 w-28" />
                    </div>
                  ))}
                </div>
              ) : configError ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-red-600">
                  <AlertTriangle className="h-4 w-4" /> {configError}
                </div>
              ) : configEntries.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No config entries in this scope.
                </div>
              ) : (
                <ScrollArea className="h-[520px]">
                  <div>
                    {configEntries.map((entry) => (
                      <ConfigEntryRow
                        key={entry.key}
                        entry={entry}
                        busy={configBusyKey === entry.key}
                        onSave={saveConfigValue}
                        onReset={resetConfigKey}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
