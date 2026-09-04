/**
 * FRxAI — Metrics & Observability Engine
 * =======================================
 * In-process metrics collection with:
 *   - Counters (monotonic, labeled)
 *   - Gauges (point-in-time values)
 *   - Histograms (latency/size distributions with p50/p95/p99)
 *   - Prometheus text exposition (/api/metrics?format=prometheus)
 *   - JSON snapshot API (/api/metrics)
 *   - Periodic DB persistence (MetricsSnapshot) with retention cleanup
 *   - Request tracking middleware helper (recordApiRequest)
 *
 * Zero external dependencies — safe for edge/serverless-style Next.js
 * route handlers. Single-process semantics match the deployment model.
 */

import { db } from './db'
import { getConfig } from './app-config'
import { registerRateLimitMetricsRecorder } from './rate-limit'

// ============================================
// TYPES
// ============================================

export type MetricType = 'COUNTER' | 'GAUGE' | 'HISTOGRAM'

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

export interface MetricSeries {
  name: string
  type: MetricType
  description: string
  /** label_key -> label_value -> samples (single "no labels" series uses '') */
  series: Map<string, { labels: Record<string, string>; values: number[]; count: number; sum: number; min: number; max: number }>
}

export interface MetricsSnapshotResult {
  capturedAt: string
  uptimeSeconds: number
  process: { memoryMb: number; rssMb: number }
  counters: Array<{ name: string; labels: Record<string, string>; value: number }>
  gauges: Array<{ name: string; labels: Record<string, string>; value: number }>
  histograms: Array<{ name: string; labels: Record<string, string>; stats: HistogramStats }>
}

// ============================================
// REGISTRY
// ============================================

const registry = new Map<string, MetricSeries>()
const startedAt = Date.now()
const MAX_SAMPLES_PER_SERIES = 1_024

function getOrCreate(name: string, type: MetricType, description = ''): MetricSeries {
  let m = registry.get(name)
  if (!m) {
    m = { name, type, description, series: new Map() }
    registry.set(name, m)
  }
  return m
}

function labelKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return ''
  return keys.map((k) => `${k}=${labels[k]}`).join(',')
}

function getBucket(m: MetricSeries, labels: Record<string, string>) {
  const key = labelKey(labels)
  let bucket = m.series.get(key)
  if (!bucket) {
    bucket = { labels, values: [], count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
    m.series.set(key, bucket)
  }
  return bucket
}

function pushSample(bucket: MetricSeries['series'] extends Map<string, infer V> ? V : never, value: number): void {
  bucket.values.push(value)
  if (bucket.values.length > MAX_SAMPLES_PER_SERIES) bucket.values.shift()
  bucket.count++
  bucket.sum += value
  bucket.min = Math.min(bucket.min, value)
  bucket.max = Math.max(bucket.max, value)
}

// ============================================
// PUBLIC API
// ============================================

/** Increment a counter by 1 (or `value`). */
export function incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
  if (!metricsEnabled()) return
  const m = getOrCreate(name, 'COUNTER', `Counter: ${name}`)
  const bucket = getBucket(m, labels)
  bucket.count += value
  bucket.sum += value
}

/** Set a gauge value. */
export function setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
  if (!metricsEnabled()) return
  const m = getOrCreate(name, 'GAUGE', `Gauge: ${name}`)
  const bucket = getBucket(m, labels)
  bucket.values = [value]
  bucket.count = 1
  bucket.sum = value
  bucket.min = value
  bucket.max = value
}

/** Observe a histogram sample (latency ms, sizes, etc). */
export function observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
  if (!metricsEnabled()) return
  const m = getOrCreate(name, 'HISTOGRAM', `Histogram: ${name}`)
  pushSample(getBucket(m, labels), value)
}

