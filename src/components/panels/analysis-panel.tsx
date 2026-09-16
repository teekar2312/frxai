'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BrainCircuit,
  Cpu,
  Layers,
  Loader2,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  StatCard,
  SectionTitle,
  EmptyState,
  SignalBadge,
  LiveDot,
} from '@/components/shared/primitives'
import { usePolling, apiPost, fmtPrice, fmtDateTime } from '@/hooks/use-polling'
import { useAppStore } from '@/lib/store'
import {
  PAIRS,
  PAIR_IDS,
  TIMEFRAMES,
  getPairConfig,
  getProviderConfig,
} from '@/lib/constants'
import type {
  AnalysisResult,
  FundamentalBlock,
  ModelStatView,
  Pair,
  SettingsData,
  Side,
  Timeframe,
} from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// ANALYSIS PANEL — AI analysis workspace + self-learning model
// ============================================================

const ALL_TFS = TIMEFRAMES.map((t) => t.id)

/** Sentinel value for the "analyze all active pairs" selector option. */
const ALL_PAIRS_VALUE = '__ALL__'

/** Horizontal centered score bar for -100..100 values. */
function ScoreBar({ score, className }: { score: number; className?: string }) {
  const v = Math.max(-100, Math.min(100, score))
  const width = Math.abs(v) / 2 // % of the half-track
  const positive = v >= 0
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="meter" aria-valuenow={v} aria-valuemin={-100} aria-valuemax={100} aria-label="Skor indikator">
      {/* center marker */}
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/30" aria-hidden />
      <span
        className={cn('absolute inset-y-0 rounded-full', positive ? 'bg-emerald-500' : 'bg-red-500')}
        style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
      />
    </div>
  )
}

/** Centered sentiment bar for -1..1 values. */
function SentimentMeter({ value }: { value: number }) {
  const v = Math.max(-1, Math.min(1, value))
  const width = Math.abs(v) * 50 // % from the center
  const positive = v >= 0
  const label = v > 0.15 ? 'Bullish' : v < -0.15 ? 'Bearish' : 'Netral'
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sentimen Berita</span>
        <span className={cn('num text-[10px] font-semibold tabular-nums', positive ? 'text-emerald-500' : 'text-red-500')}>
          {v > 0 ? '+' : ''}{v.toFixed(2)} · {label}
        </span>
      </div>
      <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/30" aria-hidden />
        <span
          className={cn('absolute inset-y-0 rounded-full', positive ? 'bg-emerald-500' : 'bg-red-500')}
          style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
        <span>-1 bearish</span>
        <span>bullish +1</span>
      </div>
    </div>
  )
}

