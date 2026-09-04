/**
 * Unit tests for src/lib/metrics.ts
 * In-process metrics engine: counters, gauges, histograms, percentiles,
 * Prometheus exposition, snapshot capture, request recording.
 * (DB persistence paths are excluded — they need a live Prisma client.)
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  incrementCounter,
  setGauge,
  observeHistogram,
  recordMetric,
  recordApiRequest,
  histogramStats,
  captureSnapshot,
  renderPrometheus,
  resetMetricsRegistry,
  getRegistry,
  type MetricSeries,
} from '../src/lib/metrics'

describe('counters', () => {
  beforeEach(() => resetMetricsRegistry())

  test('increment by 1 by default', () => {
    incrementCounter('hits')
    incrementCounter('hits')
    const m = getRegistry().get('hits') as MetricSeries | undefined
    expect(m).toBeDefined()
    expect(m!.type).toBe('COUNTER')
    const bucket = m!.series.get('')
    expect(bucket!.count).toBe(2)
  })

  test('increment by custom value with labels', () => {
    incrementCounter('orders_total', { side: 'BUY' }, 5)
    incrementCounter('orders_total', { side: 'SELL' }, 3)
    const m = getRegistry().get('orders_total')!
    expect(m.series.size).toBe(2)
    expect(m.series.get('side=BUY')!.count).toBe(5)
    expect(m.series.get('side=SELL')!.count).toBe(3)
  })

  test('labels are normalized (sorted key order)', () => {
    incrementCounter('x_total', { b: '2', a: '1' })
    incrementCounter('x_total', { a: '1', b: '2' })
    const m = getRegistry().get('x_total')!
    expect(m.series.size).toBe(1)
    expect(m.series.get('a=1,b=2')!.count).toBe(2)
  })

  test('snapshot exposes counter value per label set', () => {
    incrementCounter('c_total', { k: 'v' }, 7)
    const snap = captureSnapshot()
    const found = snap.counters.find((c) => c.name === 'c_total' && c.labels.k === 'v')
    expect(found).toBeDefined()
    expect(found!.value).toBe(7)
  })
})

describe('gauges', () => {
  beforeEach(() => resetMetricsRegistry())

  test('set overwrites the previous value', () => {
    setGauge('temperature', 20)
    setGauge('temperature', 25)
    const snap = captureSnapshot()
    expect(snap.gauges.find((g) => g.name === 'temperature')!.value).toBe(25)
  })

  test('multiple label series are independent', () => {
    setGauge('queue_depth', 5, { queue: 'ai' })
    setGauge('queue_depth', 9, { queue: 'news' })
    const snap = captureSnapshot()
    expect(snap.gauges.find((g) => g.labels.queue === 'ai')!.value).toBe(5)
    expect(snap.gauges.find((g) => g.labels.queue === 'news')!.value).toBe(9)
  })
})

describe('histograms', () => {
  beforeEach(() => resetMetricsRegistry())

  test('histogramStats on empty array', () => {
    const s = histogramStats([])
    expect(s.count).toBe(0)
    expect(s.sum).toBe(0)
    expect(s.p50).toBe(0)
  })

  test('percentiles of a known dataset', () => {
    // values 1..100
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    const s = histogramStats(values)
    expect(s.count).toBe(100)
    expect(s.sum).toBe(5050)
    expect(s.min).toBe(1)
    expect(s.max).toBe(100)
    expect(s.mean).toBeCloseTo(50.5, 5)
    expect(s.p50).toBe(50)
    expect(s.p95).toBe(95)
    expect(s.p99).toBe(99)
  })

  test('observeHistogram accumulates samples with stats in snapshot', () => {
    for (const v of [10, 20, 30, 40]) observeHistogram('lat_ms', v)
    const snap = captureSnapshot()
    const h = snap.histograms.find((x) => x.name === 'lat_ms')!
    expect(h.stats.count).toBe(4)
    expect(h.stats.sum).toBe(100)
    expect(h.stats.min).toBe(10)
    expect(h.stats.max).toBe(40)
  })

  test('sample cap prevents unbounded growth', () => {
    for (let i = 0; i < 2_000; i++) observeHistogram('big_ms', i)
    const snap = captureSnapshot()
    const h = snap.histograms.find((x) => x.name === 'big_ms')!
    expect(h.stats.count).toBeLessThanOrEqual(1_024)
  })
})

describe('recordMetric (generic bridge)', () => {
  beforeEach(() => resetMetricsRegistry())

  test('names ending in _total map to counters', () => {
    recordMetric('bridge_requests_total', { path: '/order' })
    recordMetric('bridge_requests_total', { path: '/order' })
    const snap = captureSnapshot()
    expect(snap.counters.find((c) => c.name === 'bridge_requests_total')!.value).toBe(2)
  })

  test('names ending in _ms map to histograms', () => {
    recordMetric('bridge_request_latency_ms', 123, { path: '/order' })
    const snap = captureSnapshot()
    expect(snap.histograms.find((h) => h.name === 'bridge_request_latency_ms')).toBeDefined()
  })

  test('other names map to gauges', () => {
    recordMetric('queue_depth', {}, 7)
    const snap = captureSnapshot()
    expect(snap.gauges.find((g) => g.name === 'queue_depth' && g.value === 7)).toBeDefined()
  })
})

describe('recordApiRequest', () => {
  beforeEach(() => resetMetricsRegistry())

  test('records request counter with status labels', () => {
    recordApiRequest({ method: 'GET', route: '/api/trades', status: 200, durationMs: 12 })
    const snap = captureSnapshot()
    const c = snap.counters.find((x) => x.name === 'api_requests_total' && x.labels.route === '/api/trades')
    expect(c).toBeDefined()
    expect(c!.labels.status_class).toBe('2xx')
  })

  test('5xx responses also record the error counter', () => {
    recordApiRequest({ method: 'POST', route: '/api/trades', status: 503, durationMs: 5 })
    const snap = captureSnapshot()
    expect(snap.counters.find((x) => x.name === 'api_errors_total')).toBeDefined()
  })
})

describe('captureSnapshot', () => {
  beforeEach(() => resetMetricsRegistry())

  test('includes ambient process gauges (memory, uptime, rss)', () => {
    const snap = captureSnapshot()
    expect(snap.gauges.find((g) => g.name === 'process_uptime_seconds')).toBeDefined()
    expect(snap.gauges.find((g) => g.name === 'process_memory_mb')).toBeDefined()
    expect(snap.gauges.find((g) => g.name === 'process_rss_mb')).toBeDefined()
    expect(snap.process.memoryMb).toBeGreaterThan(0)
    expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(typeof snap.capturedAt).toBe('string')
  })
})

describe('renderPrometheus', () => {
  beforeEach(() => resetMetricsRegistry())

  test('renders counters with HELP/TYPE and label sets', () => {
    incrementCounter('orders_total', { side: 'BUY' }, 4)
    const out = renderPrometheus()
    expect(out).toContain('# HELP orders_total Counter: orders_total')
    expect(out).toContain('# TYPE orders_total counter')
    expect(out).toContain('orders_total{side="BUY"} 4')
    expect(out.endsWith('\n')).toBe(true)
  })

  test('renders gauges and histogram stat lines', () => {
    setGauge('depth', 3)
    observeHistogram('lat_ms', 50)
    const out = renderPrometheus()
    expect(out).toContain('# TYPE depth gauge')
    expect(out).toContain('depth 3')
    expect(out).toContain('# TYPE lat_ms histogram')
    expect(out).toContain('lat_ms_count 1')
    expect(out).toContain('lat_ms_sum 50')
    expect(out).toContain('lat_ms_p95 50')
  })

  test('escapes label values with quotes, backslashes and newlines', () => {
    incrementCounter('esc_total', { msg: 'a"b\\c\nd' })
    const out = renderPrometheus()
    expect(out).toContain('msg="a\\"b\\\\c\\nd"')
  })

  test('includes ambient process metrics', () => {
    const out = renderPrometheus()
    expect(out).toContain('process_uptime_seconds ')
    expect(out).toContain('process_memory_mb ')
  })
})
