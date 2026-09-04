// Shared types, constants and formatting helpers for the System Health panel
// (moved verbatim from SystemHealthPanel.tsx — Task 5 split).
// No 'use client' needed: types + consts + pure functions only.

// ============================================
// TYPES (mirrors backend v2 API contracts)
// ============================================

export interface ComponentCheck {
  ok: boolean
  latencyMs?: number
  detail?: string
}

export interface HealthData {
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

export interface HistogramStats {
  count: number
  sum: number
  min: number
  max: number
  mean: number
  p50: number
  p95: number
  p99: number
}

export interface MetricsData {
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

export interface ChannelConfig {
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

export interface NotificationItem {
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

export interface ConfigEntry {
  key: string
  scope: string
  description: string
  mutable: boolean
  effective: unknown
  effectiveType: string
  sources: Array<{ layer: string; value: unknown; updatedAt?: string }>
}

export type TestResult = { channel: string; status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string }

// ============================================
// CONSTANTS
// ============================================

export const POLL_HEALTH_MS = 12_000
export const POLL_METRICS_MS = 15_000
export const POLL_NOTIF_MS = 30_000

export const CONFIG_SCOPES = [
  'all', 'trading', 'risk', 'notifications', 'logging', 'bridge', 'rateLimit', 'backtest', 'monitoring',
]

export const VALID_EVENTS = [
  'TRADE_OPENED', 'TRADE_CLOSED', 'RISK_EVENT', 'CIRCUIT_BREAKER',
  'SYSTEM_ERROR', 'SYSTEM_STARTUP', 'SESSION_CHANGE', 'TEST', 'ALL',
]

export const SEVERITIES = ['INFO', 'WARN', 'ERROR', 'CRITICAL']

// MT5 RSS soft threshold (mirrors /api/health checkMemory)
export const RSS_LIMIT_MB = 1536
export const HEAP_LIMIT_MB = 512

// ============================================
// HELPERS
// ============================================

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function formatAge(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0 || isNaN(diff)) return '—'
  if (diff < 10_000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString()
}
