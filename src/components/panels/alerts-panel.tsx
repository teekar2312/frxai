'use client'

import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  BellRing,
  History,
  Loader2,
  Plus,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { SectionTitle, EmptyState, LiveDot } from '@/components/shared/primitives'
import { usePolling, apiPost, fmtPrice, fmtDateTime } from '@/hooks/use-polling'
import { PAIRS, getPairConfig } from '@/lib/constants'
import type { AlertView, EnginePollResponse, Pair } from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// ALERTS PANEL — price alert manager (create / monitor / history)
// ============================================================

type AlertCondition = 'ABOVE' | 'BELOW'

/** Signed distance (pips) from current price to the alert target, from the trigger side. */
function distancePips(alert: AlertView, current: number, pipSize: number): number {
  return alert.condition === 'ABOVE' ? (current - alert.price) / pipSize : (alert.price - current) / pipSize
}

function ConditionBadge({ condition }: { condition: AlertCondition }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide',
        condition === 'ABOVE' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'
      )}
    >
      {condition === 'ABOVE' ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {condition === 'ABOVE' ? 'DI ATAS' : 'DI BAWAH'}
    </span>
  )
}

function StatusBadge({ status }: { status: AlertView['status'] }) {
  if (status === 'TRIGGERED') {
    return (
      <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-500">
        TRIGGERED
      </span>
    )
  }
  if (status === 'CANCELLED') {
    return (
      <span className="inline-flex items-center rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-zinc-400 line-through">
        CANCELLED
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded border border-zinc-500/40 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-zinc-400">
      ACTIVE
    </span>
  )
}

export default function AlertsPanel() {
  const { data: alerts, refresh: refreshAlerts } = usePolling<AlertView[]>('/api/alerts', 5000)
  const { data: engine } = usePolling<EnginePollResponse>('/api/engine', 2000)

  // ---- create form state ----
  const [pair, setPair] = useState<Pair>('EURUSD')
  const [condition, setCondition] = useState<AlertCondition>('ABOVE')
  const [priceStr, setPriceStr] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const cfg = getPairConfig(pair)
  const tick = engine?.prices.find((p) => p.pair === pair)
  const currentBid = tick?.bid

  // quick-fill target: current bid ± 10 pips
  const quickTargets = useMemo(() => {
    if (currentBid === undefined) return []
    return [
      { label: 'Bid', value: currentBid },
      { label: '+10p', value: currentBid + 10 * cfg.pipSize },
      { label: '−10p', value: currentBid - 10 * cfg.pipSize },
    ]
  }, [currentBid, cfg.pipSize])

  const submitAlert = async () => {
    if (submitting) return
    const price = Number(priceStr)
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Harga alert harus berupa angka > 0')
      return
    }
    setSubmitting(true)
    try {
      await apiPost<AlertView>('/api/alerts', {
        pair,
        condition,
        price,
        note: note.trim() || undefined,
      })
      toast.success(`Alert dibuat: ${pair} ${condition === 'ABOVE' ? 'di atas' : 'di bawah'} ${fmtPrice(price, cfg.digits)}`)
      setPriceStr('')
      setNote('')
      refreshAlerts()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat alert')
    } finally {
      setSubmitting(false)
    }
  }

  const cancelAlert = async (alert: AlertView) => {
    if (busyId) return
    setBusyId(alert.id)
    try {
      const res = await fetch(`/api/alerts/${alert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast.success(`Alert ${alert.pair} dibatalkan`)
      refreshAlerts()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membatalkan alert')
    } finally {
      setBusyId(null)
    }
  }

  const active = useMemo(() => (alerts ?? []).filter((a) => a.status === 'ACTIVE'), [alerts])
  const triggered = useMemo(() => (alerts ?? []).filter((a) => a.status === 'TRIGGERED'), [alerts])
  const cancelled = useMemo(() => (alerts ?? []).filter((a) => a.status === 'CANCELLED'), [alerts])

  const priceOf = (p: string): number | undefined => engine?.prices.find((t) => t.pair === p)?.bid

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* ===== Create alert ===== */}
        <Card className="h-fit p-3">
          <SectionTitle
            right={
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <LiveDot ok={engine?.status.connected ?? false} />
                Harga live
              </span>
            }
          >
            <span className="flex items-center gap-1.5">
              <BellPlus />
              Buat Alert Harga
            </span>
          </SectionTitle>

          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Pair</Label>
                <Select value={pair} onValueChange={(v) => v && setPair(v as Pair)}>
                  <SelectTrigger size="sm" className="w-full text-xs" aria-label="Pilih pair">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAIRS.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Kondisi</Label>
                <ToggleGroup
                  type="single"
                  value={condition}
                  onValueChange={(v) => {
                    if (v) setCondition(v as AlertCondition)
                  }}
                  variant="outline"
                  size="sm"
                  className="w-full"
                  aria-label="Kondisi alert"
                >
                  <ToggleGroupItem
                    value="ABOVE"
                    className="flex-1 gap-1 px-2 text-[11px] font-semibold data-[state=on]:border-emerald-500/50 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400"
                  >
                    <ArrowUp className="h-3 w-3" />
                    Di Atas
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="BELOW"
                    className="flex-1 gap-1 px-2 text-[11px] font-semibold data-[state=on]:border-red-500/50 data-[state=on]:bg-red-500/15 data-[state=on]:text-red-600 dark:data-[state=on]:text-red-400"
                  >
                    <ArrowDown className="h-3 w-3" />
                    Di Bawah
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="alert-price" className="text-[11px] text-muted-foreground">
                  Harga target
                </Label>
                <span className="num text-[10px] tabular-nums text-muted-foreground">
                  Bid: {fmtPrice(currentBid, cfg.digits)}
                </span>
              </div>
              <Input
                id="alert-price"
                type="number"
                inputMode="decimal"
                step={cfg.pipSize}
                min={0}
                placeholder={currentBid !== undefined ? fmtPrice(currentBid, cfg.digits) : '0.' + '0'.repeat(cfg.digits)}
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                className="num h-8 text-xs tabular-nums"
              />
              <div className="flex flex-wrap gap-1">
                {quickTargets.map((q) => (
                  <Button
                    key={q.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="num h-6 px-1.5 text-[10px] tabular-nums text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-600"
                    onClick={() => setPriceStr(q.value.toFixed(cfg.digits))}
                    disabled={currentBid === undefined}
                  >
                    {q.label} {fmtPrice(q.value, cfg.digits)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="alert-note" className="text-[11px] text-muted-foreground">
                Catatan <span className="text-muted-foreground/60">(opsional)</span>
              </Label>
              <Input
                id="alert-note"
                placeholder="mis. resistance H1, tunggu breakout"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-8 text-xs"
                maxLength={120}
              />
            </div>

            <Button
              onClick={submitAlert}
              disabled={submitting}
              className="h-9 w-full gap-1.5 bg-emerald-600 text-sm font-bold text-white shadow-none hover:bg-emerald-600/90"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Pasang Alert
            </Button>
            <p className="text-center text-[9px] leading-tight text-muted-foreground">
              Engine mengecek alert setiap tick — email dikirim saat terpicu (aktifkan di tab Settings).
            </p>
          </div>
        </Card>

        {/* ===== Active alerts ===== */}
        <Card className="p-3 xl:col-span-2">
          <SectionTitle
            right={
              <Badge variant="outline" className="num px-1.5 text-[10px] font-semibold tabular-nums">
                {active.length} aktif
              </Badge>
            }
          >
            <span className="flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5" />
              Alert Aktif
            </span>
          </SectionTitle>

          {!alerts ? (
            <div className="space-y-1.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-8 rounded-md" />
              ))}
            </div>
          ) : active.length === 0 ? (
            <EmptyState
              icon={<BellOff />}
              title="Tidak ada alert aktif"
              hint="Pasang alert harga untuk dipantau otomatis oleh engine — muncul di sini."
            />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-7 px-2 text-[10px]">Pair</TableHead>
                    <TableHead className="h-7 px-2 text-[10px]">Kondisi</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Target</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Harga Saat Ini</TableHead>
                    <TableHead className="h-7 px-2 text-[10px]">Catatan</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Dibuat</TableHead>
                    <TableHead className="h-7 px-2 text-center text-[10px]">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((a) => {
                    const d = getPairConfig(a.pair).digits
                    const cur = priceOf(a.pair)
                    const dist = cur !== undefined ? distancePips(a, cur, getPairConfig(a.pair).pipSize) : null
                    const onTriggerSide = dist !== null && dist >= 0
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="px-2 py-1.5 text-xs font-semibold">{a.pair}</TableCell>
                        <TableCell className="px-2 py-1.5">
                          <ConditionBadge condition={a.condition} />
                        </TableCell>
                        <TableCell className="num px-2 py-1.5 text-right text-xs font-semibold tabular-nums">
                          {fmtPrice(a.price, d)}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">
                          {cur !== undefined ? (
                            <div className="num leading-tight tabular-nums">
                              <div className="text-xs">{fmtPrice(cur, d)}</div>
                              <div
                                className={cn(
                                  'text-[9px] font-semibold',
                                  onTriggerSide ? 'text-emerald-500' : 'text-red-500'
                                )}
                              >
                                {onTriggerSide ? 'sudah ' : '−'}
                                {Math.abs(dist ?? 0).toFixed(1)}p {onTriggerSide ? (a.condition === 'ABOVE' ? 'di atas' : 'di bawah') : 'lagi'}
                              </div>
                            </div>
                          ) : (
                            <span className="num text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-40 truncate px-2 py-1.5 text-[11px] text-muted-foreground" title={a.note ?? undefined}>
                          {a.note ?? '—'}
                        </TableCell>
                        <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                          {fmtDateTime(a.createdAt)}
                        </TableCell>
                        <TableCell className="px-2 py-1.5">
                          <div className="flex justify-center">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                                  disabled={busyId === a.id}
                                  aria-label={`Batalkan alert ${a.pair}`}
                                >
                                  {busyId === a.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <XCircle className="h-3.5 w-3.5" />
                                  )}
                                  Batal
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-sm">Batalkan alert ini?</AlertDialogTitle>
                                  <AlertDialogDescription className="num text-xs tabular-nums">
                                    {a.pair} {a.condition === 'ABOVE' ? 'di atas' : 'di bawah'} {fmtPrice(a.price, d)}
                                    {a.note ? ` · "${a.note}"` : ''} — alert akan ditandai CANCELLED dan tidak dipantau lagi.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="h-8 text-xs">Tidak</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="h-8 bg-red-600 text-xs hover:bg-red-600/90"
                                    onClick={() => cancelAlert(a)}
                                  >
                                    Ya, batalkan
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      {/* ===== Triggered history ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <Badge variant="outline" className="num border-emerald-500/40 px-1.5 text-[10px] font-semibold text-emerald-500 tabular-nums">
              {triggered.length} terpicu
            </Badge>
          }
        >
          <span className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            Riwayat Alert Terpicu
          </span>
        </SectionTitle>

        {alerts && triggered.length === 0 ? (
          <EmptyState
            icon={<BellRing />}
            title="Belum ada alert terpicu"
            hint="Saat harga melewati target, alert berpindah ke riwayat ini dan notifikasi email dikirim (jika diaktifkan)."
          />
        ) : !alerts ? (
          <div className="space-y-1.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-7 rounded-md" />
            ))}
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-7 px-2 text-[10px]">Pair</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Kondisi</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Target</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Catatan</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Dibuat</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Terpicu</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triggered.map((a) => {
                  const d = getPairConfig(a.pair).digits
                  return (
                    <TableRow key={a.id} className="bg-emerald-500/[0.04]">
                      <TableCell className="px-2 py-1.5 text-xs font-semibold">{a.pair}</TableCell>
                      <TableCell className="px-2 py-1.5">
                        <ConditionBadge condition={a.condition} />
                      </TableCell>
                      <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums">
                        {fmtPrice(a.price, d)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate px-2 py-1.5 text-[11px] text-muted-foreground" title={a.note ?? undefined}>
                        {a.note ?? '—'}
                      </TableCell>
                      <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                        {fmtDateTime(a.createdAt)}
                      </TableCell>
                      <TableCell className="num px-2 py-1.5 text-right text-[10px] font-semibold tabular-nums text-emerald-500">
                        {fmtDateTime(a.triggeredAt)}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-right">
                        <StatusBadge status={a.status} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* cancelled alerts — compact muted footer list */}
        {cancelled.length > 0 ? (
          <div className="mt-3 border-t pt-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Dibatalkan
              </span>
              <Badge variant="outline" className="num px-1 text-[9px] font-semibold tabular-nums text-muted-foreground">
                {cancelled.length}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cancelled.map((a) => {
                const d = getPairConfig(a.pair).digits
                return (
                  <span
                    key={a.id}
                    className="num inline-flex items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground/70"
                  >
                    {a.pair} {a.condition === 'ABOVE' ? '↑' : '↓'} {fmtPrice(a.price, d)}
                    <span className="font-sans text-muted-foreground/50">{fmtDateTime(a.createdAt)}</span>
                  </span>
                )
              })}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  )
}

/** tiny wrapper so the icon inherits the muted title color */
function BellPlus() {
  return <BellRing className="h-3.5 w-3.5" />
}
