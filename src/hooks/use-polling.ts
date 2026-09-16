'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Lightweight polling hook for API data.
 * Fetches immediately, then re-fetches every `intervalMs`.
 * Pass `null` as url to disable.
 */
export function usePolling<T>(url: string | null, intervalMs = 3000) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(!!url)
  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)

  const load = useCallback(
    async (silent = false) => {
      if (!url || busyRef.current) return
      busyRef.current = true
      if (!silent) setLoading(true)
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const json = (await res.json()) as T
        if (mountedRef.current) {
          setData(json)
          setError(null)
        }
      } catch (e) {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : 'Request failed')
        }
      } finally {
        busyRef.current = false
        if (mountedRef.current) setLoading(false)
      }
    },
    [url]
  )

  useEffect(() => {
    mountedRef.current = true
    if (!url) {
      setData(undefined)
      setLoading(false)
      setError(null)
      return
    }
    load()
    const loop = () => {
      timerRef.current = setTimeout(async () => {
        await load(true)
        if (mountedRef.current) loop()
      }, intervalMs)
    }
    loop()
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [url, intervalMs, load])

  return { data, error, loading, refresh: () => load(true) }
}

/** One-shot POST helper with toast-friendly error handling */
export async function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`)
  return json as T
}

/** One-shot PUT helper */
export async function apiPut<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`)
  return json as T
}

export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtPrice(v: number | null | undefined, digits = 5): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toFixed(digits)
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function fmtTime(iso: string | number | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso)
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
