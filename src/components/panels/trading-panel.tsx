'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  Pencil,
  X,
  XCircle,
  History,
  Wallet,
  BarChart3,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import CandleChart, { type ChartOverlay } from '@/components/shared/candle-chart'
import { SectionTitle, EmptyState, SideBadge, SourceBadge } from '@/components/shared/primitives'
import { usePolling, apiPost, fmtMoney, fmtPrice, fmtPct, fmtDateTime } from '@/hooks/use-polling'
import { useAppStore } from '@/lib/store'
import { PAIRS, PAIR_IDS, RISK_LIMITS, BROKER_PROFILE, getPairConfig } from '@/lib/constants'
import type { Candle, ClosedTrade, EnginePollResponse, Pair, PositionView, SettingsData, Side, Timeframe } from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// TRADING PANEL — chart + order ticket + positions + history
// ============================================================

const CHART_TFS: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']

// ------------------------------------------------------------
// Inline indicator helpers (client-side, from candles)
// ------------------------------------------------------------

function calcEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  const k = 2 / (period + 1)
  let ema: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null)
      continue
    }
    if (ema === null) {
      let sum = 0
      for (let j = 0; j < period; j++) sum += values[j]
      ema = sum / period
    } else {
      ema = values[i] * k + ema * (1 - k)
    }
    out.push(ema)
  }
  return out
}

function calcBB(values: number[], period = 20, mult = 2) {
  const upper: (number | null)[] = []
  const mid: (number | null)[] = []
  const lower: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      upper.push(null)
      mid.push(null)
      lower.push(null)
      continue
    }
    const win = values.slice(i - period + 1, i + 1)
    const m = win.reduce((a, b) => a + b, 0) / period
    const variance = win.reduce((a, b) => a + (b - m) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    mid.push(m)
    upper.push(m + mult * sd)
    lower.push(m - mult * sd)
  }
  return { upper, mid, lower }
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  if (sec < 60) return `${Math.floor(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`
}

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