/** Generic recorder used by cross-module bridges (e.g. rate-limit). */
export function recordMetric(name: string, labels: Record<string, string>, value = 1): void {
  if (name.endsWith('_total')) incrementCounter(name, labels, value)
  else if (name.endsWith('_ms') || name.endsWith('_bytes')) observeHistogram(name, value, labels)
  else setGauge(name, value, labels)
}

function metricsEnabled(): boolean {
  try {
    return getConfig<boolean>('monitoring.metricsEnabled')
  } catch {
    return true
  }
}

// ============================================
// REQUEST TRACKING
// ============================================

export interface ApiRequestRecord {
  method: string
  route: string
  status: number
  durationMs: number
}

/** Record an API request outcome — call from the metrics middleware. */
export function recordApiRequest(rec: ApiRequestRecord): void {
  const statusClass = `${Math.floor(rec.status / 100)}xx`
  incrementCounter('api_requests_total', { method: rec.method, route: rec.route, status: String(rec.status), status_class: statusClass })
  observeHistogram('api_request_duration_ms', rec.durationMs, { method: rec.method, route: rec.route })
  if (rec.status >= 500) incrementCounter('api_errors_total', { method: rec.method, route: rec.route, status: String(rec.status) })
}

// Register the rate-limit bridge at import time (once).
registerRateLimitMetricsRecorder(recordMetric)

// ============================================
// SNAPSHOTS
// ============================================

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

export function histogramStats(values: number[]): HistogramStats {
  if (values.length === 0) return { count: 0, sum: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    count: sorted.length,
    sum,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  }
}

/** Capture a full in-memory snapshot (JSON shape for /api/metrics). */
export function captureSnapshot(): MetricsSnapshotResult {
  const mem = process.memoryUsage()
  const counters: MetricsSnapshotResult['counters'] = []
  const gauges: MetricsSnapshotResult['gauges'] = []
  const histograms: MetricsSnapshotResult['histograms'] = []

  for (const m of registry.values()) {
    for (const bucket of m.series.values()) {
      if (m.type === 'COUNTER') counters.push({ name: m.name, labels: bucket.labels, value: bucket.count })
      else if (m.type === 'GAUGE') gauges.push({ name: m.name, labels: bucket.labels, value: bucket.values[0] ?? 0 })
      else histograms.push({ name: m.name, labels: bucket.labels, stats: histogramStats(bucket.values) })
    }
  }

  // Ambient process gauges
  gauges.push({ name: 'process_uptime_seconds', labels: {}, value: Math.round((Date.now() - startedAt) / 1000) })
  gauges.push({ name: 'process_memory_mb', labels: {}, value: Math.round(mem.heapUsed / 1048576 * 10) / 10 })
  gauges.push({ name: 'process_rss_mb', labels: {}, value: Math.round(mem.rss / 1048576 * 10) / 10 })

  return {
    capturedAt: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    process: { memoryMb: Math.round(mem.heapUsed / 1048576 * 10) / 10, rssMb: Math.round(mem.rss / 1048576 * 10) / 10 },
    counters,
    gauges,
    histograms,
  }
}

