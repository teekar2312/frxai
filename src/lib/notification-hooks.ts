'use client'

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'

export function useLiveNotifications() {
  const notifiedIdsRef = useRef<Set<string>>(new Set())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const checkEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/risk-events?resolved=false&limit=5')
      if (!res.ok) return
      const json = await res.json()
      const events = json.data?.events ?? json.events ?? []

      for (const event of events) {
        if (notifiedIdsRef.current.has(event.id)) continue
        notifiedIdsRef.current.add(event.id)

        // Prune old IDs — batch of 50 to keep up with sustained streams
        if (notifiedIdsRef.current.size > 200) {
          const iter = notifiedIdsRef.current.values()
          for (let i = 0; i < 50; i++) {
            const val = iter.next().value
            if (val) notifiedIdsRef.current.delete(val)
          }
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
        } else if (event.severity === 'MEDIUM') {
          toast.info(event.message, {
            description: event.eventType,
            duration: 5000,
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

    const handleVisibility = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      } else {
        checkEvents()
        if (!intervalRef.current) {
          intervalRef.current = setInterval(checkEvents, 15000)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [checkEvents])
}
