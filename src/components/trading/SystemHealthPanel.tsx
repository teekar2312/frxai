'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
  Minus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Timer,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react'

// ============================================
// TYPES (mirrors backend v2 API contracts)
// ============================================

interface ComponentCheck {
  ok: boolean
  latencyMs?: number
  detail?: string
}

interface HealthData {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  type: string
  version: string
  uptimeSeconds: number
  latencyMs: number
  timestamp: string
  checks: {
    database: ComponentCheck | null
    mt5Bridge: ComponentCheck | null
    memory: ComponentCheck | null
    disk: ComponentCheck | null
    environment: ComponentCheck | null
  }
}

interface HistogramStats {
  count: number
  sum: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
}

interface MetricsData {
  capturedAt: string
  uptimeSeconds: number
  process: { memoryMb: number; rssMb: number }
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>
  gauges: Array<{ name: string; labels: Record<string, string>; value: number }>
  histograms: Array<{ name: string; labels: Record<string, string>; stats: HistogramStats }>
  rateLimit: {
    activeKeys: number
    totalHits: number
    totalBlocked: number
    prunedKeys?: number
    windowMs: number
    enabled: boolean
    budgets: Record<string, number>
  }
}

interface ChannelConfig {
  channel: 'TELEGRAM' | 'DISCORD'
  envConfigured: boolean
  tokenPreview?: string
  webhookPreview?: string
  chatId?: string | null
  enabled: boolean
  minSeverity: string
  events: string[]
  rateLimitPerMin: number
  consecutiveErrors: number
  lastError: string | null
  lastSentAt: string | null
}

interface NotificationItem {
  id: string
  channel: string
  eventType: string
  title: string
  body: string
  severity: string
  status: string
  attempts: number
  lastError: string | null
  sentAt: string | null
  createdAt: string
}

interface ConfigEntry {
  key: string
  scope: string
  description: string
  mutable: boolean
  effective: unknown
  effectiveType: string
  sources: Array<{ layer: string; value: unknown; updatedAt?: string }>
}

type TestResult = { channel: string; status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string }

// ============================================
// CONSTANTS
// ============================================

const POLL_HEALTH_MS = 12_000
const POLL_METRICS_MS = 15_000
const POLL_NOTIF_MS = 30_000

const CONFIG_SCOPES = [
  'all', 'trading', 'risk', 'notifications', 'logging', 'bridge', 'rateLimit', 'backtest', 'monitoring',
]

const VALID_EVENTS = [
  'TRADE_OPENED', 'TRADE_CLOSED', 'RISK_EVENT', 'CIRCUIT_BREAKER',
  'SYSTEM_ERROR', 'SYSTEM_STARTUP', 'SESSION_CHANGE', 'TEST', 'ALL',
]

const SEVERITIES = ['INFO', 'WARN', 'ERROR', 'CRITICAL']

// MT5 RSS soft threshold (mirrors /api/health checkMemory)
const RSS_LIMIT_MB = 1536
const HEAP_LIMIT_MB = 512

// ============================================
// HELPERS
// ============================================

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0 || isNaN(diff)) return '—'
  if (diff < 10_000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString()
}

// ============================================
// SMALL PRESENTATIONAL COMPONENTS
// ============================================

function StatusBadge({ status }: { status: HealthData['status'] }) {
  const cfg =
    status === 'HEALTHY'
      ? 'bg-emerald-600 hover:bg-emerald-700 gap-1.5'
      : status === 'DEGRADED'
        ? 'bg-amber-600 hover:bg-amber-700 text-white gap-1.5'
        : 'bg-red-600 hover:bg-red-700 gap-1.5'
  return (
    <Badge className={`h-7 px-3 text-xs font-semibold ${cfg}`}>
      {status === 'HEALTHY' ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : status === 'DEGRADED' ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : (
        <XCircle className="h-3.5 w-3.5" />
      )}
      {status}
    </Badge>
  )
}