/** Semi-circular confidence gauge (0..100). */
function ConfidenceGauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value))
  const r = 44
  const arc = Math.PI * r // half-circumference
  const dash = (v / 100) * arc
  const tone = v >= 60 ? 'text-emerald-500' : v >= 35 ? 'text-amber-500' : 'text-zinc-500'
  const stroke = v >= 60 ? '#10b981' : v >= 35 ? '#f59e0b' : '#a1a1aa'
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 110 62" width="110" height="62" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label="Tingkat keyakinan">
        <path d={`M 11 56 A ${r} ${r} 0 0 1 99 56`} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={9} strokeLinecap="round" />
        <path
          d={`M 11 56 A ${r} ${r} 0 0 1 99 56`}
          fill="none"
          stroke={stroke}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${arc}`}
        />
        <text x="55" y="50" textAnchor="middle" fontSize="17" fontWeight={700} fill="currentColor" className="num">
          {Math.round(v)}%
        </text>
      </svg>
      <span className={cn('text-[10px] font-semibold uppercase tracking-wider', tone)}>Confidence</span>
    </div>
  )
}

/** Sentiment chip for a fundamental block. */
function SentimentChip({ sentiment }: { sentiment: FundamentalBlock['sentiment'] }) {
  const map: Record<FundamentalBlock['sentiment'], string> = {
    BULLISH: 'bg-emerald-500/15 text-emerald-500',
    BEARISH: 'bg-red-500/15 text-red-500',
    NEUTRAL: 'bg-zinc-500/10 text-zinc-400',
  }
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide', map[sentiment])}>
      {sentiment}
    </span>
  )
}

/** Compact category chip for indicator rows. */
function CategoryChip({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
      {category}
    </span>
  )
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

export default function AnalysisPanel() {
  // pair synced with the global store (overview watchlist ↔ trading chart)
  const selectedPair = useAppStore((s) => s.selectedPair)
  const setSelectedPair = useAppStore((s) => s.setSelectedPair)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const pair = (PAIR_IDS.includes(selectedPair as Pair) ? selectedPair : 'EURUSD') as Pair

  // local UI state
  const [tf, setTf] = useState<Timeframe>('M15')
  const [analyzing, setAnalyzing] = useState(false)
  const [active, setActive] = useState<AnalysisResult | null>(null)
  const [sortIndBy, setSortIndBy] = useState<'weight' | 'name'>('weight')
  const [tradingBusy, setTradingBusy] = useState(false)
  // multi-pair analysis ("Semua" mode)
  const [allMode, setAllMode] = useState(false)
  const [multiResults, setMultiResults] = useState<AnalysisResult[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  // polls
  const { data: history, loading: historyLoading, refresh: refreshHistory } = usePolling<AnalysisResult[]>(
    '/api/analysis/history?limit=6',
    10000
  )
  const { data: settings } = usePolling<SettingsData>('/api/settings', 10000)
  const { data: model } = usePolling<{ stats: ModelStatView[]; samples: number; accuracy: number }>(
    '/api/model',
    15000
  )

  // auto-load the latest analysis once, on mount
  const autoLoadRef = useRef(false)
  useEffect(() => {
    if (!autoLoadRef.current && history !== undefined) {
      autoLoadRef.current = true
      if (history.length > 0) setActive(history[0])
    }
  }, [history])

  const provider = settings ? getProviderConfig(settings.aiProvider) : null

  // pairs currently active (enabled in Settings) — the target set for "Semua" analysis
  const activePairs = useMemo<Pair[]>(
    () => (settings?.pairs ?? []).filter((p) => PAIR_IDS.includes(p)),
    [settings]
  )

  // summary of the last multi-pair run
  const multiSummary = useMemo(() => {
    const buys = multiResults.filter((r) => r.signal.includes('BUY')).length
    const sells = multiResults.filter((r) => r.signal.includes('SELL')).length
    return { buys, sells, neutrals: multiResults.length - buys - sells }
  }, [multiResults])

  // sorted indicator readings for the detail card
  const sortedIndicators = useMemo(() => {
    const list = active?.indicators ?? []
    return [...list].sort((a, b) =>
      sortIndBy === 'weight' ? b.weight - a.weight : a.name.localeCompare(b.name)
    )
  }, [active, sortIndBy])

  // top-12 learned indicators (already sorted by weight from the API)
  const topModelStats = useMemo(() => (model?.stats ?? []).slice(0, 12), [model])

  // ---- actions ----
  const runAnalysis = async () => {
    if (analyzing) return
    if (allMode) {
      await runAllAnalysis()
      return
    }
    setAnalyzing(true)
    try {
      const res = await apiPost<AnalysisResult>('/api/analysis', { pair, timeframe: tf })
      setActive(res)
      refreshHistory()
      toast.success(`Analisa ${res.pair} ${res.timeframe}: ${res.signal}`, {
        description: `${res.live ? 'LLM Live (Z.AI)' : 'Local ML fallback'} · skor ${res.score >= 0 ? '+' : ''}${res.score} · confidence ${res.confidence}%`,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analisa gagal dijalankan')
    } finally {
      setAnalyzing(false)
    }
  }

  /** Analyze every ACTIVE pair (Settings → pairs) sequentially with live progress. */
  const runAllAnalysis = async () => {
    let targets: Pair[] = activePairs
    if (targets.length === 0) {
      // settings not loaded yet — fetch once, fall back to the default 4 majors
      try {
        const s = (await fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json())) as SettingsData
        targets = (s.pairs ?? []).filter((p) => PAIR_IDS.includes(p))
      } catch {
        /* keep empty */
      }
    }
    if (targets.length === 0) targets = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD']

    setAnalyzing(true)
    setMultiResults([])
    setProgress({ done: 0, total: targets.length, current: targets[0] })
    const results: AnalysisResult[] = []
    const failed: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i]
      setProgress({ done: i, total: targets.length, current: p })
      try {
        const res = await apiPost<AnalysisResult>('/api/analysis', { pair: p, timeframe: tf })
        results.push(res)
        setMultiResults([...results])
      } catch {
        failed.push(p)
      }
    }
    setProgress(null)
    refreshHistory()
    if (results.length > 0) {
      // auto-select the strongest signal as the active detail
      const best = [...results].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0]
      setActive(best)
      const buys = results.filter((r) => r.signal.includes('BUY')).length
      const sells = results.filter((r) => r.signal.includes('SELL')).length
      const neutrals = results.length - buys - sells
      toast.success(`Analisa ${results.length} pair selesai (${tf})`, {
        description: `${buys} BUY · ${sells} SELL · ${neutrals} NEUTRAL — sinyal terkuat: ${best.pair} ${best.signal}${failed.length > 0 ? ` · ${failed.length} gagal (${failed.join(', ')})` : ''}`,
      })
    } else {
      toast.error('Analisa semua pair gagal dijalankan', {
        description: failed.length > 0 ? `Gagal: ${failed.join(', ')}` : undefined,
      })
    }
    setAnalyzing(false)
  }

  const tradeFromSignal = async () => {
    if (!active || tradingBusy) return
    if (active.signal !== 'BUY' && active.signal !== 'SELL' && active.signal !== 'STRONG_BUY' && active.signal !== 'STRONG_SELL') return
    const side: Side = active.signal.includes('BUY') ? 'BUY' : 'SELL'
    // Indicators that agree with the traded direction — feeds the self-learning loop on close
    const agreeing = active.indicators
      .filter((r) => r.signal === side)
      .map((r) => r.id)
      .slice(0, 12)
    setTradingBusy(true)
    try {
      await apiPost('/api/orders', {
        action: 'open',
        pair: active.pair,
        side,
        riskBased: true,
        stopLossPips: active.stopLossPips || 10,
        takeProfitPips: active.takeProfitPips || 15,
        source: 'ANALYSIS',
        signalIndicators: agreeing,
        comment: `Analysis ${active.signal}`,
      })
      toast.success(`${side} ${active.pair} dibuka dari sinyal analisa`, {
        description: `Lot dihitung dari risk · SL ${active.stopLossPips || 10}p · TP ${active.takeProfitPips || 15}p${agreeing.length > 0 ? ` · ${agreeing.length} indikator ikut belajar` : ''}`,
      })
      bumpRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Order gagal')
    } finally {
      setTradingBusy(false)
    }
  }

  const digits = active ? getPairConfig(active.pair).digits : 5
  const rrRatio = active && active.stopLossPips > 0 ? active.takeProfitPips / active.stopLossPips : null
  const tradable =
    active !== null &&
    (active.signal === 'BUY' || active.signal === 'SELL' || active.signal === 'STRONG_BUY' || active.signal === 'STRONG_SELL')

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* ===== Controls row ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={allMode ? ALL_PAIRS_VALUE : pair}
          onValueChange={(v) => {
            if (!v) return
            if (v === ALL_PAIRS_VALUE) {
              setAllMode(true)
            } else {
              setAllMode(false)
              setSelectedPair(v)
            }
          }}
          variant="outline"
          size="sm"
          className="flex-wrap"
          aria-label="Pilih pair (atau Semua pair aktif)"
        >
          <ToggleGroupItem
            value={ALL_PAIRS_VALUE}
            aria-label={`Semua pair aktif (${activePairs.length || '…'})`}
            title="Analisa seluruh pair yang aktif di Settings"
            className="gap-1 px-2.5 text-[11px] font-bold data-[state=on]:border-emerald-500/50 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400"
          >
            <Layers className="h-3 w-3" />
            Semua
            <span className="num rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground">
              {activePairs.length || '…'}
            </span>
          </ToggleGroupItem>
          {PAIRS.map((p) => (
            <ToggleGroupItem
              key={p.id}
              value={p.id}
              className={cn(
                'px-2.5 font-mono text-[11px] font-semibold data-[state=on]:border-emerald-500/50 data-[state=on]:bg-emerald-500/15 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400',
                !activePairs.includes(p.id) && 'opacity-60'
              )}
              title={activePairs.includes(p.id) ? `${p.name} — aktif` : `${p.name} — belum aktif di Settings`}
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
          className="flex-wrap"
          aria-label="Pilih timeframe"
        >
          {ALL_TFS.map((t) => (
            <ToggleGroupItem key={t} value={t} className="px-2 text-[11px] font-semibold">
              {t}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Button
          onClick={runAnalysis}
          disabled={analyzing}
          className="h-8 gap-1.5 bg-emerald-600 px-3 text-xs font-bold text-white shadow-none hover:bg-emerald-600/90"
        >
          {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {analyzing
            ? allMode && progress
              ? `Menganalisa ${progress.current} (${progress.done + 1}/${progress.total})…`
              : 'Menganalisa…'
            : allMode
              ? `Analisis Semua Pair (${activePairs.length || '…'})`
              : 'Analisis Sekarang'}
        </Button>

        {/* provider badge */}
        {settings && provider ? (
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 text-[10px] font-semibold',
              provider.demoLive ? 'border-emerald-500/40 text-emerald-500' : 'border-zinc-500/30 text-zinc-400'
            )}
            title={provider.description}
          >
            <LiveDot ok={provider.demoLive} />
            <Cpu className="h-3 w-3" />
            {provider.name} · {provider.model}
            <span className="font-normal text-muted-foreground">
              {provider.demoLive ? '· LLM Live (via SDK)' : '· Local fallback'}
            </span>
          </Badge>
        ) : (
          <Skeleton className="h-7 w-44 rounded-full" />
        )}
      </div>

      {/* ===== Multi-pair progress + results ===== */}
      {progress ? (
        <Card className="p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              Menganalisa {progress.current}…
            </span>
            <span className="num text-[10px] tabular-nums text-muted-foreground">
              {progress.done + 1} / {progress.total} pair
            </span>
          </div>
          <Progress value={((progress.done + 0.5) / progress.total) * 100} className="h-1.5" />
          {multiResults.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {multiResults.map((r) => (
                <span
                  key={`${r.pair}-${r.createdAt}`}
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                >
                  {r.pair}
                  <SignalBadge signal={r.signal} />
                </span>
              ))}
            </div>
          ) : null}
        </Card>
      ) : multiResults.length > 0 ? (
        <Card className="p-3">
          <SectionTitle
            right={
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="text-emerald-500">{multiSummary.buys} BUY</span>·
                <span className="text-red-500">{multiSummary.sells} SELL</span>·
                <span>{multiSummary.neutrals} NEUTRAL</span>
              </span>
            }
          >
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Hasil Analisa Semua Pair ({multiResults.length})
            </span>
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {multiResults.map((r) => {
              const isActive = active !== null && r.pair === active.pair && r.createdAt === active.createdAt
              return (
                <button
                  key={`${r.pair}-${r.createdAt}`}
                  type="button"
                  onClick={() => setActive(r)}
                  aria-label={`Lihat detail analisa ${r.pair} ${r.signal}`}
                  className={cn(
                    'rounded-md border p-2 text-left transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                    isActive && 'border-emerald-500/50 bg-emerald-500/[0.06]'
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-bold">{r.pair}</span>
                    <SignalBadge signal={r.signal} />
                  </div>
                  <div className="mt-1.5">
                    <ScoreBar score={r.score} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[9px] tabular-nums text-muted-foreground">
                    <span className="num font-semibold">{r.score > 0 ? '+' : ''}{r.score}</span>
                    <span className="num">{r.confidence}%</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[9px] text-muted-foreground">
                    <span className="font-mono">{r.timeframe}</span>
                    <LiveDot ok={r.live} />
                  </div>
                </button>
              )
            })}
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* ===== Detail card ===== */}
        <Card className="p-3 lg:col-span-2">
          <SectionTitle
            right={
              active ? (
                <span className="num text-[10px] text-muted-foreground">{fmtDateTime(active.createdAt)}</span>
              ) : null
            }
          >
            <span className="flex items-center gap-1.5">
              <BrainCircuit className="h-3.5 w-3.5" />
              Hasil Analisa
            </span>
          </SectionTitle>

          {!active ? (
            historyLoading && history === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles />}
                title="Belum ada analisa"
                hint="Pilih pair & timeframe lalu klik “Analisis Sekarang” untuk menjalankan AI (LLM live via Z.AI atau model ML lokal)."
              />
            )
          ) : (
            <div className="space-y-3">
              {/* headline row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{getPairConfig(active.pair).name}</span>
                <Badge variant="outline" className="font-mono text-[10px] font-semibold">{active.timeframe}</Badge>
                <span className="scale-125 origin-left"><SignalBadge signal={active.signal} /></span>
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1.5 text-[10px] font-semibold',
                    active.live ? 'border-emerald-500/40 text-emerald-500' : 'border-zinc-500/30 text-zinc-400'
                  )}
                >
                  <LiveDot ok={active.live} />
                  {active.live ? 'LLM Live' : 'Local ML'}
                </Badge>
                <span className="hidden text-[10px] text-muted-foreground sm:inline">{active.providerLabel}</span>
                {tradable ? (
                  <Button
                    onClick={tradeFromSignal}
                    disabled={tradingBusy}
                    size="sm"
                    className={cn(
                      'ml-auto h-7 gap-1.5 px-2.5 text-[11px] font-bold text-white shadow-none',
                      active.signal.includes('BUY')
                        ? 'bg-emerald-600 hover:bg-emerald-600/90'
                        : 'bg-red-600 hover:bg-red-600/90'
                    )}
                  >
                    {tradingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    Trade dari sinyal
                  </Button>
                ) : null}
              </div>

              {/* gauges row */}
              <div className="grid grid-cols-2 items-center gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-4">
                <div className="flex justify-center">
                  <ConfidenceGauge value={active.confidence} />
                </div>
                <div className="col-span-2 flex flex-col justify-center gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Skor Indikator</span>
                    <span
                      className={cn(
                        'num text-sm font-bold tabular-nums',
                        active.score > 0 ? 'text-emerald-500' : active.score < 0 ? 'text-red-500' : ''
                      )}
                    >
                      {active.score > 0 ? '+' : ''}{active.score}
                    </span>
                  </div>
                  <ScoreBar score={active.score} />
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>-100 sell</span>
                    <span>buy +100</span>
                  </div>
                  <SentimentMeter value={active.newsSentiment} />
                </div>
                <div className="rounded-md border bg-card p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">ML Lokal</div>
                  {active.mlPrediction.samples > 0 || active.mlPrediction.probability > 0 ? (
                    <>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span
                          className={cn(
                            'num text-lg font-bold leading-tight tabular-nums',
                            active.mlPrediction.label === 'BUY'
                              ? 'text-emerald-500'
                              : active.mlPrediction.label === 'SELL'
                                ? 'text-red-500'
                                : ''
                          )}
                        >
                          {active.mlPrediction.probability.toFixed(0)}%
                        </span>
                        <span className="text-[10px] font-semibold text-muted-foreground">{active.mlPrediction.label}</span>
                      </div>
                      <div className="num mt-1 text-[10px] tabular-nums text-muted-foreground">
                        {active.mlPrediction.samples} sampel · akurasi{' '}
                        {(active.mlPrediction.accuracy * 100).toFixed(0)}%
                      </div>
                    </>
                  ) : (
                    <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                      Prediksi ML tidak tersimpan pada riwayat lama.
                    </div>
                  )}
                </div>
              </div>

              {/* trade plan grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border p-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Entry</div>
                  <div className="num mt-0.5 text-sm font-semibold tabular-nums">{fmtPrice(active.entry, digits)}</div>
                </div>
                <div className="rounded-md border border-red-500/25 bg-red-500/[0.04] p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Stop Loss</span>
                    {active.stopLossPips > 0 ? (
                      <span className="num text-[9px] font-semibold text-red-500">{active.stopLossPips}p</span>
                    ) : null}
                  </div>
                  <div className="num mt-0.5 text-sm font-semibold tabular-nums text-red-500">
                    {active.stopLoss > 0 ? fmtPrice(active.stopLoss, digits) : '—'}
                  </div>
                </div>
                <div className="rounded-md border border-emerald-500/25 bg-emerald-500/[0.04] p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Take Profit</span>
                    {active.takeProfitPips > 0 ? (
                      <span className="num text-[9px] font-semibold text-emerald-500">{active.takeProfitPips}p</span>
                    ) : null}
                  </div>
                  <div className="num mt-0.5 text-sm font-semibold tabular-nums text-emerald-500">
                    {active.takeProfit > 0 ? fmtPrice(active.takeProfit, digits) : '—'}
                  </div>
                </div>
                <div className="flex flex-col justify-center rounded-md border p-2">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Risk : Reward</div>
                  <Badge variant="outline" className="mt-1 w-fit border-emerald-500/40 px-1.5 text-[10px] font-bold text-emerald-500">
                    1 : {rrRatio ? rrRatio.toFixed(1) : '—'}
                  </Badge>
                </div>
              </div>

              {/* reasoning */}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Penalaran AI</div>
                <p className="whitespace-pre-line rounded-md border bg-muted/20 p-2.5 text-xs leading-relaxed">
                  {active.reasoning}
                </p>
              </div>

              {/* fundamentals */}
              {active.fundamentals.length > 0 ? (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Analisa Fundamental
                  </div>
                  <ul className="space-y-1.5">
                    {active.fundamentals.map((f, i) => (
                      <li key={`${f.title}-${i}`} className="flex items-start gap-2 rounded-md border p-2">
                        <SentimentChip sentiment={f.sentiment} />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold leading-tight">{f.title}</div>
                          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{f.content}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* indicators table */}
              {sortedIndicators.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Indikator Teknikal ({sortedIndicators.length})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-muted-foreground"
                      onClick={() => setSortIndBy((s) => (s === 'weight' ? 'name' : 'weight'))}
                    >
                      Urut: {sortIndBy === 'weight' ? 'Bobot ↓' : 'Nama A-Z'}
                    </Button>
                  </div>
                  <div className="max-h-72 overflow-y-auto scrollbar-thin">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-7 px-2 text-[10px]">Indikator</TableHead>
                          <TableHead className="h-7 px-2 text-[10px]">Kategori</TableHead>
                          <TableHead className="h-7 px-2 text-right text-[10px]">Nilai</TableHead>
                          <TableHead className="h-7 px-2 text-center text-[10px]">Sinyal</TableHead>
                          <TableHead className="h-7 w-24 px-2 text-[10px]">Bobot</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedIndicators.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="px-2 py-1.5 text-xs font-semibold">{r.name}</TableCell>
                            <TableCell className="px-2 py-1.5">
                              <CategoryChip category={r.category} />
                            </TableCell>
                            <TableCell className="num px-2 py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
                              {r.value}
                            </TableCell>
                            <TableCell className="px-2 py-1.5 text-center">
                              <span
                                className={cn(
                                  'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide',
                                  r.signal === 'BUY'
                                    ? 'bg-emerald-500/15 text-emerald-500'
                                    : r.signal === 'SELL'
                                      ? 'bg-red-500/15 text-red-500'
                                      : 'bg-zinc-500/10 text-zinc-400'
                                )}
                              >
                                {r.signal}
                              </span>
                            </TableCell>
                            <TableCell className="px-2 py-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-emerald-500/70"
                                    style={{ width: `${Math.min(100, (r.weight / 3) * 100)}%` }}
                                  />
                                </div>
                                <span className="num text-[10px] tabular-nums text-muted-foreground">
                                  ×{r.weight.toFixed(2)}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        {/* ===== Recent analyses list ===== */}
        <Card className="h-fit p-3">
          <SectionTitle right={<span className="text-[10px] text-muted-foreground">10s refresh</span>}>
            Riwayat Analisa
          </SectionTitle>
          {!history ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[60px] rounded-md" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <EmptyState title="Belum ada riwayat" hint="Analisa yang dijalankan akan tercatat di sini." />
          ) : (
            <div className="max-h-[520px] space-y-2 overflow-y-auto scrollbar-thin pr-0.5">
              {history.map((a, i) => {
                const isActive = active !== null && a.createdAt === active.createdAt && a.pair === active.pair
                return (
                  <button
                    key={`${a.createdAt}-${a.pair}-${i}`}
                    type="button"
                    onClick={() => setActive(a)}
                    aria-label={`Lihat analisa ${a.pair} ${a.timeframe} ${a.signal}`}
                    className={cn(
                      'w-full rounded-md border p-2 text-left transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                      isActive && 'border-emerald-500/50 bg-emerald-500/[0.06]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold">{a.pair}</span>
                        <span className="font-mono text-[9px] text-muted-foreground">{a.timeframe}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <LiveDot ok={a.live} />
                        <SignalBadge signal={a.signal} />
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <ScoreBar score={a.score} className="flex-1" />
                      <span
                        className={cn(
                          'num w-8 text-right text-[10px] font-semibold tabular-nums',
                          a.score > 0 ? 'text-emerald-500' : a.score < 0 ? 'text-red-500' : 'text-muted-foreground'
                        )}
                      >
                        {a.score > 0 ? '+' : ''}{a.score}
                      </span>
                      <span className="num w-9 text-right text-[10px] tabular-nums text-muted-foreground">
                        {a.confidence}%
                      </span>
                    </div>
                    <div className="num mt-1 text-right text-[9px] tabular-nums text-muted-foreground">
                      {fmtDateTime(a.createdAt)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ===== Self-learning model ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            model ? (
              <span className="num text-[10px] tabular-nums text-muted-foreground">
                {model.samples} sampel · 15s refresh
              </span>
            ) : null
          }
        >
          <span className="flex items-center gap-1.5">
            <BrainCircuit className="h-3.5 w-3.5" />
            Self-Learning Model
          </span>
        </SectionTitle>

        {!model ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Skeleton className="h-[76px] rounded-lg" />
            <Skeleton className="h-[76px] rounded-lg" />
            <Skeleton className="h-[76px] rounded-lg" />
          </div>
        ) : model.samples === 0 ? (
          <EmptyState
            icon={<BrainCircuit />}
            title="Model belum punya sampel pembelajaran"
            hint="Bobot indikator mulai belajar otomatis setelah trade AI pertama ditutup (setiap win/loss mengubah bobot indikator yang memberi sinyal)."
          />
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="Total Sampel"
                value={model.samples}
                sub="trade AI yang sudah dievaluasi"
                icon={<BrainCircuit />}
              />
              <StatCard
                label="Akurasi Model"
                value={`${model.accuracy.toFixed(1)}%`}
                tone={model.accuracy >= 50 ? 'up' : 'down'}
                sub="win rate gabungan seluruh indikator"
                icon={<TrendingUp />}
              />
              <StatCard
                label="Indikator Dipelajari"
                value={model.stats.length}
                sub="dari 30 indikator tersedia"
                icon={<TrendingDown />}
              />
            </div>

            {/* top-12 weight bars */}
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Bobot Indikator Terpelajari (Top {topModelStats.length}) — skala 0.2 – 3.0
              </div>
              <div className="space-y-1">
                {topModelStats.map((s) => (
                  <div key={s.indicator} className="grid grid-cols-12 items-center gap-2">
                    <div className="col-span-6 flex min-w-0 items-center gap-1.5 sm:col-span-4">
                      <span className="truncate text-xs font-semibold">{s.name}</span>
                      <CategoryChip category={s.category} />
                    </div>
                    <div className="col-span-3 sm:col-span-4">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500/70"
                          style={{ width: `${Math.min(100, (s.weight / 3) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="num col-span-3 flex items-center justify-end gap-2 text-[10px] tabular-nums sm:col-span-4">
                      <span className="font-semibold">×{s.weight.toFixed(2)}</span>
                      <span className={cn(s.winRate >= 50 ? 'text-emerald-500' : 'text-red-500')}>
                        {s.samples > 0 ? `${s.winRate.toFixed(0)}%` : '—'}
                      </span>
                      <span className="text-muted-foreground">{s.samples}×</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-tight text-muted-foreground">
                Win rate “—” = indikator belum pernah dievaluasi. Bobot naik saat sinyalnya menghasilkan profit (+0.08/loss −0.06,
                dikali besaran pergerakan) dan dijaga pada rentang 0.2–3.0.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
