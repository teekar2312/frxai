'use client'

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'

// Track recently notified event IDs to avoid duplicate toasts
const notifiedIds = new Set<string>()
const MAX_TRACKED = 200 // Prevent memory leak

/**
 * Hook that polls for new unresolved risk events and shows toast notifications.
 * Only shows each event once (tracked by ID).
 */
export function useLiveNotifications() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const checkEvents = useCallback(async () => {
    try {
      // Check unresolved HIGH/CRITICAL risk events
      const res = await fetch('/api/risk-events?resolved=false&limit=5')
      if (!res.ok) return
      const json = await res.json()
      const events = json.data?.events ?? json.events ?? []

      for (const event of events) {
        if (notifiedIds.has(event.id)) continue
        notifiedIds.add(event.id)

        // Prune old IDs to prevent memory leak
        if (notifiedIds.size > MAX_TRACKED) {
          const iter = notifiedIds.values()
          const first = iter.next().value
          const second = iter.next().value
          if (first) notifiedIds.delete(first)
          if (second) notifiedIds.delete(second)
        }

        if (event.severity === 'CRITICAL') {
          toast.error(event.message, {
            description: event.eventType,
            duration: 8000,
          })
        } else if (event.severity === 'HIGH') {
          toast.warning(event.message, {
            description: event.eventType,
            duration: 6000,
          })
        }
      }
    } catch {
      // Silent fail — notifications are non-critical
    }
  }, [])

  useEffect(() => {
    checkEvents()
    intervalRef.current = setInterval(checkEvents, 15000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [checkEvents])
}
