'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  FlaskConical,
  History,
  Loader2,
  Play,
  RotateCcw,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import EquityChart from '@/components/shared/equity-chart'
import { SectionTitle, EmptyState, SideBadge, StatCard } from '@/components/shared/primitives'
import { usePolling, apiPost, fmtMoney, fmtDateTime } from '@/hooks/use-polling'
import { useAppStore } from '@/lib/store'
import {
  INDICATORS,
  INDICATOR_CATEGORIES,
  PAIRS,
  PAIR_IDS,
  RISK_LIMITS,
  TIMEFRAMES,
  getPairConfig,
} from '@/lib/constants'
import type { BacktestDetail, BacktestSummary, BacktestTrade, Pair, SettingsData, Timeframe } from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// BACKTEST PANEL — strategy lab: config + results + history
// ============================================================

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function fmtTradeTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Exit reason chip: SL red / TP emerald / EOD zinc. */
function ReasonChip({ reason }: { reason: string }) {
  const map: Record<string, string> = {
    TP: 'bg-emerald-500/15 text-emerald-500',
    SL: 'bg-red-500/15 text-red-500',
    EOD: 'bg-zinc-500/10 text-zinc-400',
  }
  const label: Record<string, string> = { TP: 'TP', SL: 'SL', EOD: 'EOD' }
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide', map[reason] ?? map.EOD)}>
      {label[reason] ?? reason}
    </span>
  )
}

// ------------------------------------------------------------
// Indicator multi-select (checkbox grid grouped by category)
// ------------------------------------------------------------

