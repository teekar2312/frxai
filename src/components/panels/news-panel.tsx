'use client'

import { useMemo, useState } from 'react'
import {
  CalendarClock,
  ExternalLink,
  Globe,
  Loader2,
  Newspaper,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionTitle, EmptyState, ImpactBadge, SourceBadge } from '@/components/shared/primitives'
import { usePolling, apiPost } from '@/hooks/use-polling'
import type { CalendarEvent, NewsItemView } from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// NEWS PANEL — fundamental intelligence: calendar + news feed
// ============================================================

const CATEGORY_LABELS: Record<string, string> = {
  CENTRAL_BANK: 'Bank Sentral',
  ECONOMIC: 'Data Ekonomi',
  GEOPOLITICS: 'Geopolitik',
  FISCAL: 'Fiskal',
  COMMODITY: 'Komoditas',
  SENTIMENT: 'Sentimen',
  BREAKING: 'Breaking',
}

const rtfId = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' })

/** "5 menit yang lalu"-style relative time (Bahasa Indonesia). */
function timeAgoId(iso: string): string {
  const diffSec = (Date.now() - new Date(iso).getTime()) / 1000
  if (diffSec < 0) return rtfId.format(0, 'minute')
  if (diffSec < 60) return rtfId.format(-Math.max(1, Math.round(diffSec)), 'second')
  if (diffSec < 3600) return rtfId.format(-Math.round(diffSec / 60), 'minute')
  if (diffSec < 86400) return rtfId.format(-Math.round(diffSec / 3600), 'hour')
  return rtfId.format(-Math.round(diffSec / 86400), 'day')
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Small currency chip for the calendar (uniform zinc — no blue). */
function CurrencyChip({ currency }: { currency: string }) {
  return (
    <span className="num inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-muted-foreground">
      {currency}
    </span>
  )
}

/** Colored sentiment dot + value for a news card footer. */
function SentimentIndicator({ value }: { value: number }) {
  const tone = value > 0.15 ? 'bg-emerald-500' : value < -0.15 ? 'bg-red-500' : 'bg-zinc-400'
  const text = value > 0.15 ? 'text-emerald-500' : value < -0.15 ? 'text-red-500' : 'text-muted-foreground'
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('h-1.5 w-1.5 rounded-full', tone)} aria-hidden />
      <span className={cn('num text-[10px] font-semibold tabular-nums', text)}>
        {value > 0 ? '+' : ''}{value.toFixed(2)}
      </span>
    </span>
  )
}

