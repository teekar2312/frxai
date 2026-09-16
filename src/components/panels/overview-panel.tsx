'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Wallet,
  Landmark,
  TrendingUp,
  TrendingDown,
  Percent,
  Gauge,
  Layers,
  X,
  Bot,
  Cpu,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  SideBadge,
  SourceBadge,
  LiveDot,
  Sparkline,
} from '@/components/shared/primitives'
import { usePolling, apiPost, fmtMoney, fmtPrice, fmtPct, fmtTime } from '@/hooks/use-polling'
import { useAppStore } from '@/lib/store'
import { SESSIONS, getPairConfig, getProviderConfig, isSessionActive, sessionProgress } from '@/lib/constants'
import type { Candle, ClosedTrade, EnginePollResponse, PositionView, SettingsData } from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// OVERVIEW PANEL — main monitoring dashboard
// ============================================================

/** Ticking clock, initialized on the client only (avoids SSR mismatch) */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const tick = () => setNow(new Date())
    const t0 = setTimeout(tick, 0) // first value ASAP after mount (async → SSR-safe)
    const t = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(t0)
      clearInterval(t)
    }
  }, [intervalMs])
  return now
}

// ------------------------------------------------------------
// Sessions strip (local clock per city, 1s tick)
// ------------------------------------------------------------