function IndicatorPicker({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }
  const selectCategory = (category: string, ids: string[]) => {
    const allIn = ids.every((id) => selected.includes(id))
    onChange(allIn ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between px-2.5 text-xs font-normal"
        >
          <span className="truncate text-muted-foreground">
            Indikator
            <Badge className="ml-1.5 bg-emerald-500/15 px-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              {selected.length}
            </Badge>
          </span>
          <BarChart3 className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <div className="max-h-72 overflow-y-auto scrollbar-thin p-2">
          {INDICATOR_CATEGORIES.map((cat) => {
            const ids = INDICATORS.filter((i) => i.category === cat).map((i) => i.id)
            const count = ids.filter((id) => selected.includes(id)).length
            return (
              <div key={cat} className="mb-2 last:mb-0">
                <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat} <span className="num">({count}/{ids.length})</span>
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded px-1 text-[9px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                      onClick={() => selectCategory(cat, ids)}
                    >
                      {count === ids.length ? 'Kosongkan' : 'Semua'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 px-1 pt-1">
                  {INDICATORS.filter((i) => i.category === cat).map((i) => (
                    <label
                      key={i.id}
                      className="flex cursor-pointer select-none items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={selected.includes(i.id)}
                        onCheckedChange={() => toggle(i.id)}
                        className="h-3.5 w-3.5"
                        aria-label={`Indikator ${i.name}`}
                      />
                      <span className="truncate">{i.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between border-t px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground">{selected.length} dari 30 dipilih</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground"
              onClick={() => onChange(INDICATORS.map((i) => i.id))}
            >
              Pilih semua
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground"
              onClick={() => onChange([])}
            >
              Kosongkan
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ------------------------------------------------------------
// Trades table
// ------------------------------------------------------------

function TradesTable({ trades, digits }: { trades: BacktestTrade[]; digits: number }) {
  return (
    <div className="max-h-96 overflow-y-auto scrollbar-thin">
      <div className="overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-7 px-2 text-[10px]">#</TableHead>
              <TableHead className="h-7 px-2 text-[10px]">Side</TableHead>
              <TableHead className="h-7 px-2 text-[10px]">Entry → Exit</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Entry</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Exit</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Pips</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Profit</TableHead>
              <TableHead className="h-7 px-2 text-center text-[10px]">Alasan</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((t) => (
              <TableRow key={t.n}>
                <TableCell className="num px-2 py-1.5 text-[10px] tabular-nums text-muted-foreground">{t.n}</TableCell>
                <TableCell className="px-2 py-1.5">
                  <SideBadge side={t.side} />
                </TableCell>
                <TableCell className="num px-2 py-1.5 whitespace-nowrap text-[10px] tabular-nums">
                  {fmtTradeTime(t.entryTime)}
                  <span className="text-muted-foreground"> → </span>
                  {fmtTradeTime(t.exitTime)}
                </TableCell>
                <TableCell className="num px-2 py-1.5 text-right text-[11px] tabular-nums">{t.entry.toFixed(digits)}</TableCell>
                <TableCell className="num px-2 py-1.5 text-right text-[11px] tabular-nums">{t.exit.toFixed(digits)}</TableCell>
                <TableCell
                  className={cn(
                    'num px-2 py-1.5 text-right text-xs tabular-nums',
                    t.pips > 0 ? 'text-emerald-500' : t.pips < 0 ? 'text-red-500' : ''
                  )}
                >
                  {t.pips >= 0 ? '+' : ''}{t.pips.toFixed(1)}
                </TableCell>
                <TableCell
                  className={cn(
                    'num px-2 py-1.5 text-right text-xs font-semibold tabular-nums',
                    t.profit > 0 ? 'text-emerald-500' : t.profit < 0 ? 'text-red-500' : ''
                  )}
                >
                  {fmtMoney(t.profit)}
                </TableCell>
                <TableCell className="px-2 py-1.5 text-center">
                  <ReasonChip reason={t.reason} />
                </TableCell>
                <TableCell className="num px-2 py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
                  {fmtMoney(t.balance)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

export default function BacktestPanel() {
  // pair synced with the global store
  const selectedPair = useAppStore((s) => s.selectedPair)
  const setSelectedPair = useAppStore((s) => s.setSelectedPair)
  const [pair, setPair] = useState<Pair>((PAIR_IDS.includes(selectedPair as Pair) ? selectedPair : 'EURUSD') as Pair)

  // config state
  const [tf, setTf] = useState<Timeframe>('M15')
  const [barsStr, setBarsStr] = useState('500')
  const [indicators, setIndicators] = useState<string[]>([])
  const [risk, setRisk] = useState(RISK_LIMITS.riskPerTrade.default)
  const [slPips, setSlPips] = useState(RISK_LIMITS.stopLossPips.default)
  const [ratio, setRatio] = useState(RISK_LIMITS.takeProfitRatio.default)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestDetail | null>(null)

  // history poll
  const { data: history, refresh: refreshHistory } = usePolling<BacktestSummary[]>('/api/backtest', 30000)
  // settings (seed defaults from the live engine once)
  const { data: settings } = usePolling<SettingsData>('/api/settings', 30000)

  const seededRef = useRef(false)
  useEffect(() => {
    if (settings && !seededRef.current) {
      seededRef.current = true
      setIndicators(settings.indicators)
      setRisk(settings.riskPerTrade)
      setSlPips(settings.stopLossPips)
      setRatio(settings.takeProfitRatio)
    }
  }, [settings])

  const digits = getPairConfig(pair).digits
  const bars = clampNum(Math.round(parseInt(barsStr, 10) || 500), 100, 3000)

  const runBacktest = async () => {
    if (running) return
    if (indicators.length === 0) {
      toast.error('Pilih minimal satu indikator')
      return
    }
    setRunning(true)
    try {
      const detail = await apiPost<BacktestDetail>('/api/backtest', {
        pair,
        timeframe: tf,
        bars,
        indicators,
        riskPerTrade: risk,
        stopLossPips: slPips,
        takeProfitRatio: ratio,
      })
      setResult(detail)
      refreshHistory()
      toast.success(`Backtest ${detail.pair} ${detail.timeframe} selesai`, {
        description: `${detail.totalTrades} trade · net ${fmtMoney(detail.netProfit)} (${detail.netProfitPct >= 0 ? '+' : ''}${detail.netProfitPct.toFixed(2)}%) · WR ${detail.winRate.toFixed(0)}%`,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Backtest gagal dijalankan')
    } finally {
      setRunning(false)
    }
  }

  /** Load a history row's config back into the form (detail needs a re-run). */
  const loadFromHistory = (row: BacktestSummary) => {
    setPair(row.pair)
    setSelectedPair(row.pair)
    setTf(row.timeframe)
    setBarsStr(String(row.bars))
    if (row.indicators.length > 0) setIndicators(row.indicators)
    toast.info(`Konfigurasi ${row.pair} ${row.timeframe} dimuat`, {
      description: 'Jalankan ulang untuk melihat detail lengkap hasil run ini.',
    })
  }

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* ===== Config card ===== */}
        <Card className="h-fit p-3 lg:col-span-1">
          <SectionTitle
            right={
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <FlaskConical className="h-3 w-3" />
                Lab
              </span>
            }
          >
            Konfigurasi Backtest
          </SectionTitle>

          <div className="space-y-3">
            {/* pair + timeframe */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Pair</Label>
                <Select value={pair} onValueChange={(v) => setPair(v as Pair)}>
                  <SelectTrigger size="sm" className="w-full font-mono text-xs" aria-label="Pilih pair">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAIRS.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="font-mono text-xs">
                        {p.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Timeframe</Label>
                <Select value={tf} onValueChange={(v) => setTf(v as Timeframe)}>
                  <SelectTrigger size="sm" className="w-full font-mono text-xs" aria-label="Pilih timeframe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="font-mono text-xs">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* bars */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="bt-bars" className="text-[11px] text-muted-foreground">Jumlah Bar</Label>
                <span className="num text-[10px] tabular-nums text-muted-foreground">100 – 3000</span>
              </div>
              <Input
                id="bt-bars"
                type="number"
                inputMode="numeric"
                min={100}
                max={3000}
                step={50}
                value={barsStr}
                onChange={(e) => setBarsStr(e.target.value)}
                className="num h-8 text-xs tabular-nums"
              />
            </div>

            {/* indicator multi-select */}
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Indikator</Label>
              <IndicatorPicker selected={indicators} onChange={setIndicators} />
            </div>

            {/* risk params */}
            <div className="space-y-2.5 rounded-lg border bg-muted/20 p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Risk Management
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bt-risk" className="text-[11px]">Risk / trade</Label>
                  <span className="num rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{risk.toFixed(2)}%</span>
                </div>
                <Slider
                  id="bt-risk"
                  value={[risk]}
                  min={RISK_LIMITS.riskPerTrade.min}
                  max={RISK_LIMITS.riskPerTrade.max}
                  step={RISK_LIMITS.riskPerTrade.step}
                  onValueChange={(v) => setRisk(v[0] ?? risk)}
                  aria-label="Risk per trade persen"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bt-sl" className="text-[11px]">Stop loss</Label>
                  <span className="num rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{slPips} pips</span>
                </div>
                <Slider
                  id="bt-sl"
                  value={[slPips]}
                  min={RISK_LIMITS.stopLossPips.min}
                  max={RISK_LIMITS.stopLossPips.max}
                  step={RISK_LIMITS.stopLossPips.step}
                  onValueChange={(v) => setSlPips(Math.round(v[0] ?? slPips))}
                  aria-label="Stop loss pips"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bt-rr" className="text-[11px]">Take profit ratio</Label>
                  <Badge variant="outline" className="border-emerald-500/40 px-1.5 text-[10px] font-bold text-emerald-500">
                    1 : {ratio.toFixed(1)}
                  </Badge>
                </div>
                <Slider
                  id="bt-rr"
                  value={[ratio]}
                  min={RISK_LIMITS.takeProfitRatio.min}
                  max={RISK_LIMITS.takeProfitRatio.max}
                  step={RISK_LIMITS.takeProfitRatio.step}
                  onValueChange={(v) => setRatio(v[0] ?? ratio)}
                  aria-label="Take profit ratio"
                />
              </div>
            </div>

            <Button
              onClick={runBacktest}
              disabled={running}
              className="h-10 w-full gap-2 bg-emerald-600 text-sm font-bold text-white shadow-none hover:bg-emerald-600/90"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? 'Menjalankan…' : 'Jalankan Backtest'}
            </Button>
            <p className="text-center text-[9px] leading-tight text-muted-foreground">
              Saldo awal demo $10,000 · komisi $2/lot round-trip · data candle real + sintetis deterministik
            </p>
          </div>
        </Card>

        {/* ===== Results ===== */}
        <div className="space-y-3 lg:col-span-2">
          {!result ? (
            <Card className="flex min-h-[280px] items-center justify-center p-3">
              {running ? (
                <div className="flex w-full max-w-sm flex-col items-center gap-3 py-10 text-center">
                  <Loader2 className="h-7 w-7 animate-spin text-emerald-500" />
                  <div>
                    <p className="text-sm font-semibold">Menjalankan backtest…</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pair} {tf} · {bars} bar · {indicators.length} indikator — bisa memakan beberapa detik.
                    </p>
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ) : (
                <EmptyState
                  icon={<FlaskConical />}
                  title="Belum ada hasil backtest"
                  hint="Atur konfigurasi di kiri lalu klik “Jalankan Backtest”. Hasil lengkap (statistik, kurva equity, daftar trade) akan muncul di sini."
                />
              )}
            </Card>
          ) : (
            <>
              {/* headline + stats grid */}
              <Card className="p-3">
                <SectionTitle
                  right={
                    <span className="num text-[10px] tabular-nums text-muted-foreground">
                      {result.pair} {result.timeframe} · {result.bars} bar · {result.indicators.length} indikator ·{' '}
                      {fmtDateTime(result.createdAt)}
                    </span>
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5" />
                    Hasil Backtest
                  </span>
                </SectionTitle>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatCard
                    label="Net Profit"
                    value={fmtMoney(result.netProfit)}
                    tone={result.netProfit > 0 ? 'up' : result.netProfit < 0 ? 'down' : 'default'}
                    sub={`${result.netProfitPct >= 0 ? '+' : ''}${result.netProfitPct.toFixed(2)}% dari $10,000`}
                    icon={<Wallet />}
                  />
                  <StatCard
                    label="Win Rate"
                    value={`${result.winRate.toFixed(1)}%`}
                    tone={result.winRate >= 50 ? 'up' : 'down'}
                    sub={`${result.wins}W / ${result.losses}L`}
                    icon={<BarChart3 />}
                  />
                  <StatCard
                    label="Profit Factor"
                    value={result.profitFactor.toFixed(2)}
                    tone={result.profitFactor >= 1.5 ? 'up' : result.profitFactor < 1 ? 'down' : 'default'}
                    sub="gross win ÷ gross loss"
                  />
                  <StatCard
                    label="Max Drawdown"
                    value={`${result.maxDrawdownPct.toFixed(2)}%`}
                    tone="down"
                    sub={`-${fmtMoney(result.maxDrawdown).replace('-', '')} dari peak`}
                  />
                  <StatCard label="Total Trades" value={result.totalTrades} sub={`risk ${result.riskPerTrade}% · SL ${result.stopLossPips}p`} />
                  <StatCard
                    label="Avg Trade"
                    value={fmtMoney(result.avgTrade)}
                    tone={result.avgTrade > 0 ? 'up' : result.avgTrade < 0 ? 'down' : 'default'}
                    sub={`terbaik ${fmtMoney(result.bestTrade)} · terburuk ${fmtMoney(result.worstTrade)}`}
                  />
                  <StatCard
                    label="Expectancy"
                    value={fmtMoney(result.expectancy)}
                    tone={result.expectancy > 0 ? 'up' : result.expectancy < 0 ? 'down' : 'default'}
                    sub="ekspektasi per trade"
                  />
                  <StatCard
                    label="Sharpe"
                    value={result.sharpe.toFixed(2)}
                    tone={result.sharpe > 1 ? 'up' : result.sharpe < 0 ? 'down' : 'default'}
                    sub="mean ÷ std × √n"
                  />
                </div>
              </Card>

              {/* equity curve */}
              <Card className="p-3">
                <SectionTitle
                  right={
                    <div className="flex items-center gap-2">
                      <span className="num text-[10px] tabular-nums text-muted-foreground">
                        {fmtMoney(result.initialBalance, 0)} → {fmtMoney(result.finalBalance, 0)}
                      </span>
                      <span
                        className={cn(
                          'num rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                          result.netProfit >= 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'
                        )}
                      >
                        {result.netProfit >= 0 ? '+' : ''}{fmtMoney(result.netProfit)}
                      </span>
                    </div>
                  }
                >
                  Kurva Equity
                </SectionTitle>
                <EquityChart points={result.equityCurve} initialBalance={result.initialBalance} height={240} />
              </Card>

              {/* trades table */}
              <Card className="p-3">
                <SectionTitle
                  right={
                    <span className="num text-[10px] tabular-nums text-muted-foreground">
                      {result.trades.length} trade ditampilkan
                    </span>
                  }
                >
                  Daftar Trade
                </SectionTitle>
                {result.trades.length === 0 ? (
                  <EmptyState
                    title="Tidak ada trade"
                    hint="Skor indikator tidak pernah melewati ambang ±25 pada data yang dites — coba pair/timeframe/indikator lain."
                  />
                ) : (
                  <TradesTable trades={result.trades} digits={digits} />
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      {/* ===== History ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <History className="h-3 w-3" />
              20 terakhir · 30s refresh
            </span>
          }
        >
          Riwayat Backtest
        </SectionTitle>
        {!history ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState title="Belum ada riwayat backtest" hint="Setiap run backtest tercatat di sini." />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-7 px-2 text-[10px]">Waktu</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Pair</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">TF</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Bars</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Ind</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Trades</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Net %</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Win Rate</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">PF</TableHead>
                  <TableHead className="h-7 px-2 text-right text-[10px]">Max DD</TableHead>
                  <TableHead className="h-7 px-2 text-center text-[10px]">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="num px-2 py-1.5 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                      {fmtDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="px-2 py-1.5 font-mono text-xs font-semibold">{row.pair}</TableCell>
                    <TableCell className="px-2 py-1.5 font-mono text-[11px]">{row.timeframe}</TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums">{row.bars}</TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                      {row.indicators.length}
                    </TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums">{row.totalTrades}</TableCell>
                    <TableCell
                      className={cn(
                        'num px-2 py-1.5 text-right text-xs font-semibold tabular-nums',
                        row.netProfitPct > 0 ? 'text-emerald-500' : row.netProfitPct < 0 ? 'text-red-500' : ''
                      )}
                    >
                      {row.netProfitPct >= 0 ? '+' : ''}{row.netProfitPct.toFixed(2)}%
                    </TableCell>
                    <TableCell
                      className={cn(
                        'num px-2 py-1.5 text-right text-xs tabular-nums',
                        row.winRate >= 50 ? 'text-emerald-500' : 'text-red-500'
                      )}
                    >
                      {row.winRate.toFixed(0)}%
                    </TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums">{row.profitFactor.toFixed(2)}</TableCell>
                    <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums text-red-500">
                      {row.maxDrawdownPct.toFixed(2)}%
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
                            aria-label={`Muat konfigurasi backtest ${row.pair} ${row.timeframe}`}
                            onClick={() => loadFromHistory(row)}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="text-[10px]">Jalankan ulang untuk melihat detail</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  )
}
