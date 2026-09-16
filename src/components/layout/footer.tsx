'use client'

import { AlertTriangle } from 'lucide-react'
import { LiveDot } from '@/components/shared/primitives'
import { usePolling, fmtTime } from '@/hooks/use-polling'
import type { EnginePollResponse } from '@/lib/types'
import { APP_VERSION, BROKER_PROFILE } from '@/lib/constants'

export function Footer() {
  const { data } = usePolling<EnginePollResponse>('/api/engine', 5000)
  const status = data?.status

  return (
    <footer className="mt-auto border-t bg-background">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium">
          <LiveDot ok={status?.connected ?? false} />
          {status?.mode === 'LIVE' ? 'LIVE' : 'DEMO'} · {status?.connected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="num">Tick {fmtTime(status?.lastTickAt)}</span>
        <span className="num">{status?.latencyMs ?? 0}ms</span>
        <span>v{APP_VERSION}</span>
        <span className="hidden sm:inline">{BROKER_PROFILE.name} · {BROKER_PROFILE.leverageForex} · SO {BROKER_PROFILE.stopOut}%</span>
        <span className="ml-auto hidden items-center gap-1 lg:flex">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          Trading forex berisiko tinggi — dana bisa hilang. Gunakan manajemen risiko.
        </span>
      </div>
    </footer>
  )
}