/** Centered average-sentiment gauge (-1..1). */
function AvgSentimentGauge({ value }: { value: number }) {
  const v = Math.max(-1, Math.min(1, value))
  const width = Math.abs(v) * 50
  const positive = v >= 0
  return (
    <div className="w-full">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/30" aria-hidden />
        <span
          className={cn('absolute inset-y-0 rounded-full', positive ? 'bg-emerald-500' : 'bg-red-500')}
          style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
        <span>-1</span>
        <span>0</span>
        <span>+1</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Calendar row
// ------------------------------------------------------------

function CalendarTable({ events }: { events: CalendarEvent[] }) {
  const sorted = useMemo(() => [...events].sort((a, b) => a.minutesUntil - b.minutesUntil), [events])
  return (
    <div className="max-h-64 overflow-y-auto scrollbar-thin">
      <div className="overflow-x-auto">
        <Table className="min-w-[560px]">
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-7 px-2 text-[10px]">Waktu</TableHead>
              <TableHead className="h-7 px-2 text-[10px]">Cur</TableHead>
              <TableHead className="h-7 px-2 text-[10px]">Event</TableHead>
              <TableHead className="h-7 px-2 text-[10px]">Impact</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Actual</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Forecast</TableHead>
              <TableHead className="h-7 px-2 text-right text-[10px]">Prev</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((e) => {
              const imminent = e.minutesUntil >= 0 && e.minutesUntil <= 30
              const past = e.minutesUntil < 0
              return (
                <TableRow key={e.id} className={cn(past && 'opacity-55')}>
                  <TableCell
                    className={cn(
                      'num px-2 py-1.5 whitespace-nowrap text-xs tabular-nums',
                      imminent ? 'font-bold text-amber-500' : past ? 'text-muted-foreground' : 'font-semibold'
                    )}
                  >
                    {fmtClock(e.time)}
                    {imminent ? (
                      <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] font-semibold text-amber-500">
                        {e.minutesUntil}m lagi
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-2 py-1.5">
                    <CurrencyChip currency={e.currency} />
                  </TableCell>
                  <TableCell className="px-2 py-1.5 text-xs font-medium">{e.title}</TableCell>
                  <TableCell className="px-2 py-1.5">
                    <ImpactBadge impact={e.impact} />
                  </TableCell>
                  <TableCell className="num px-2 py-1.5 text-right text-[11px] font-bold tabular-nums">
                    {e.actual ?? '—'}
                  </TableCell>
                  <TableCell className="num px-2 py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
                    {e.forecast ?? '—'}
                  </TableCell>
                  <TableCell className="num px-2 py-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
                    {e.previous ?? '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// News card
// ------------------------------------------------------------

function NewsCard({ item }: { item: NewsItemView }) {
  const highRisk = item.impact === 'HIGH' || item.category === 'BREAKING'
  return (
    <article
      className={cn(
        'rounded-lg border p-2.5',
        highRisk && 'border-l-2 border-l-red-500'
      )}
    >
      <h4 className="text-sm font-medium leading-snug">{item.headline}</h4>
      {item.summary ? (
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{item.summary}</p>
      ) : null}
      <footer className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <SourceBadge source={item.source} />
        <ImpactBadge impact={item.impact} />
        <SentimentIndicator value={item.sentiment} />
        {item.category ? (
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            {CATEGORY_LABELS[item.category] ?? item.category}
          </span>
        ) : null}
        <span>·</span>
        <span>{timeAgoId(item.publishedAt)}</span>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-emerald-600 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 dark:text-emerald-400"
            aria-label="Buka sumber berita di tab baru"
          >
            <ExternalLink className="h-3 w-3" />
            Sumber
          </a>
        ) : null}
      </footer>
    </article>
  )
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

export default function NewsPanel() {
  const { data: news, refresh: refreshNews } = usePolling<NewsItemView[]>('/api/news', 30000)
  const { data: calendar } = usePolling<CalendarEvent[]>('/api/calendar', 60000)

  const [fetchingReal, setFetchingReal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // sentiment summary from the loaded feed
  const sentimentStats = useMemo(() => {
    const items = news ?? []
    const bull = items.filter((x) => x.sentiment > 0.15).length
    const bear = items.filter((x) => x.sentiment < -0.15).length
    const avg = items.length > 0 ? items.reduce((a, x) => a + x.sentiment, 0) / items.length : 0
    return { bull, bear, neutral: items.length - bull - bear, avg, count: items.length }
  }, [news])

  const fetchReal = async () => {
    if (fetchingReal) return
    setFetchingReal(true)
    setFetchError(null)
    try {
      const res = await apiPost<{ success: boolean; inserted: number }>('/api/news', { action: 'fetch-real' })
      toast.success(`${res.inserted} berita real ditambahkan`, {
        description: 'Sumber Finnhub / Marketaux — item baru muncul di feed.',
      })
      refreshNews()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal fetch berita real'
      setFetchError(msg)
      toast.error('Fetch berita real gagal')
    } finally {
      setFetchingReal(false)
    }
  }

  const generateDemo = async () => {
    if (generating) return
    setGenerating(true)
    try {
      const res = await apiPost<{ success: boolean; inserted: number }>('/api/news', { action: 'generate' })
      toast.success(`${res.inserted} berita simulasi dibuat`)
      refreshNews()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate berita gagal')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* ===== Header row ===== */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <Newspaper className="h-4 w-4 text-emerald-500" />
            Berita
          </h2>
          <p className="text-[10px] text-muted-foreground">Intelijen fundamental — kalender ekonomi & feed berita</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* source legend */}
          <div className="hidden items-center gap-1.5 text-[9px] uppercase tracking-wide text-muted-foreground sm:flex" aria-hidden>
            <SourceBadge source="FINNHUB" />
            <SourceBadge source="MARKETAUX" />
            <SourceBadge source="SIM" />
            <span>= demo</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[11px]"
            onClick={fetchReal}
            disabled={fetchingReal}
          >
            {fetchingReal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
            Fetch Real
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 border-emerald-500/40 px-2.5 text-[11px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
            onClick={generateDemo}
            disabled={generating}
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate Demo
          </Button>
        </div>
      </div>

      {/* fetch-real error explanation */}
      {fetchError ? (
        <Alert variant="destructive">
          <AlertTitle className="text-xs font-semibold">Tidak bisa mengambil berita real</AlertTitle>
          <AlertDescription className="text-[11px] leading-snug">{fetchError}</AlertDescription>
        </Alert>
      ) : null}

      {/* ===== Economic calendar ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              Hari ini · 60s refresh
            </span>
          }
        >
          Kalender Ekonomi
        </SectionTitle>
        {!calendar ? (
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 rounded-md" />
            ))}
          </div>
        ) : calendar.length === 0 ? (
          <EmptyState title="Tidak ada event ekonomi" hint="Kalender digenerate ulang setiap hari (UTC)." />
        ) : (
          <CalendarTable events={calendar} />
        )}
      </Card>

      {/* ===== Sentiment summary strip ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <span className="num text-[10px] tabular-nums text-muted-foreground">
              {sentimentStats.count} berita · 30s refresh
            </span>
          }
        >
          Ringkasan Sentimen
        </SectionTitle>
        {!news ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[64px] rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 items-center gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
                <TrendingUp className="h-3 w-3" />
                Bullish
              </div>
              <div className="num mt-0.5 text-lg font-semibold tabular-nums text-emerald-500">{sentimentStats.bull}</div>
            </div>
            <div className="rounded-lg border border-red-500/25 bg-red-500/[0.05] p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-500">
                <TrendingDown className="h-3 w-3" />
                Bearish
              </div>
              <div className="num mt-0.5 text-lg font-semibold tabular-nums text-red-500">{sentimentStats.bear}</div>
            </div>
            <div className="rounded-lg border p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Netral</div>
              <div className="num mt-0.5 text-lg font-semibold tabular-nums">{sentimentStats.neutral}</div>
            </div>
            <div className="rounded-lg border p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Rata-rata</span>
                <span
                  className={cn(
                    'num text-sm font-bold tabular-nums',
                    sentimentStats.avg > 0.15
                      ? 'text-emerald-500'
                      : sentimentStats.avg < -0.15
                        ? 'text-red-500'
                        : 'text-muted-foreground'
                  )}
                >
                  {sentimentStats.avg > 0 ? '+' : ''}{sentimentStats.avg.toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5">
                <AvgSentimentGauge value={sentimentStats.avg} />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ===== News feed ===== */}
      <Card className="p-3">
        <SectionTitle
          right={
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-sm border-l-2 border-l-red-500" aria-hidden />
              = high impact / breaking
            </span>
          }
        >
          Feed Berita
        </SectionTitle>
        {!news ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : news.length === 0 ? (
          <EmptyState
            title="Belum ada berita"
            hint="Klik “Generate Demo” untuk membuat berita simulasi, atau “Fetch Real” bila API key Finnhub/Marketaux sudah diisi."
          />
        ) : (
          <div className="max-h-[500px] space-y-2 overflow-y-auto scrollbar-thin pr-1">
            {news.map((n) => (
              <NewsCard key={n.id} item={n} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