function CheckRow({ label, icon: Icon, check }: { label: string; icon: typeof Database; check: ComponentCheck | null }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {check === null ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              NOT PROBED
            </Badge>
          ) : check.ok ? (
            <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40 text-[10px]">
              <CheckCircle2 className="h-3 w-3" />
              OK
            </Badge>
          ) : (
            <Badge className="gap-1 bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/40 text-[10px]">
              <XCircle className="h-3 w-3" />
              FAIL
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {check?.latencyMs !== undefined && <span className="font-mono">{check.latencyMs}ms</span>}
          {check?.detail && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate max-w-[220px] cursor-help">{check.detail}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs break-words">
                {check.detail}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

function MemoryBar({ label, valueMb, limitMb, unit = 'MB' }: { label: string; valueMb: number; limitMb: number; unit?: string }) {
  const pct = Math.min(100, Math.round((valueMb / limitMb) * 100))
  const barColor = pct < 60 ? '[&>div]:bg-emerald-500' : pct < 85 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium">
          {valueMb.toFixed(1)} {unit} <span className="text-muted-foreground">/ {limitMb} {unit}</span>
        </span>
      </div>
      <Progress value={pct} className={`h-2 ${barColor}`} />
      <div className="text-right text-[10px] text-muted-foreground">{pct}% of soft limit</div>
    </div>
  )
}

function LayerBadge({ layer }: { layer: string }) {
  const cfg =
    layer === 'runtime'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : layer === 'database'
        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300'
        : layer === 'env'
          ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300'
          : 'bg-muted text-muted-foreground'
  return <Badge variant="secondary" className={`text-[10px] font-mono ${cfg}`}>{layer}</Badge>
}

function NotifStatusBadge({ status }: { status: string }) {
  const cfg =
    status === 'SENT'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : status === 'FAILED'
        ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
        : status === 'PENDING'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
          : 'bg-muted text-muted-foreground'
  return <Badge variant="secondary" className={`text-[10px] ${cfg}`}>{status}</Badge>
}

function SeverityBadge({ severity }: { severity: string }) {
  const cfg =
    severity === 'CRITICAL'
      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
      : severity === 'ERROR'
        ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
        : severity === 'WARN'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
          : 'bg-muted text-muted-foreground'
  return <Badge variant="secondary" className={`text-[10px] ${cfg}`}>{severity}</Badge>
}

// ============================================
// CHANNEL CONFIG CARD (Telegram / Discord)
// ============================================

function ChannelCard({
  cfg,
  saving,
  onPatch,
}: {
  cfg: ChannelConfig
  saving: boolean
  onPatch: (channel: 'TELEGRAM' | 'DISCORD', patch: Record<string, unknown>) => Promise<boolean>
}) {
  const isTelegram = cfg.channel === 'TELEGRAM'
  // Draft override: null = show the server value (no prop→state sync needed)
  const [targetOverride, setTargetOverride] = useState<string | null>(null)
  const targetDraft = targetOverride ?? (cfg.chatId ?? '')
  const targetDirty = targetDraft !== (cfg.chatId ?? '')
  const lastErrorShort = cfg.lastError && cfg.lastError.length > 90 ? `${cfg.lastError.slice(0, 90)}…` : cfg.lastError

  const handleSaveTarget = async () => {
    const value = targetDraft.trim()
    if (!value) return
    const ok = await onPatch(cfg.channel, isTelegram ? { chatId: value } : { webhookUrl: value })
    if (ok) setTargetOverride(null)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            {isTelegram ? <Send className="h-4 w-4 text-emerald-600" /> : <Cable className="h-4 w-4 text-emerald-600" />}
            {isTelegram ? 'Telegram' : 'Discord'}
          </CardTitle>
          <div className="flex items-center gap-2">
            {cfg.envConfigured ? (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Leaf className="h-3 w-3 text-emerald-600" />
                ENV OK
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                NO ENV
              </Badge>
            )}
            <Switch
              checked={cfg.enabled}
              disabled={saving}
              onCheckedChange={(checked) => onPatch(cfg.channel, { enabled: checked })}
              aria-label={`Toggle ${cfg.channel} notifications`}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Target input */}
        <div className="space-y-2">
          <Label htmlFor={`target-${cfg.channel}`} className="text-xs">
            {isTelegram ? 'Chat ID' : 'Webhook URL'}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`target-${cfg.channel}`}
              value={targetDraft}
              onChange={(e) => setTargetOverride(e.target.value)}
              placeholder={isTelegram ? 'e.g. 123456789' : 'https://discord.com/api/webhooks/…'}
              className="text-xs font-mono"
              disabled={saving}
            />
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={saving || !targetDirty || !targetDraft.trim()}
              onClick={handleSaveTarget}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>
        </div>

        {/* Min severity */}
        <div className="space-y-2">
          <Label className="text-xs">Minimum Severity</Label>
          <Select
            value={cfg.minSeverity}
            disabled={saving}
            onValueChange={(v) => onPatch(cfg.channel, { minSeverity: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Events */}
        <div className="space-y-1.5">
          <Label className="text-xs">Events</Label>
          <div className="flex flex-wrap gap-1">
            {VALID_EVENTS.map((ev) => {
              const active = cfg.events.includes(ev)
              return (
                <button
                  key={ev}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const next = active ? cfg.events.filter((e) => e !== ev) : [...cfg.events, ev]
                    onPatch(cfg.channel, { events: next })
                  }}
                  className={
                    active
                      ? 'rounded-full border border-emerald-600 bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-emerald-700'
                      : 'rounded-full border bg-muted text-muted-foreground px-2 py-0.5 text-[10px] transition-colors hover:bg-muted/70'
                  }
                  title={active ? `Click to disable ${ev}` : `Click to enable ${ev}`}
                >
                  {ev}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">Empty = all events dispatched (server default).</p>
        </div>

        {/* Health of channel */}
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-2.5 text-[11px]">
          <div>
            <span className="text-muted-foreground">Errors streak: </span>
            <span className={cfg.consecutiveErrors > 0 ? 'font-mono font-medium text-red-600' : 'font-mono'}>
              {cfg.consecutiveErrors}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Rate limit: </span>
            <span className="font-mono">{cfg.rateLimitPerMin}/min</span>
          </div>
          <div>
            <span className="text-muted-foreground">Last sent: </span>
            <span className="font-mono">{formatAge(cfg.lastSentAt)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Enabled: </span>
            <span className={cfg.enabled ? 'font-mono text-emerald-600' : 'font-mono text-muted-foreground'}>
              {cfg.enabled ? 'yes' : 'no'}
            </span>
          </div>
          {lastErrorShort && (
            <div className="col-span-2 truncate text-red-600 dark:text-red-400" title={cfg.lastError ?? undefined}>
              <XCircle className="mr-1 inline h-3 w-3" />
              {lastErrorShort}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================
// CONFIG ENTRY ROW (inline editor)
// ============================================

function ConfigEntryRow({
  entry,
  busy,
  onSave,
  onReset,
}: {
  entry: ConfigEntry
  busy: boolean
  onSave: (key: string, value: unknown) => Promise<boolean>
  onReset: (key: string) => Promise<boolean>
}) {
  const topLayer = entry.sources[0]?.layer ?? 'default'
  const hasRuntimeOverride = entry.sources.some((s) => s.layer === 'runtime')
  const [editing, setEditing] = useState(false)
  // Draft override: null = show the effective (server) value — avoids prop→state sync
  const [draftOverride, setDraftOverride] = useState<string | null>(null)
  const draft = draftOverride ?? String(entry.effective)

  const isNumber = entry.effectiveType === 'number'
  const isBoolean = entry.effectiveType === 'boolean'

  const validate = (raw: string): { ok: true; value: unknown } | { ok: false; error: string } => {
    if (isNumber) {
      const n = Number(raw)
      if (!Number.isFinite(n)) return { ok: false, error: 'Value must be a valid number' }
      return { ok: true, value: n }
    }
    if (isBoolean) {
      if (raw !== 'true' && raw !== 'false') return { ok: false, error: 'Value must be true or false' }
      return { ok: true, value: raw === 'true' }
    }
    if (!raw.trim()) return { ok: false, error: 'Value cannot be empty' }
    return { ok: true, value: raw.trim() }
  }

  const handleSave = async () => {
    const parsed = validate(draft)
    if (!parsed.ok) {
      toast.error(parsed.error, { description: entry.key })
      return
    }
    const ok = await onSave(entry.key, parsed.value)
    if (ok) {
      setEditing(false)
      setDraftOverride(null)
    }
  }

  const handleCancel = () => {
    setDraftOverride(null)
    setEditing(false)
  }

  return (
    <div className="border-b px-3 py-2.5 last:border-b-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium">{entry.key}</span>
            <LayerBadge layer={topLayer} />
            {!entry.mutable && <Badge variant="outline" className="text-[10px] text-muted-foreground">IMMUTABLE</Badge>}
            {hasRuntimeOverride && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-50"
                    disabled={busy}
                    aria-label={`Reset ${entry.key}`}
                    onClick={() => onReset(entry.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Remove runtime override &amp; reset</TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.description || '—'}</p>
          {/* Layer chain */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {entry.sources.map((s, i) => (
              <Tooltip key={`${entry.key}-${s.layer}`}>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    {i > 0 && <span className="mr-1 text-[10px] text-muted-foreground">←</span>}
                    <LayerBadge layer={s.layer} />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px]">
                  <span className="font-mono">{String(s.value)}</span>
                  {s.updatedAt ? ` (set ${formatAge(s.updatedAt)})` : ''}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:shrink-0">
          {editing ? (
            <>
              {isBoolean ? (
                <Select value={draft} onValueChange={setDraftOverride}>
                  <SelectTrigger className="h-8 w-[110px] text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true" className="text-xs">true</SelectItem>
                    <SelectItem value="false" className="text-xs">false</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={draft}
                  onChange={(e) => setDraftOverride(e.target.value)}
                  className="h-8 w-[140px] text-xs font-mono"
                  autoFocus
                  type={isNumber ? 'number' : 'text'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                    if (e.key === 'Escape') handleCancel()
                  }}
                />
              )}
              <Button size="sm" className="h-8 gap-1 text-xs" disabled={busy} onClick={handleSave}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-xs"
                onClick={handleCancel}
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="max-w-[160px] truncate rounded bg-muted px-2 py-1 font-mono text-xs" title={String(entry.effective)}>
                {String(entry.effective)}
              </span>
              {entry.mutable && (
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setEditing(true)}>
                  <Settings2 className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// MAIN PANEL
// ============================================

export default function SystemHealthPanel() {
  // ---- Health state ----
  const [health, setHealth] = useState<HealthData | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [fullChecking, setFullChecking] = useState(false)

  // ---- Metrics state ----
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [metricsError, setMetricsError] = useState<string | null>(null)

  // ---- Notification state ----
  const [channels, setChannels] = useState<{ telegram: ChannelConfig; discord: ChannelConfig } | null>(null)
  const [channelsLoading, setChannelsLoading] = useState(true)
  const [channelSaving, setChannelSaving] = useState(false)
  const [notifLog, setNotifLog] = useState<{ notifications: NotificationItem[]; stats: { total: number; sent: number; failed: number; pending: number } } | null>(null)
  const [notifLogLoading, setNotifLogLoading] = useState(true)
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

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      const json = await res.json()
      if (json?.data) {
        setHealth(json.data as HealthData)
        setHealthError(null)
      } else {
        setHealthError('Invalid health response')
      }
    } catch {
      setHealthError('Failed to reach /api/health')
    } finally {
      setHealthLoading(false)
    }
  }, [])

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/metrics', { cache: 'no-store' })
      const json = await res.json()
      if (json?.success && json.data) {
        setMetrics(json.data as MetricsData)
        setMetricsError(null)
      } else {
        setMetricsError('Invalid metrics response')
      }
    } catch {
      setMetricsError('Failed to reach /api/metrics')
    } finally {
      setMetricsLoading(false)
    }
  }, [])

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

  const fetchNotifLog = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=20', { cache: 'no-store' })
      const json = await res.json()
      if (json?.success && json.data) {
        setNotifLog(json.data)
      }
    } catch {
      // silent — log keeps stale data
    } finally {
      setNotifLogLoading(false)
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
  // EFFECTS (initial load + polling)
  // ============================================

  useEffect(() => {
    fetchHealth()
    fetchMetrics()
    fetchChannels()
    fetchNotifLog()
    fetchConfig('all')
  }, [fetchHealth, fetchMetrics, fetchChannels, fetchNotifLog, fetchConfig])

  useEffect(() => {
    const h = setInterval(fetchHealth, POLL_HEALTH_MS)
    const m = setInterval(fetchMetrics, POLL_METRICS_MS)
    const n = setInterval(fetchNotifLog, POLL_NOTIF_MS)
    return () => {
      clearInterval(h)
      clearInterval(m)
      clearInterval(n)
    }
  }, [fetchHealth, fetchMetrics, fetchNotifLog])

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
        setHealthError(null)
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
        fetchNotifLog()
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