function SessionsStrip() {
  const now = useNow(1000)
  const formatters = useMemo(
    () => SESSIONS.map((s) => new Intl.DateTimeFormat('en-GB', { timeZone: s.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })),
    []
  )

  return (
    <section aria-label="Trading sessions">
      <SectionTitle>Sesi Pasar</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SESSIONS.map((s, i) => {
          const active = now ? isSessionActive(s.id, now) : false
          const progress = now ? sessionProgress(s.id, now) : 0
          return (
            <div
              key={s.id}
              className={cn(
                'rounded-lg border p-2.5 transition-colors',
                active ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'bg-card'
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-semibold">{s.name}</span>
                <LiveDot ok={active} />
              </div>
              <div className="num mt-1 text-sm font-semibold tabular-nums">
                {now ? formatters[i].format(now) : '--:--:--'}
              </div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.city}</div>
              <Progress value={active ? progress * 100 : 0} className="mt-1.5 h-1" aria-label={`${s.name} session progress`} />
              <div className="mt-0.5 text-right text-[9px] text-muted-foreground">
                {active ? `${Math.round(progress * 100)}% elapsed` : 'Closed'}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ------------------------------------------------------------
// Overview panel
// ------------------------------------------------------------

export default function OverviewPanel() {
  const { data: engine, loading, error, refresh: refreshEngine } = usePolling<EnginePollResponse>('/api/engine', 2000)
  const { data: positions, refresh: refreshPositions } = usePolling<PositionView[]>('/api/positions', 2000)
  const { data: closed, refresh: refreshHistory } = usePolling<ClosedTrade[]>('/api/positions/history?limit=8', 10000)
  const { data: settings } = usePolling<SettingsData>('/api/settings', 30000)
  const setSelectedPair = useAppStore((s) => s.setSelectedPair)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const [busyId, setBusyId] = useState<string | null>(null)

  const account = engine?.account
  const status = engine?.status
  const prices = engine?.prices ?? []
  const provider = settings ? getProviderConfig(settings.aiProvider) : null

  const closePosition = async (p: PositionView) => {
    if (busyId) return
    setBusyId(p.id)
    try {
      await apiPost('/api/orders', { action: 'close', positionId: p.id })
      toast.success(`Posisi ${p.pair} ${p.side} ditutup`)
      refreshPositions()
      refreshHistory()
      refreshEngine()
      bumpRefresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menutup posisi')
    } finally {
      setBusyId(null)
    }
  }

  const goToTrading = (pair: string) => {
    setSelectedPair(pair)
    setActiveTab('trading')
  }

  // ---- Loading / error guards ----
  if (loading && !engine) {
    return (
      <div className="space-y-3 p-3 sm:p-4" aria-busy="true" aria-label="Memuat data dashboard">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Skeleton className="h-[260px] rounded-lg lg:col-span-2" />
          <Skeleton className="h-[260px] rounded-lg" />
        </div>
        <Skeleton className="h-[110px] rounded-lg" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Skeleton className="h-[220px] rounded-lg" />
          <Skeleton className="h-[220px] rounded-lg" />
        </div>
      </div>
    )
  }

  if (error && !engine) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTitle>Engine tidak terjangkau</AlertTitle>
          <AlertDescription>
            {error} — cek koneksi engine lalu coba lagi.
          </AlertDescription>
        </Alert>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => refreshEngine()}>
          Coba lagi
        </Button>
      </div>
    )
  }

  const floating = account?.floatingPnl ?? 0
  const dailyPct = engine?.dailyPnlPct ?? account?.dailyPnlPct ?? 0
  const marginLevel = account?.marginLevel ?? 0
  const openCount = engine?.openPositions ?? 0
  const maxPositions = settings?.maxPositions

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* ===== Stat cards ===== */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Balance"
          value={fmtMoney(account?.balance)}
          sub={account ? `#${account.login}` : undefined}
          icon={<Wallet />}
        />
        <StatCard
          label="Equity"
          value={fmtMoney(account?.equity)}
          sub={`Margin ${fmtMoney(account?.margin)}`}
          icon={<Landmark />}
        />
        <StatCard
          label="Floating P/L"
          value={fmtMoney(floating)}
          tone={floating > 0 ? 'up' : floating < 0 ? 'down' : 'default'}
          sub={`${openCount} posisi terbuka`}
          icon={floating >= 0 ? <TrendingUp /> : <TrendingDown />}
        />
        <StatCard
          label="Daily P/L"
          value={fmtPct(dailyPct)}
          tone={dailyPct > 0 ? 'up' : dailyPct < 0 ? 'down' : 'default'}
          sub={`Target ${account?.dailyTargetPct ?? '—'}% · Limit ${account?.dailyLimitPct ?? '—'}%`}
          icon={<Percent />}
        />
        <StatCard
          label="Margin Level"
          value={marginLevel > 0 ? `${marginLevel.toFixed(1)}%` : '—'}
          tone={marginLevel > 0 && marginLevel < 100 ? 'warn' : 'default'}
          sub={`Free ${fmtMoney(account?.freeMargin)}`}
          icon={<Gauge />}
        />
        <StatCard
          label="Posisi Terbuka"
          value={openCount}
          sub={`Maks ${maxPositions ?? '—'}`}
          icon={<Layers />}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* ===== Market watchlist ===== */}
        <Card className="p-3 lg:col-span-2">
          <SectionTitle
            right={
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <LiveDot ok={status?.connected ?? false} />
                Live · klik pair untuk trade
              </span>
            }
          >
            Market Watch
          </SectionTitle>
          <div className="max-h-[560px] divide-y divide-border overflow-y-auto scrollbar-thin">
            {prices.length === 0
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="m-1 h-10 rounded-md" />)
              : prices.map((t) => (
                  <MarketWatchRow key={t.pair} tick={t} onClick={() => goToTrading(t.pair)} />
                ))}
          </div>
        </Card>

        {/* ===== AI Engine status ===== */}
        <Card className="p-3">
          <SectionTitle>AI Engine</SectionTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                'gap-1 text-[10px] font-bold',
                status?.aiTrading ? 'border-emerald-500/40 text-emerald-500' : 'border-zinc-500/30 text-zinc-400'
              )}
            >
              <Bot className="h-3 w-3" />
              {status?.aiTrading ? 'AI MODE' : 'MANUAL MODE'}
            </Badge>
            <Badge variant="outline" className="gap-1 text-[10px] font-semibold">
              <Cpu className="h-3 w-3 text-muted-foreground" />
              {provider ? provider.name : '—'}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'gap-1.5 font-mono text-[10px]',
                status?.mode === 'LIVE' ? 'border-red-500/40 text-red-500' : 'border-emerald-500/40 text-emerald-500'
              )}
            >
              <LiveDot ok={status?.connected ?? false} />
              {status?.mode ?? 'DEMO'} · {status?.connected ? 'OK' : 'OFF'}
            </Badge>
          </div>

          <div className="mt-2.5 rounded-md border bg-muted/30 p-2">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Keputusan AI Terakhir
            </div>
            <p className="line-clamp-3 min-h-[2.5em] text-[11px] leading-snug text-muted-foreground">
              {status?.lastAiDecision ?? 'Belum ada keputusan AI pada sesi ini.'}
            </p>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div className="rounded-md border p-2">
              <div className="num text-base font-semibold text-emerald-500">{status?.autoTradeCount ?? 0}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Auto trades</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="num text-base font-semibold">{status?.manualTradeCount ?? 0}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Manual trades</div>
            </div>
          </div>

          <div className="mt-2.5">
            {status?.dailyBlocked === 'LIMIT' ? (
              <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] font-semibold text-amber-500">
                <Gauge className="h-3.5 w-3.5" />
                DAILY LIMIT TERCAPAI — TRADING DIBLOKIR
              </div>
            ) : status?.dailyBlocked === 'TARGET' ? (
              <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] font-semibold text-emerald-500">
                <TrendingUp className="h-3.5 w-3.5" />
                TARGET HARIAN TERCAPAI — TRADING DIBLOKIR
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] font-semibold text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                RISK NORMAL — LIMIT &amp; TARGET AMAN
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ===== Sessions strip ===== */}
      <SessionsStrip />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ===== Open positions ===== */}
        <Card className="p-3">
          <SectionTitle
            right={
              <span className="num text-[10px] text-muted-foreground">
                {openCount} aktif
              </span>
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
            <EmptyState title="Tidak ada posisi terbuka" hint="Buka posisi dari tab Trading atau biarkan AI yang trading." />
          ) : (
            <div className="max-h-72 overflow-y-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-7 px-2 text-[10px]">Pair</TableHead>
                    <TableHead className="h-7 px-2 text-[10px]">Side</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Vol</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Pips</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Profit</TableHead>
                    <TableHead className="hidden h-7 px-2 text-right text-[10px] sm:table-cell">SL / TP</TableHead>
                    <TableHead className="h-7 w-8 px-2" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => {
                    const d = getPairConfig(p.pair).digits
                    return (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => goToTrading(p.pair)}>
                        <TableCell className="px-2 py-1.5 text-xs font-semibold">{p.pair}</TableCell>
                        <TableCell className="px-2 py-1.5">
                          <SideBadge side={p.side} />
                        </TableCell>
                        <TableCell className="num px-2 py-1.5 text-right text-xs tabular-nums">{p.volume.toFixed(2)}</TableCell>
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
                        <TableCell className="num hidden px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground sm:table-cell">
                          {p.stopLoss !== null ? fmtPrice(p.stopLoss, d) : '—'} / {p.takeProfit !== null ? fmtPrice(p.takeProfit, d) : '—'}
                        </TableCell>
                        <TableCell className="px-2 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                            disabled={busyId === p.id}
                            aria-label={`Tutup posisi ${p.pair} ${p.side}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              closePosition(p)
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* ===== Recent closed trades ===== */}
        <Card className="p-3">
          <SectionTitle right={<span className="text-[10px] text-muted-foreground">10s refresh</span>}>
            Trade Terakhir Ditutup
          </SectionTitle>
          {!closed ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-7 rounded-md" />
              ))}
            </div>
          ) : closed.length === 0 ? (
            <EmptyState title="Belum ada trade tertutup" hint="Riwayat muncul setelah posisi ditutup (SL/TP/manual)." />
          ) : (
            <div className="max-h-72 overflow-y-auto scrollbar-thin">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-7 px-2 text-[10px]">Pair</TableHead>
                    <TableHead className="h-7 px-2 text-[10px]">Side</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Pips</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Profit</TableHead>
                    <TableHead className="h-7 px-2 text-[10px]">Alasan</TableHead>
                    <TableHead className="h-7 px-2 text-right text-[10px]">Waktu</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closed.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="px-2 py-1.5 text-xs font-semibold">
                        <span className="mr-1.5 inline-block align-middle">
                          <SourceBadge source={t.source} />
                        </span>
                        {t.pair}
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <SideBadge side={t.side} />
                      </TableCell>
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
                      <TableCell className="num px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-foreground">
                        {fmtTime(t.closedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Market watchlist row
// ------------------------------------------------------------

function MarketWatchRow({ tick, onClick }: { tick: EnginePollResponse['prices'][number]; onClick: () => void }) {
  const { data: candles } = usePolling<Candle[]>(`/api/market/history?pair=${tick.pair}&tf=M5&limit=60`, 10000)
  const closes = useMemo(() => (candles ?? []).map((c) => c.close), [candles])
  const up = tick.changePct >= 0
  const range = tick.dayHigh - tick.dayLow
  const pos = range > 0 ? Math.min(100, Math.max(0, ((tick.bid - tick.dayLow) / range) * 100)) : 50

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Buka chart ${tick.pair} di tab Trading`}
      className="grid w-full grid-cols-12 items-center gap-2 px-1 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
      {/* pair + change */}
      <div className="col-span-4 sm:col-span-3">
        <div className="text-xs font-bold leading-tight">{getPairConfig(tick.pair).name}</div>
        <div className={cn('num text-[10px] font-semibold tabular-nums', up ? 'text-emerald-500' : 'text-red-500')}>
          {fmtPct(tick.changePct)}
        </div>
      </div>
      {/* bid / ask */}
      <div className="col-span-4 text-xs sm:col-span-3">
        <div className="num font-semibold tabular-nums leading-tight">{fmtPrice(tick.bid, tick.digits)}</div>
        <div className="num text-[10px] tabular-nums text-muted-foreground">{fmtPrice(tick.ask, tick.digits)}</div>
      </div>
      {/* spread */}
      <div className="hidden text-center sm:block">
        <div className="num text-xs tabular-nums leading-tight">{tick.spread.toFixed(1)}</div>
        <div className="text-[9px] uppercase text-muted-foreground">pips</div>
      </div>
      {/* day range */}
      <div className="col-span-2 sm:col-span-3">
        <div className="flex items-center gap-1.5">
          <span className="num hidden text-[9px] tabular-nums text-muted-foreground md:block">{fmtPrice(tick.dayLow, tick.digits)}</span>
          <div className="relative h-1 flex-1 rounded-full bg-muted">
            <div
              className={cn('absolute inset-y-0 left-0 rounded-full', up ? 'bg-emerald-500/50' : 'bg-red-500/50')}
              style={{ width: `${pos}%` }}
            />
            <div
              className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-foreground/70"
              style={{ left: `calc(${pos}% - 1px)` }}
            />
          </div>
          <span className="num hidden text-[9px] tabular-nums text-muted-foreground md:block">{fmtPrice(tick.dayHigh, tick.digits)}</span>
        </div>
      </div>
      {/* sparkline */}
      <div className="col-span-2 flex justify-end">
        <Sparkline data={closes} width={72} height={26} />
      </div>
    </button>
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