export default function TradingPanel() {
  // store / derived pair
  const selectedPair = useAppStore((s) => s.selectedPair)
  const setSelectedPair = useAppStore((s) => s.setSelectedPair)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const pair = (PAIR_IDS.includes(selectedPair as Pair) ? selectedPair : 'EURUSD') as Pair
  const cfg = getPairConfig(pair)

  // local UI state
  const [tf, setTf] = useState<Timeframe>('M15')
  const [ovl, setOvl] = useState<string[]>(['ema9', 'ema21'])

  // polls
  const { data: candles, loading: candlesLoading } = usePolling<Candle[]>(
    `/api/market/history?pair=${pair}&tf=${tf}&limit=120`,
    3000
  )
  const { data: engine, refresh: refreshEngine } = usePolling<EnginePollResponse>('/api/engine', 2000)
  const { data: positions, refresh: refreshPositions } = usePolling<PositionView[]>('/api/positions', 2000)
  const { data: history, refresh: refreshHistory } = usePolling<ClosedTrade[]>('/api/positions/history?limit=30', 10000)
  const { data: settings } = usePolling<SettingsData>('/api/settings', 30000)

  const tick = engine?.prices.find((p) => p.pair === pair)
  const account = engine?.account

  // ---- order ticket state ----
  const [side, setSide] = useState<Side>('BUY')
  const [volume, setVolume] = useState('0.10')
  const [riskLot, setRiskLot] = useState(false)
  const [slPipsStr, setSlPipsStr] = useState(String(RISK_LIMITS.stopLossPips.default))
  const [ratioStr, setRatioStr] = useState(String(RISK_LIMITS.takeProfitRatio.default))
  const [trailing, setTrailing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // seed SL/ratio from engine settings (once, first arrival)
  const seededRef = useRef(false)
  useEffect(() => {
    if (settings && !seededRef.current) {
      seededRef.current = true
      setSlPipsStr(String(settings.stopLossPips))
      setRatioStr(String(settings.takeProfitRatio))
    }
  }, [settings])

  const slPips = clampNum(Math.round(parseFloat(slPipsStr) || RISK_LIMITS.stopLossPips.default), RISK_LIMITS.stopLossPips.min, RISK_LIMITS.stopLossPips.max)
  const ratio = clampNum(parseFloat(ratioStr) || RISK_LIMITS.takeProfitRatio.default, RISK_LIMITS.takeProfitRatio.min, RISK_LIMITS.takeProfitRatio.max)
  const tpPips = Math.max(1, Math.round(slPips * ratio))
  const riskPct = settings?.riskPerTrade ?? RISK_LIMITS.riskPerTrade.default

  // risk-based lot preview: equity × risk% / (SL pips × pipValue)
  const previewLot = useMemo(() => {
    const equity = account?.equity ?? 0
    const lot = (equity * riskPct) / 100 / (slPips * cfg.pipValuePerLot)
    return Math.floor(clampNum(lot, RISK_LIMITS.volume.min, RISK_LIMITS.volume.max) * 100) / 100
  }, [account?.equity, riskPct, slPips, cfg])

  const manualLot = clampNum(parseFloat(volume) || 0, RISK_LIMITS.volume.min, RISK_LIMITS.volume.max)
  const activeLot = riskLot ? previewLot : manualLot

  // ---- chart overlays ----
  const closes = useMemo(() => (candles ?? []).map((c) => c.close), [candles])
  const overlays = useMemo<ChartOverlay[]>(() => {
    const list: ChartOverlay[] = []
    if (ovl.includes('ema9') && closes.length >= 10) {
      list.push({ label: 'EMA 9', color: '#f59e0b', values: calcEma(closes, 9) })
    }
    if (ovl.includes('ema21') && closes.length >= 22) {
      list.push({ label: 'EMA 21', color: '#a78bfa', values: calcEma(closes, 21) })
    }
    if (ovl.includes('bb') && closes.length >= 21) {
      const bb = calcBB(closes, 20, 2)
      list.push({ label: 'BB Upper', color: '#a1a1aa', values: bb.upper })
      list.push({ label: 'BB Lower', color: '#a1a1aa', values: bb.lower })
      list.push({ label: 'BB Mid', color: '#71717a', values: bb.mid, dash: true })
    }
    return list
  }, [closes, ovl])

  // responsive chart height
  const [chartH, setChartH] = useState(360)
  useEffect(() => {
    const update = () => setChartH(window.innerWidth < 640 ? 280 : 360)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // ---- mutations ----
  const afterMutation = () => {
    refreshPositions()
    refreshHistory()
    refreshEngine()
    bumpRefresh()
  }

  const submitOrder = async () => {
    if (submitting) return
    if (!riskLot && !Number.isFinite(parseFloat(volume))) {
      toast.error('Volume tidak valid')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiPost<PositionView | { success: true }>('/api/orders', {
        action: 'open',
        pair,
        side,
        ...(riskLot ? { riskBased: true } : { volume: Math.round(manualLot * 100) / 100 }),
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        trailing,
      })
      // server ignores `trailing` on open → apply it via modify so the switch is effective
      if (trailing && res && typeof res === 'object' && 'id' in res) {
        await apiPost('/api/orders', { action: 'modify', positionId: res.id, trailing: true }).catch(() => undefined)
      }
      toast.success(`${side} ${pair} ${activeLot.toFixed(2)} lot`, {
        description: `SL ${slPips} pips · TP ${tpPips} pips · RR 1 : ${ratio.toFixed(1)}`,
      })
      afterMutation()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Order gagal')
    } finally {
      setSubmitting(false)
    }
  }

  const [busyId, setBusyId] = useState<string | null>(null)
  const closePosition = async (p: PositionView) => {
    if (busyId) return
    setBusyId(p.id)
    try {
      await apiPost('/api/orders', { action: 'close', positionId: p.id })
      toast.success(`Posisi ${p.pair} ${p.side} ditutup`)
      afterMutation()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menutup posisi')
    } finally {
      setBusyId(null)
    }
  }

  const closeAll = async () => {
    try {
      const res = await apiPost<{ success: boolean; closed: number }>('/api/orders', { action: 'closeAll' })
      toast.success(`${res.closed} posisi ditutup`)
      afterMutation()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menutup semua posisi')
    }
  }

  // modify dialog
  const [modifyPos, setModifyPos] = useState<PositionView | null>(null)

  // history summary (from visible rows)
  const histStats = useMemo(() => {
    const rows = history ?? []
    const total = rows.reduce((a, t) => a + t.profit, 0)
    const wins = rows.filter((t) => t.profit > 0).length
    return {
      total,
      count: rows.length,
      winRate: rows.length ? (wins / rows.length) * 100 : 0,
    }
  }, [history])

  const lastCandle = candles && candles.length > 0 ? candles[candles.length - 1] : null
  const changePct = tick?.changePct ?? (lastCandle ? ((lastCandle.close - candles![0].close) / candles![0].close) * 100 : 0)
  const nowMs = Date.now()

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* ===== Chart controls ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={pair}
          onValueChange={(v) => {
            if (v) setSelectedPair(v)
          }}
          variant="outline"
          size="sm"
          className="flex-wrap"
          aria-label="Pilih pair"
        >
          {PAIRS.map((p) => (
            <ToggleGroupItem
              key={p.id}
              value={p.id}
              className="px-2.5 font-mono text-[11px] font-semibold data-[state=on]:border-emerald-500/50 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400"
            >
              {p.id}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={tf}
          onValueChange={(v) => {
            if (v) setTf(v as Timeframe)
          }}
          variant="outline"
          size="sm"
          aria-label="Pilih timeframe"
        >
          {CHART_TFS.map((t) => (
            <ToggleGroupItem key={t} value={t} className="px-2 text-[11px] font-semibold">
              {t}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="multiple"
          value={ovl}
          onValueChange={setOvl}
          variant="outline"
          size="sm"
          aria-label="Overlay indikator"
        >
          <ToggleGroupItem value="ema9" className="gap-1.5 px-2 text-[11px] font-semibold" aria-label="Toggle EMA 9">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            EMA 9
          </ToggleGroupItem>
          <ToggleGroupItem value="ema21" className="gap-1.5 px-2 text-[11px] font-semibold" aria-label="Toggle EMA 21">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" aria-hidden />
            EMA 21
          </ToggleGroupItem>
          <ToggleGroupItem value="bb" className="gap-1.5 px-2 text-[11px] font-semibold" aria-label="Toggle Bollinger Bands">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" aria-hidden />
            BB
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* ===== Chart ===== */}
        <Card className="p-3 xl:col-span-2">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold">{cfg.name}</span>
              {lastCandle ? (
                <span
                  className={cn(
                    'num text-lg font-semibold tabular-nums',
                    changePct >= 0 ? 'text-emerald-500' : 'text-red-500'
                  )}
                >
                  {fmtPrice(lastCandle.close, cfg.digits)}
                </span>
              ) : (
                <Skeleton className="h-6 w-20" />
              )}
              <span
                className={cn(
                  'num rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                  changePct >= 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'
                )}
              >
                {fmtPct(changePct)}
              </span>
            </div>
            <div className="num flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
              <span>BID {fmtPrice(tick?.bid, cfg.digits)}</span>
              <span>ASK {fmtPrice(tick?.ask, cfg.digits)}</span>
              <span>SPR {(tick?.spread ?? 0).toFixed(1)}p</span>
              <span>H {fmtPrice(tick?.dayHigh, cfg.digits)}</span>
              <span>L {fmtPrice(tick?.dayLow, cfg.digits)}</span>
            </div>
          </div>
          {candlesLoading && !candles ? (
            <Skeleton className="w-full" style={{ height: chartH }} />
          ) : (
            <CandleChart candles={candles ?? []} digits={cfg.digits} height={chartH} overlays={overlays} />
          )}
        </Card>

        {/* ===== Order ticket ===== */}
        <Card className="h-fit p-3">
          <SectionTitle right={<span className="num text-[10px] text-muted-foreground">Equity {fmtMoney(account?.equity)}</span>}>
            Order Ticket
          </SectionTitle>

          {/* side buttons with live prices */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSide('BUY')}
              aria-pressed={side === 'BUY'}
              className={cn(
                'rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                side === 'BUY'
                  ? 'border-emerald-500 bg-emerald-500/15'
                  : 'border-border hover:border-emerald-500/50 hover:bg-emerald-500/5'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-500">BUY</span>
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">ask</span>
              </div>
              <div className="num mt-0.5 text-base font-semibold tabular-nums">{fmtPrice(tick?.ask, cfg.digits)}</div>
            </button>
            <button
              type="button"
              onClick={() => setSide('SELL')}
              aria-pressed={side === 'SELL'}
              className={cn(
                'rounded-md border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50',
                side === 'SELL'
                  ? 'border-red-500 bg-red-500/15'
                  : 'border-border hover:border-red-500/50 hover:bg-red-500/5'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-red-500">SELL</span>
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">bid</span>
              </div>
              <div className="num mt-0.5 text-base font-semibold tabular-nums">{fmtPrice(tick?.bid, cfg.digits)}</div>
            </button>
          </div>

          <div className="mt-3 space-y-2.5">
            {/* volume / risk toggle */}
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ticket-volume" className="text-xs">
                Volume (lot)
              </Label>
              <div className="flex items-center gap-1.5">
                <Switch
                  id="risk-lot-switch"
                  checked={riskLot}
                  onCheckedChange={setRiskLot}
                  aria-label="Hitung lot dari risk"
                />
                <Label htmlFor="risk-lot-switch" className="cursor-pointer text-[11px] text-muted-foreground">
                  Hitung lot dari risk
                </Label>
              </div>
            </div>

            {riskLot ? (
              <div className="space-y-1 rounded-md border bg-muted/30 p-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Risk / trade</span>
                  <span className="num font-semibold tabular-nums">{riskPct.toFixed(2)}%</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">SL × pip value</span>
                  <span className="num tabular-nums">
                    {slPips} × ${cfg.pipValuePerLot}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-1 text-xs font-semibold">
                  <span>Lot dihitung</span>
                  <span className="num text-emerald-500 tabular-nums">≈ {previewLot.toFixed(2)} lot</span>
                </div>
                <p className="text-[9px] leading-tight text-muted-foreground">
                  Lot = equity × risk% ÷ (SL pips × pip value), dikirim sebagai risk-based order ke engine.
                </p>
              </div>
            ) : (
              <Input
                id="ticket-volume"
                type="number"
                inputMode="decimal"
                step={0.01}
                min={RISK_LIMITS.volume.min}
                max={RISK_LIMITS.volume.max}
                value={volume}
                onChange={(e) => setVolume(e.target.value)}
                className="num h-8 text-xs tabular-nums"
                aria-label="Volume dalam lot"
              />
            )}

            {/* SL / RR */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ticket-sl" className="text-[11px] text-muted-foreground">
                  SL (pips)
                </Label>
                <Input
                  id="ticket-sl"
                  type="number"
                  inputMode="numeric"
                  step={RISK_LIMITS.stopLossPips.step}
                  min={RISK_LIMITS.stopLossPips.min}
                  max={RISK_LIMITS.stopLossPips.max}
                  value={slPipsStr}
                  onChange={(e) => setSlPipsStr(e.target.value)}
                  className="num h-8 text-xs tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ticket-rr" className="text-[11px] text-muted-foreground">
                  RR ratio
                </Label>
                <Input
                  id="ticket-rr"
                  type="number"
                  inputMode="decimal"
                  step={RISK_LIMITS.takeProfitRatio.step}
                  min={RISK_LIMITS.takeProfitRatio.min}
                  max={RISK_LIMITS.takeProfitRatio.max}
                  value={ratioStr}
                  onChange={(e) => setRatioStr(e.target.value)}
                  className="num h-8 text-xs tabular-nums"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
              <span className="text-muted-foreground">TP otomatis</span>
              <div className="flex items-center gap-2">
                <span className="num font-semibold tabular-nums">{tpPips} pips</span>
                <Badge variant="outline" className="border-emerald-500/40 px-1.5 text-[10px] font-bold text-emerald-500">
                  1 : {ratio.toFixed(1)}
                </Badge>
              </div>
            </div>

            {/* trailing */}
            <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
              <div>
                <Label htmlFor="ticket-trailing" className="text-xs">
                  Trailing stop
                </Label>
                <p className="text-[9px] text-muted-foreground">SL mengikuti harga saat posisi profit</p>
              </div>
              <Switch id="ticket-trailing" checked={trailing} onCheckedChange={setTrailing} aria-label="Trailing stop" />
            </div>

            <Button
              onClick={submitOrder}
              disabled={submitting}
              className={cn(
                'h-10 w-full gap-2 text-sm font-bold text-white shadow-none',
                side === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-600/90' : 'bg-red-600 hover:bg-red-600/90'
              )}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {side} {pair} · {activeLot.toFixed(2)} lot
            </Button>
            <p className="text-center text-[9px] leading-tight text-muted-foreground">
              Entry {side === 'BUY' ? 'di harga ASK' : 'di harga BID'} · komisi $1/lot/sisi · spread {cfg.spreadMin}–{cfg.spreadMax} pip
            </p>
          </div>
        </Card>
      </div>

      {/* ===== Open positions ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <div className="flex items-center gap-2">
              <span className="num text-[10px] text-muted-foreground">{positions?.length ?? 0} posisi</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-red-500/30 px-2 text-[11px] text-red-500 hover:bg-red-500/10 hover:text-red-500"
                    disabled={!positions || positions.length === 0}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Tutup Semua
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-sm">Tutup semua posisi?</AlertDialogTitle>
                    <AlertDialogDescription className="text-xs">
                      {positions?.length ?? 0} posisi terbuka akan ditutup di harga pasar saat ini dan floating P/L akan
                      direalisasikan.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="h-8 text-xs">Batal</AlertDialogCancel>
                    <AlertDialogAction className="h-8 bg-red-600 text-xs hover:bg-red-600/90" onClick={closeAll}>
                      Ya, tutup semua
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          }
        >
          Posisi Terbuka
        </SectionTitle>

        {!positions ? (
          <div className="space-y-1.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <EmptyState title="Tidak ada posisi terbuka" hint="Gunakan order ticket di atas untuk membuka posisi baru." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-7 px-2 text-[10px]">Ticket</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Pair</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Side</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Vol</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Open → Now</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">SL / TP</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Pips</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Profit</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Durasi</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Sumber</TableHead>
                  <TableHead className="h-7 px-2 text-center text-[10px]">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => {
                  const d = getPairConfig(p.pair).digits
                  const dur = (nowMs - new Date(p.openedAt).getTime()) / 1000
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="num px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">
                        #{p.ticket.slice(-6)}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-xs font-semibold">{p.pair}</TableCell>
                      <TableCell className="px-2 py-1.5">
                        <SideBadge side={p.side} />
                      </TableCell>
                      <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums">{p.volume.toFixed(2)}</TableCell>
                      <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums">
                        {fmtPrice(p.openPrice, d)} → {fmtPrice(p.currentPrice, d)}
                      </TableCell>
                      <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                        <span className={cn(p.trailing && p.stopLoss !== null && 'text-amber-500')}>
                          {p.stopLoss !== null ? fmtPrice(p.stopLoss, d) : '—'}
                          {p.trailing ? ' ↗' : ''}
                        </span>
                        {' / '}
                        {p.takeProfit !== null ? fmtPrice(p.takeProfit, d) : '—'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'num px-2 py-1.5 text-right text-xs tabular-nums',
                          p.pips > 0 ? 'text-emerald-500' : p.pips < 0 ? 'text-red-500' : ''
                        )}
                      >
                        {p.pips >= 0 ? '+' : ''}
                        {p.pips.toFixed(1)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'num px-2 py-1.5 text-right text-xs font-semibold tabular-nums',
                          p.profit > 0 ? 'text-emerald-500' : p.profit < 0 ? 'text-red-500' : ''
                        )}
                      >
                        {fmtMoney(p.profit)}
                      </TableCell>
                      <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                        {fmtDuration(dur)}
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">
                              <SourceBadge source={p.source} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-56 break-all text-[10px]">
                            {p.comment ?? p.source}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:bg-muted"
                            aria-label={`Modify posisi ${p.pair}`}
                            onClick={() => setModifyPos(p)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                            disabled={busyId === p.id}
                            aria-label={`Tutup posisi ${p.pair} ${p.side}`}
                            onClick={() => closePosition(p)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
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

      {/* ===== Trade history ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <div className="num flex items-center gap-3 text-[10px] tabular-nums">
              <span className="text-muted-foreground">{histStats.count} trade</span>
              <span className="text-muted-foreground">WR</span>
              <span className={cn('font-semibold', histStats.winRate >= 50 ? 'text-emerald-500' : 'text-red-500')}>
                {histStats.count ? `${histStats.winRate.toFixed(0)}%` : '—'}
              </span>
              <span className="text-muted-foreground">Total</span>
              <span
                className={cn(
                  'font-semibold',
                  histStats.total > 0 ? 'text-emerald-500' : histStats.total < 0 ? 'text-red-500' : ''
                )}
              >
                {fmtMoney(histStats.total)}
              </span>
            </div>
          }
        >
          <span className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            Riwayat Trade
          </span>
        </SectionTitle>

        {!history ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-7 rounded-md" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState title="Belum ada riwayat trade" hint="Trade yang ditutup (SL/TP/manual) akan muncul di sini." />
        ) : (
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-7 px-2 text-[10px]">Ticket</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Pair</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Side</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Vol</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Pips</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Profit</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Alasan</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Sumber</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Durasi</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Ditutup</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="num px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">
                      #{t.ticket.slice(-6)}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-xs font-semibold">{t.pair}</TableCell>
                    <TableCell className="px-2 py-1.5">
                      <SideBadge side={t.side} />
                    </TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums">{t.volume.toFixed(2)}</TableCell>
                    <TableCell
                      className={cn(
                        'num px-2 py-1.5 text-right text-xs tabular-nums',
                        t.pips > 0 ? 'text-emerald-500' : t.pips < 0 ? 'text-red-500' : ''
                      )}
                    >
                      {t.pips >= 0 ? '+' : ''}
                      {t.pips.toFixed(1)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'num px-2 py-1.5 text-right text-xs font-semibold tabular-nums',
                        t.profit > 0 ? 'text-emerald-500' : t.profit < 0 ? 'text-red-500' : ''
                      )}
                    >
                      {fmtMoney(t.profit)}
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <ClosedReasonBadge reason={t.reason} />
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <SourceBadge source={t.source} />
                    </TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                      {fmtDuration(t.durationSec)}
                    </TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                      {fmtDateTime(t.closedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* ===== Broker profile note ===== */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 font-medium">
          <Wallet className="h-3 w-3" />
          {BROKER_PROFILE.name}
        </span>
        <span>Leverage {BROKER_PROFILE.leverageForex}</span>
        <span>Spread {BROKER_PROFILE.spread}</span>
        <span>Komisi {BROKER_PROFILE.commission}</span>
        <span>Lot {BROKER_PROFILE.minVolume}–{BROKER_PROFILE.maxVolumePerOrder}/order</span>
        <span>MC/SO {BROKER_PROFILE.marginCall}%/{BROKER_PROFILE.stopOut}%</span>
        <span className="hidden items-center gap-1 sm:flex">
          <BarChart3 className="h-3 w-3" />
          Chart custom SVG — candle di-refresh tiap 3 detik
        </span>
      </p>

      {/* ===== Modify dialog ===== */}
      <ModifyPositionDialog position={modifyPos} onClose={() => setModifyPos(null)} onDone={afterMutation} />
    </div>
  )
}

// ------------------------------------------------------------
// Modify position dialog
// ------------------------------------------------------------

function ModifyPositionDialog({
  position,
  onClose,
  onDone,
}: {
  position: PositionView | null
  onClose: () => void
  onDone: () => void
}) {
  const digits = position ? getPairConfig(position.pair).digits : 5
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [trailing, setTrailing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (position) {
      setSl(position.stopLoss !== null ? position.stopLoss.toFixed(digits) : '')
      setTp(position.takeProfit !== null ? position.takeProfit.toFixed(digits) : '')
      setTrailing(position.trailing)
    }
  }, [position, digits])

  const save = async () => {
    if (!position || saving) return
    const slNum = sl.trim() === '' ? null : Number(sl)
    const tpNum = tp.trim() === '' ? null : Number(tp)
    if (slNum !== null && (!Number.isFinite(slNum) || slNum <= 0)) {
      toast.error('Stop Loss harus berupa angka > 0')
      return
    }
    if (tpNum !== null && (!Number.isFinite(tpNum) || tpNum <= 0)) {
      toast.error('Take Profit harus berupa angka > 0')
      return
    }
    setSaving(true)
    try {
      await apiPost('/api/orders', {
        action: 'modify',
        positionId: position.id,
        stopLoss: slNum,
        takeProfit: tpNum,
        trailing,
      })
      toast.success(`Posisi #${position.ticket} diupdate`)
      onDone()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Modify gagal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!position} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Modify #{position?.ticket}</DialogTitle>
          <DialogDescription className="num text-xs tabular-nums">
            {position ? `${position.pair} ${position.side} ${position.volume.toFixed(2)} lot · ${fmtPrice(position.openPrice, digits)} → ${fmtPrice(position.currentPrice, digits)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="mod-sl" className="text-xs">
                Stop Loss (harga)
              </Label>
              <Input
                id="mod-sl"
                inputMode="decimal"
                placeholder="—"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                className="num h-8 text-xs tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mod-tp" className="text-xs">
                Take Profit (harga)
              </Label>
              <Input
                id="mod-tp"
                inputMode="decimal"
                placeholder="—"
                value={tp}
                onChange={(e) => setTp(e.target.value)}
                className="num h-8 text-xs tabular-nums"
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
            <div>
              <Label htmlFor="mod-trailing" className="text-xs">
                Trailing stop
              </Label>
              <p className="text-[10px] text-muted-foreground">
                {position?.trailing ? 'Aktif' : 'Nonaktif'} · SL mengikuti harga saat profit
              </p>
            </div>
            <Switch id="mod-trailing" checked={trailing} onCheckedChange={setTrailing} aria-label="Trailing stop" />
          </div>
          <p className="text-[10px] leading-tight text-muted-foreground">
            Harga saat ini <span className="num">{fmtPrice(position?.currentPrice, digits)}</span>. Kosongkan SL/TP untuk
            menghapus level.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------
// Closed reason badge
// ------------------------------------------------------------

function ClosedReasonBadge({ reason }: { reason: string }) {
  const map: Record<string, string> = {
    TP: 'bg-emerald-500/15 text-emerald-500',
    SL: 'bg-red-500/15 text-red-500',
    MANUAL: 'bg-zinc-500/10 text-zinc-400',
    STOP_OUT: 'border border-red-500/40 bg-red-500/15 text-red-500',
  }
  const label: Record<string, string> = { TP: 'TP', SL: 'SL', MANUAL: 'MANUAL', STOP_OUT: 'STOP OUT' }
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide', map[reason] ?? map.MANUAL)}>
      {label[reason] ?? reason}
    </span>
  )
}
