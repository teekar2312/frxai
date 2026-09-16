'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

// ============================================================
// Shared compact primitives (FINEX AI Trading)
// ============================================================

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  icon,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'up' | 'down' | 'warn' | 'muted'
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border bg-card p-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon ? <span className="text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span> : null}
      </div>
      <div
        className={cn(
          'num mt-1 text-lg font-semibold leading-tight',
          tone === 'up' && 'text-emerald-500',
          tone === 'down' && 'text-red-500',
          tone === 'warn' && 'text-amber-500',
          tone === 'muted' && 'text-muted-foreground'
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
      {right}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-8 text-center">
      {icon ? <div className="text-muted-foreground/50 [&>svg]:h-7 [&>svg]:w-7">{icon}</div> : null}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground/70">{hint}</p> : null}
    </div>
  )
}

// ============================================================
// Badges
// ============================================================

export function SideBadge({ side }: { side: 'BUY' | 'SELL' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide',
        side === 'BUY' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'
      )}
    >
      {side}
    </span>
  )
}

export function SignalBadge({ signal }: { signal: string }) {
  const map: Record<string, string> = {
    STRONG_BUY: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    BUY: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    NEUTRAL: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
    SELL: 'bg-red-500/10 text-red-600 border-red-500/20',
    STRONG_SELL: 'bg-red-500/15 text-red-500 border-red-500/30',
  }
  const label: Record<string, string> = {
    STRONG_BUY: 'STRONG BUY',
    BUY: 'BUY',
    NEUTRAL: 'NEUTRAL',
    SELL: 'SELL',
    STRONG_SELL: 'STRONG SELL',
  }
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide', map[signal] ?? map.NEUTRAL)}>
      {label[signal] ?? signal}
    </span>
  )
}

export function ImpactBadge({ impact }: { impact: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const map = {
    HIGH: 'bg-red-500/15 text-red-500',
    MEDIUM: 'bg-amber-500/15 text-amber-500',
    LOW: 'bg-zinc-500/10 text-zinc-400',
  }
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', map[impact])}>
      {impact}
    </span>
  )
}

export function LevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    ERROR: 'bg-red-500/15 text-red-500',
    WARN: 'bg-amber-500/15 text-amber-500',
    INFO: 'bg-emerald-500/10 text-emerald-500',
    DEBUG: 'bg-zinc-500/10 text-zinc-400',
  }
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', map[level] ?? map.DEBUG)}>
      {level}
    </span>
  )
}

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    AI: 'bg-violet-500/15 text-violet-400',
    MANUAL: 'bg-zinc-500/10 text-zinc-400',
    ANALYSIS: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    FINNHUB: 'bg-emerald-500/10 text-emerald-500',
    MARKETAUX: 'bg-amber-500/10 text-amber-500',
    WEB: 'bg-teal-500/10 text-teal-500',
    SIM: 'bg-zinc-500/10 text-zinc-500',
  }
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide', map[source] ?? map.SIM)}>
      {source}
    </span>
  )
}

export function LiveDot({ ok, className }: { ok: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'live-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        ok ? 'bg-emerald-500' : 'bg-red-500',
        className
      )}
    />
  )
}

// ============================================================
// Sparkline (tiny SVG)
// ============================================================

export function Sparkline({
  data,
  width = 96,
  height = 28,
  positive,
  className,
}: {
  data: number[]
  width?: number
  height?: number
  positive?: boolean
  className?: string
}) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={cn('rounded bg-muted/40', className)} />
  }
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const step = width / (data.length - 1)
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`)
  const up = positive ?? data[data.length - 1] >= data[0]
  const stroke = up ? 'var(--color-chart-2, #10b981)' : '#ef4444'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <polyline
        points={`0,${height} ${pts.join(' ')} ${width},${height}`}
        fill={up ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)'}
        stroke="none"
      />
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
