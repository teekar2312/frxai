'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, FileClock, Loader2, Mail, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { SectionTitle, EmptyState, LevelBadge, LiveDot } from '@/components/shared/primitives'
import { usePolling, fmtTime } from '@/hooks/use-polling'
import type { LogEntryView } from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// LOGS PANEL — system log viewer with filters + search
// ============================================================

const LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'] as const
const CATEGORIES = ['ALL', 'TRADING', 'ENGINE', 'AI', 'RISK', 'NEWS', 'ALERT', 'SYSTEM', 'EMAIL', 'AUTH'] as const
const LIMITS = ['50', '100', '200', '500'] as const

const CATEGORY_CHIP: Record<string, string> = {
  TRADING: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  ENGINE: 'text-zinc-500 border-zinc-500/30',
  AI: 'text-violet-500 border-violet-500/30',
  RISK: 'text-red-500 border-red-500/30',
  NEWS: 'text-amber-600 dark:text-amber-400 border-amber-500/30',
  ALERT: 'text-teal-600 dark:text-teal-400 border-teal-500/30',
  SYSTEM: 'text-zinc-400 border-zinc-400/30',
  EMAIL: 'text-rose-500 border-rose-500/30',
  AUTH: 'text-sky-600 dark:text-sky-400 border-sky-500/30',
}