// ============================================
// PROMETHEUS EXPOSITION
// ============================================

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function formatLabels(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort()
  if (keys.length === 0) return ''
  return `{${keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`).join(',')}}`
}

/** Render metrics in Prometheus text exposition format. */
export function renderPrometheus(): string {
  const lines: string[] = []
  const typeFor = (t: MetricType) => (t === 'COUNTER' ? 'counter' : t === 'GAUGE' ? 'gauge' : 'histogram')

  for (const m of registry.values()) {
    lines.push(`# HELP ${m.name} ${m.description || m.name}`)
    lines.push(`# TYPE ${m.name} ${typeFor(m.type)}`)
    for (const bucket of m.series.values()) {
      const lbl = formatLabels(bucket.labels)
      if (m.type === 'HISTOGRAM') {
        const s = histogramStats(bucket.values)
        lines.push(`${m.name}_count${lbl} ${s.count}`)
        lines.push(`${m.name}_sum${lbl} ${s.sum}`)
        lines.push(`${m.name}_min${lbl} ${s.min}`)
        lines.push(`${m.name}_max${lbl} ${s.max}`)
        lines.push(`${m.name}_mean${lbl} ${s.mean}`)
        lines.push(`${m.name}_p50${lbl} ${s.p50}`)
        lines.push(`${m.name}_p95${lbl} ${s.p95}`)
        lines.push(`${m.name}_p99${lbl} ${s.p99}`)
      } else if (m.type === 'GAUGE') {
        lines.push(`${m.name}${lbl} ${bucket.values[0] ?? 0}`)
      } else {
        lines.push(`${m.name}${lbl} ${bucket.count}`)
      }
    }
  }

  // Ambient process metrics
  const mem = process.memoryUsage()
  lines.push(`# HELP process_uptime_seconds Process uptime in seconds`)
  lines.push(`# TYPE process_uptime_seconds gauge`)
  lines.push(`process_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`)
  lines.push(`# HELP process_memory_mb Heap used in MB`)
  lines.push(`# TYPE process_memory_mb gauge`)
  lines.push(`process_memory_mb ${Math.round(mem.heapUsed / 1048576 * 10) / 10}`)

  return `${lines.join('\n')}\n`
}

// ============================================
// DB PERSISTENCE (periodic snapshots)
// ============================================

let snapshotTimer: ReturnType<typeof setInterval> | null = null
let persistRunning = false

/** Persist the current snapshot into MetricsSnapshot rows. */
export async function persistMetricsSnapshot(): Promise<number> {
  if (persistRunning) return 0
  persistRunning = true
  try {
    const snap = captureSnapshot()
    const rows: Array<{ metricType: string; name: string; labels: string; value: number; count: number; sum: number; min: number; max: number; p50: number; p95: number; p99: number }> = []
    for (const c of snap.counters) rows.push({ metricType: 'COUNTER', name: c.name, labels: JSON.stringify(c.labels), value: c.value, count: c.value, sum: c.value, min: 0, max: 0, p50: 0, p95: 0, p99: 0 })
    for (const g of snap.gauges) rows.push({ metricType: 'GAUGE', name: g.name, labels: JSON.stringify(g.labels), value: g.value, count: 1, sum: g.value, min: g.value, max: g.value, p50: g.value, p95: g.value, p99: g.value })
    for (const h of snap.histograms) rows.push({ metricType: 'HISTOGRAM', name: h.name, labels: JSON.stringify(h.labels), value: h.stats.mean, count: h.stats.count, sum: h.stats.sum, min: h.stats.min, max: h.stats.max, p50: h.stats.p50, p95: h.stats.p95, p99: h.stats.p99 })

    if (rows.length === 0) return 0
    await db.metricsSnapshot.createMany({ data: rows })
    // Retention: keep last 24h of snapshots, prune in chunks
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await db.metricsSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } })
    return rows.length
  } catch {
    return 0
  } finally {
    persistRunning = false
  }
}

/** Start periodic persistence (idempotent). Called at server boot. */
export function startMetricsPersistence(): void {
  if (snapshotTimer) return
  let intervalMs = 300_000
  try { intervalMs = getConfig<number>('monitoring.metricsSnapshotIntervalMs') } catch { /* default */ }
  snapshotTimer = setInterval(() => {
    void persistMetricsSnapshot()
  }, intervalMs)
  // Don't hold the process open for metrics flushing
  if (typeof snapshotTimer === 'object' && snapshotTimer && 'unref' in snapshotTimer) (snapshotTimer as { unref: () => void }).unref()
}

/** Stop persistence (tests). */
export function stopMetricsPersistence(): void {
  if (snapshotTimer) clearInterval(snapshotTimer)
  snapshotTimer = null
}

// ============================================
// TEST HELPERS
// ============================================

export function resetMetricsRegistry(): void {
  registry.clear()
}

export function getRegistry(): Map<string, MetricSeries> {
  return registry
}
