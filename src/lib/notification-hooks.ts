'use client'

import { useRef } from 'react'
import { toast } from 'sonner'
import { useApiQuery } from '@/hooks/use-api-query'

interface RiskEventItem {
  id: string
  severity: string
  message: string
  eventType: string
}

/**
 * Live risk-event toast notifications.
 *
 * Polls unresolved risk events every 15s through the centralised useApiQuery
 * hook (abort/stale-guard/visibility-pause handled generically). The toast
 * diffing lives in onJson: it runs outside render on every successful parse,
 * deduplicates against notifiedIdsRef, and prunes old ids to bound memory.
 */
export function useLiveNotifications() {
  const notifiedIdsRef = useRef<Set<string>>(new Set())

  useApiQuery<unknown>({
    url: '/api/risk-events?resolved=false&limit=5',
    intervalMs: 15_000,
    onJson: (json) => {
      const env = json as { data?: { events?: unknown }; events?: unknown } | null
      const events = env?.data?.events ?? env?.events ?? []
      if (!Array.isArray(events)) return

      for (const raw of events) {
        const event = raw as Partial<RiskEventItem>
        if (!event.id || notifiedIdsRef.current.has(event.id)) continue
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
          toast.error(event.message ?? 'Risk event', {
            description: event.eventType,
            duration: 8000,
          })
        } else if (event.severity === 'HIGH') {
          toast.warning(event.message ?? 'Risk event', {
            description: event.eventType,
            duration: 6000,
          })
        } else if (event.severity === 'MEDIUM') {
          toast.info(event.message ?? 'Risk event', {
            description: event.eventType,
            duration: 5000,
          })
        }
      }
    },
  })
}
