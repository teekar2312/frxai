'use client'

import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertTriangle, CheckCircle2, Database, XCircle } from 'lucide-react'
import type { ComponentCheck, HealthData } from './types'

// ============================================
// SMALL PRESENTATIONAL COMPONENTS
// ============================================

export function StatusBadge({ status }: { status: HealthData['status'] }) {
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

export function CheckRow({ label, icon: Icon, check }: { label: string; icon: typeof Database; check: ComponentCheck | null }) {
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

export function MemoryBar({ label, valueMb, limitMb, unit = 'MB' }: { label: string; valueMb: number; limitMb: number; unit?: string }) {
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

export function LayerBadge({ layer }: { layer: string }) {
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

export function NotifStatusBadge({ status }: { status: string }) {
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

export function SeverityBadge({ severity }: { severity: string }) {
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
