'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Centralised API polling hook.
 *
 * Kills the recurring crash/bug class where components polled endpoints with
 * hand-rolled setInterval + res.json() plumbing:
 *   - StrategyMonitor (3adb99e) "strategies.filter is not a function"
 *   - RiskManagement  (b09952f) "sessionRiskUsedPct.toFixed" on undefined
 *   - StockWatchlist / PriceAlerts — interval cleared on tab-hide and never
 *     restarted → polling died permanently after a tab switch
 *
 * Guarantees:
 *   1. Stale-response guard — a superseded fetch never lands state
 *   2. In-flight request aborted on unmount / url change
 *   3. Polling pauses while the tab is hidden and resumes (with an immediate
 *      refresh) when visible again
 *   4. Malformed payloads are contained inside `transform` — components keep
 *      rendering stale data instead of crashing
 *   5. Interval cleaned up on unmount — no leaks
 *
 * Typical usage:
 *   const { data, loading, refresh } = useApiQuery<Trade[]>({
 *     url: '/api/trades?status=OPEN',
 *     intervalMs: 5000,
 *     transform: (json) => extractApiData<Trade[]>(json, []),
 *   })
 */

export interface UseApiQueryOptions<T> {
  /** Endpoint to query. `null` disables the query entirely (no fetch, no polling). */
  url: string | null
  /** Poll interval in ms. 0 (default) = fetch once per url change. */
  intervalMs?: number
  /** Pause polling while the tab is hidden. Default: true when intervalMs > 0. */
  pauseWhenHidden?: boolean
  /**
   * Extract + normalise the payload from the parsed JSON body.
   * All defensive guards (Array.isArray, Number(x) || 0, enum whitelists)
   * belong here — a malformed payload degrades to the fallback instead of
   * crashing render.
   *
   * Returning `undefined` keeps the PREVIOUS data — the containment
   * contract for endpoints whose payload may transiently lack the expected
   * shape (see StrategyMonitor crash 3adb99e).
   */
  transform?: (json: unknown) => T | undefined
  /**
   * Side-effect hook (toasts, config sync) — invoked with the parsed JSON of
   * every successful response, outside render. Kept in a ref so it never
   * destabilises the fetch effect. Must not throw.
   */
  onJson?: (json: unknown) => void
  /** Initial value for `data` (default null). */
  initialData?: T
}

export interface UseApiQueryResult<T> {
  /** Latest transformed payload, or `initialData`/null before the first response. */
  data: T | null
  /** True until the first fetch for the current url settles. */
  loading: boolean
  /** Human-readable error of the last failed fetch (data keeps stale value). */
  error: string | null
  /** Trigger an immediate re-fetch (e.g. after a mutation). */
  refresh: () => Promise<void>
}

export function useApiQuery<T>(options: UseApiQueryOptions<T>): UseApiQueryResult<T> {
  const { url, intervalMs = 0, initialData = null } = options
  const pauseWhenHidden = options.pauseWhenHidden ?? intervalMs > 0

  const [data, setData] = useState<T | null>(initialData)
  const [loading, setLoading] = useState<boolean>(url !== null)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState<boolean>(true)

  // Latest callbacks without making the fetch effect unstable
  const transformRef = useRef(options.transform)
  const onJsonRef = useRef(options.onJson)
  useEffect(() => {
    transformRef.current = options.transform
    onJsonRef.current = options.onJson
  })

  const abortRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)
  const mountedRef = useRef(true)

  // ---- Tab visibility tracking (state, not one-shot handlers, so effects
  // re-run and intervals genuinely restart when the tab becomes visible) ----
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onChange = () => setVisible(!document.hidden)
    setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (url === null) return
    const seq = ++seqRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (seq !== seqRef.current) return // superseded by a newer fetch
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        return
      }
      const json: unknown = await res.json()
      if (seq !== seqRef.current) return
      try {
        onJsonRef.current?.(json)
      } catch {
        // side-effect hooks must never break the data pipeline
      }
      const transformed = transformRef.current ? transformRef.current(json) : (json as T)
      if (seq !== seqRef.current) return
      // undefined → malformed payload: keep stale data (containment contract)
      if (transformed !== undefined) setData(transformed)
      setError(null)
    } catch (err) {
      if (seq !== seqRef.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'network error')
      // keep stale data on failure — same contract as the hand-rolled polls
    } finally {
      if (mountedRef.current && seq === seqRef.current) setLoading(false)
    }
  }, [url])

  // ---- Initial fetch + re-fetch whenever the url changes ----
  useEffect(() => {
    if (url === null) return
    void refresh()
  }, [refresh]) // refresh identity changes only when url changes

  // ---- Re-arm loading on url change so filter switches show a spinner ----
  useEffect(() => {
    if (url !== null) setLoading(true)
  }, [url])

  // ---- Polling ----
  const polling = intervalMs > 0 && url !== null && (!pauseWhenHidden || visible)
  useEffect(() => {
    if (!polling) return
    const id = setInterval(() => {
      void refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [polling, intervalMs, refresh])

  // ---- Immediate refresh when the tab becomes visible again ----
  const prevVisibleRef = useRef<boolean>(true)
  useEffect(() => {
    const wasVisible = prevVisibleRef.current
    prevVisibleRef.current = visible
    if (visible && !wasVisible && pauseWhenHidden) void refresh()
  }, [visible, pauseWhenHidden, refresh])

  // ---- Abort in-flight request on unmount ----
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  return { data, loading, error, refresh }
}

/**
 * Safely unwrap the conventional `{ success, data }` API envelope.
 * Returns `fallback` for any malformed shape (null, non-object, missing or
 * null data) — the containment layer that prevented the StrategyMonitor /
 * RiskManagement crash class.
 */
export function extractApiData<T>(json: unknown, fallback: T): T {
  if (typeof json === 'object' && json !== null && 'data' in json) {
    const payload = (json as { data: unknown }).data
    if (payload !== null && payload !== undefined) {
      return payload as T
    }
  }
  return fallback
}