export default function LogsPanel() {
  // ---- filters (search input debounced 400ms) ----
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('ALL')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('ALL')
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>('100')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (level !== 'ALL') params.set('level', level)
    if (category !== 'ALL') params.set('category', category)
    if (q) params.set('q', q)
    params.set('limit', limit)
    return `/api/logs?${params.toString()}`
  }, [level, category, q, limit])

  const { data: logs, loading, error, refresh } = usePolling<LogEntryView[]>(url, 5000)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [clearing, setClearing] = useState(false)

  const counts = useMemo(() => {
    const c = { INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 }
    for (const l of logs ?? []) c[l.level]++
    return c
  }, [logs])

  const hasFilter = level !== 'ALL' || category !== 'ALL' || q !== ''

  const clearLogs = async () => {
    if (clearing) return
    setClearing(true)
    try {
      const res = await fetch('/api/logs', { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { deleted?: number; error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast.success(`${json.deleted ?? 0} log lama dihapus`, {
        description: '100 entri terbaru disimpan sebagai referensi.',
      })
      setExpanded({})
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menghapus logs')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* ===== Filter bar ===== */}
      <Card className="p-3">
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="space-y-1">
            <label htmlFor="log-level" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Level
            </label>
            <Select value={level} onValueChange={(v) => setLevel(v as (typeof LEVELS)[number])}>
              <SelectTrigger id="log-level" size="sm" className="w-full text-xs" aria-label="Filter level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l} className="text-xs">
                    {l === 'ALL' ? 'Semua level' : l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor="log-category" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Kategori
            </label>
            <Select value={category} onValueChange={(v) => setCategory(v as (typeof CATEGORIES)[number])}>
              <SelectTrigger id="log-category" size="sm" className="w-full text-xs" aria-label="Filter kategori">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c === 'ALL' ? 'Semua kategori' : c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor="log-search" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cari pesan
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="log-search"
                placeholder="kata kunci…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="log-limit" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Maks entri
            </label>
            <Select value={limit} onValueChange={(v) => setLimit(v as (typeof LIMITS)[number])}>
              <SelectTrigger id="log-limit" size="sm" className="w-full text-xs" aria-label="Jumlah entri maksimum">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMITS.map((l) => (
                  <SelectItem key={l} value={l} className="num text-xs tabular-nums">
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-red-500/30 text-[11px] text-red-500 hover:bg-red-500/10 hover:text-red-500"
                  disabled={clearing}
                >
                  {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Bersihkan
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm">Bersihkan log lama?</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs">
                    Semua entri di luar 100 terbaru akan dihapus permanen. Entry ERROR/RISK yang tersisa tetap bisa
                    diaudit.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-8 text-xs">Batal</AlertDialogCancel>
                  <AlertDialogAction className="h-8 bg-red-600 text-xs hover:bg-red-600/90" onClick={clearLogs}>
                    Ya, bersihkan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </Card>

      {/* ===== Log list ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <LiveDot ok={!error} />
                {error ? 'error' : '5s refresh'}
              </span>
              <Badge variant="outline" className="num gap-1 px-1.5 text-[9px] font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                INFO {counts.INFO}
              </Badge>
              <Badge variant="outline" className="num gap-1 px-1.5 text-[9px] font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                WARN {counts.WARN}
              </Badge>
              <Badge variant="outline" className="num gap-1 px-1.5 text-[9px] font-semibold text-red-600 tabular-nums dark:text-red-400">
                ERROR {counts.ERROR}
              </Badge>
              <Badge variant="outline" className="num gap-1 px-1.5 text-[9px] font-semibold text-zinc-400 tabular-nums">
                DBG {counts.DEBUG}
              </Badge>
            </div>
          }
        >
          <span className="flex items-center gap-1.5">
            <FileClock className="h-3.5 w-3.5" />
            Log Sistem
          </span>
        </SectionTitle>

        {loading && !logs ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 rounded-md" />
            ))}
          </div>
        ) : error && !logs ? (
          <EmptyState title="Log tidak dapat dimuat" hint={`${error} — cek koneksi lalu tunggu refresh berikutnya.`} />
        ) : !logs || logs.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title={hasFilter ? 'Tidak ada log yang cocok' : 'Belum ada log'}
            hint={hasFilter ? 'Coba longgarkan filter level/kategori atau kata kunci pencarian.' : 'Aktivitas engine (trading, AI, risk, email) akan tercatat di sini.'}
          />
        ) : (
          <div className="max-h-[calc(100vh-220px)] min-h-48 overflow-y-auto scrollbar-thin">
            <div className="divide-y divide-border/60">
              {logs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  open={!!expanded[log.id]}
                  onToggle={() => setExpanded((x) => ({ ...x, [log.id]: !x[log.id] }))}
                />
              ))}
            </div>
            <p className="px-2 py-1.5 text-center text-[9px] text-muted-foreground">
              {logs.length} entri terbaru{hasFilter ? ' (terfilter)' : ''} · max {limit}
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}

// ------------------------------------------------------------
// Single log row (expandable details)
// ------------------------------------------------------------

function LogRow({ log, open, onToggle }: { log: LogEntryView; open: boolean; onToggle: () => void }) {
  const isEmail = log.message.startsWith('[EMAIL-SIM]')
  const isAlertTrigger = log.category === 'ALERT' && log.message.includes('terpicu')
  const expandable = !!log.details
  const isError = log.level === 'ERROR'

  const head = (
    <>
      <span className="num w-16 shrink-0 pt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">
        {fmtTime(log.createdAt)}
      </span>
      <span className="shrink-0 pt-0.5">
        <LevelBadge level={log.level} />
      </span>
      <span
        className={cn(
          'hidden shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide sm:inline-block',
          CATEGORY_CHIP[log.category] ?? 'text-zinc-400 border-zinc-400/30'
        )}
      >
        {log.category}
      </span>
      <span className="min-w-0 flex-1 text-xs leading-snug break-all">
        {isEmail ? (
          <Mail className="mr-1 inline h-3 w-3 -translate-y-0.5 text-rose-500" aria-label="Email simulasi" />
        ) : isAlertTrigger ? (
          <span className="mr-1 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-emerald-500" aria-hidden />
        ) : null}
        {log.message}
      </span>
      {expandable ? (
        <ChevronDown
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
    </>
  )

  return (
    <div className={cn('rounded-sm px-2 py-1.5 transition-colors', isError && 'bg-red-500/[0.07]')}>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50"
        >
          {head}
        </button>
      ) : (
        <div className="flex items-start gap-2">{head}</div>
      )}
      {expandable && open ? (
        <pre className="mt-1 ml-[4.5rem] max-h-56 overflow-y-auto rounded border bg-muted/40 px-2 py-1.5 font-mono whitespace-pre-wrap break-all text-[10px] leading-relaxed text-muted-foreground scrollbar-thin">
          {log.details}
        </pre>
      ) : null}
    </div>
  )
}
