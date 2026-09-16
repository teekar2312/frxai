// ============================================================
// FINEX AI TRADING SYSTEM — NEWS API
// GET  /api/news              → NewsItemView[] (latest 60)
// POST /api/news              → body { action: 'fetch-real' | 'generate' }
//   - fetch-real: pull Finnhub + Marketaux forex news (needs env keys),
//     dedupe by headline, prune the table to 80 rows
//   - generate:   create 2-3 SIM news items from a local headline pool
//     (same style as the simulator's synthetic feed, own templates)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import type { NewsItem } from '@prisma/client'
import { db } from '@/lib/db'
import { getSimulator } from '@/lib/engine/simulator'
import { getPairConfig } from '@/lib/constants'
import type { NewsImpact, NewsItemView, Pair } from '@/lib/types'

export const dynamic = 'force-dynamic'

const NEWS_IMPACTS = ['HIGH', 'MEDIUM', 'LOW']
const MAX_ROWS = 80
const SUMMARY_MAX = 300
const FETCH_TIMEOUT_MS = 8000

function toView(row: NewsItem): NewsItemView {
  return {
    id: row.id,
    source: row.source,
    headline: row.headline,
    summary: row.summary,
    url: row.url,
    sentiment: row.sentiment,
    impact: (NEWS_IMPACTS as readonly string[]).includes(row.impact) ? (row.impact as NewsImpact) : 'MEDIUM',
    category: row.category,
    pairs: row.pairs ? row.pairs.split(',').map((x) => x.trim()).filter(Boolean) : [],
    publishedAt: row.publishedAt.toISOString(),
  }
}

/** Keep only the newest MAX_ROWS news items (same policy as the simulator). */
async function pruneNews(): Promise<void> {
  const count = await db.newsItem.count()
  if (count <= MAX_ROWS) return
  const stale = await db.newsItem.findMany({ orderBy: { publishedAt: 'desc' }, skip: MAX_ROWS, select: { id: true } })
  if (stale.length > 0) await db.newsItem.deleteMany({ where: { id: { in: stale.map((x) => x.id) } } })
}

// ------------------------------------------------------------
// GET — latest news
// ------------------------------------------------------------
export async function GET() {
  try {
    const rows = await db.newsItem.findMany({ orderBy: { publishedAt: 'desc' }, take: 60 })
    return NextResponse.json(rows.map(toView))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal memuat news' }, { status: 500 })
  }
}

// ------------------------------------------------------------
// Real news fetchers (Finnhub / Marketaux)
// ------------------------------------------------------------
interface RealItem {
  headline: string
  summary: string | null
  url: string | null
  publishedAt: Date
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback)

async function fetchFinnhub(key: string): Promise<RealItem[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://finnhub.io/api/v1/news?category=forex&token=${encodeURIComponent(key)}`, {
      signal: ctrl.signal,
    })
    if (!res.ok) return []
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []
    return (data as Record<string, unknown>[])
      .slice(0, 15)
      .map((x) => ({
        headline: str(x.headline).trim(),
        summary: str(x.summary).slice(0, SUMMARY_MAX) || null,
        url: str(x.url) || null,
        publishedAt: new Date(num(x.datetime, Math.floor(Date.now() / 1000)) * 1000),
      }))
      .filter((x) => x.headline.length > 0)
  } catch {
    return [] // per-source error — never break the whole action
  } finally {
    clearTimeout(timer)
  }
}

async function fetchMarketaux(key: string): Promise<RealItem[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://api.marketaux.com/v1/news/all?api_token=${encodeURIComponent(key)}&language=en&limit=15`,
      { signal: ctrl.signal },
    )
    if (!res.ok) return []
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null || !Array.isArray((data as { data?: unknown }).data)) return []
    const items = (data as { data: Record<string, unknown>[] }).data
    return items
      .slice(0, 15)
      .map((x) => ({
        headline: str(x.title).trim(),
        summary: str(x.description).slice(0, SUMMARY_MAX) || null,
        url: str(x.url) || null,
        publishedAt: new Date(str(x.published_at) || Date.now()),
      }))
      .filter((x) => x.headline.length > 0)
  } catch {
    return [] // per-source error — never break the whole action
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------------
// SIM news pool (own templates — {pair} placeholder where relevant)
// ------------------------------------------------------------
interface GenTemplate {
  category: 'CENTRAL_BANK' | 'ECONOMIC' | 'GEOPOLITICS' | 'FISCAL' | 'COMMODITY' | 'SENTIMENT' | 'BREAKING'
  impact: NewsImpact
  sentiment: number
  pairs: Pair[]
  headline: string
  summary: string
}

const GEN_TEMPLATES: GenTemplate[] = [
  {
    category: 'CENTRAL_BANK', impact: 'HIGH', sentiment: 0.55, pairs: ['EURUSD', 'USDJPY', 'XAUUSD'],
    headline: 'Fed officials open the door to sooner rate cuts — dollar slips, {pair} bid firms',
    summary: 'Two FOMC members said progress on inflation may allow policy easing earlier than planned, weakening the greenback against major rivals.',
  },
  {
    category: 'CENTRAL_BANK', impact: 'MEDIUM', sentiment: 0.35, pairs: ['EURUSD', 'GBPUSD'],
    headline: 'ECB policymakers push back on aggressive cut bets, {pair} off weekly lows',
    summary: 'Governing Council hawks argued services inflation remains too sticky for rapid easing, lifting the euro from key support.',
  },
  {
    category: 'CENTRAL_BANK', impact: 'HIGH', sentiment: -0.4, pairs: ['USDJPY', 'XAUUSD'],
    headline: 'BOJ intervention watch intensifies as {pair} probes multi-decade highs',
    summary: 'Suspected yen buying by Japanese authorities kept traders on edge, with volatility spiking across yen crosses.',
  },
  {
    category: 'CENTRAL_BANK', impact: 'MEDIUM', sentiment: 0.15, pairs: ['GBPUSD'],
    headline: 'BOE holds bank rate as vote split narrows — {pair} steadies',
    summary: 'The Monetary Policy Committee kept rates unchanged with a closer vote split, signalling caution over persistent wage growth.',
  },
  {
    category: 'ECONOMIC', impact: 'HIGH', sentiment: -0.5, pairs: ['EURUSD', 'GBPUSD', 'XAUUSD'],
    headline: 'Hot US CPI beats forecasts — {pair} slides as rate-cut hopes fade',
    summary: 'Headline inflation surprised to the upside, repricing Fed easing expectations and lifting the dollar broadly.',
  },
  {
    category: 'ECONOMIC', impact: 'HIGH', sentiment: 0.5, pairs: ['USDJPY', 'EURUSD'],
    headline: 'NFP misses badly, unemployment ticks up — {pair} rallies',
    summary: 'Payrolls grew well below expectations and the jobless rate rose, reviving bets on a softer Fed path.',
  },
  {
    category: 'ECONOMIC', impact: 'LOW', sentiment: 0.25, pairs: ['USDJPY'],
    headline: 'Weekly jobless claims edge lower, {pair} little changed',
    summary: 'Initial claims fell modestly, leaving labour-market narratives unchanged heading into month-end positioning.',
  },
  {
    category: 'ECONOMIC', impact: 'MEDIUM', sentiment: 0.4, pairs: ['EURUSD'],
    headline: 'Eurozone GDP revised higher, {pair} extends weekly advance',
    summary: 'Second-quarter growth was revised up on stronger German industrial output, supporting the single currency.',
  },
  {
    category: 'ECONOMIC', impact: 'MEDIUM', sentiment: -0.35, pairs: ['GBPUSD'],
    headline: 'UK retail sales disappoint, {pair} pressured as BOE cut odds rise',
    summary: 'Consumer spending contracted more than expected, strengthening the case for earlier Bank of England easing.',
  },
  {
    category: 'GEOPOLITICS', impact: 'HIGH', sentiment: -0.6, pairs: ['XAUUSD', 'USDJPY'],
    headline: 'Geopolitical escalation triggers safe-haven flows — gold jumps, {pair} volatile',
    summary: 'Breaking reports of renewed regional conflict drove investors into bullion and the dollar amid fading risk appetite.',
  },
  {
    category: 'GEOPOLITICS', impact: 'MEDIUM', sentiment: -0.3, pairs: ['EURUSD', 'USDJPY'],
    headline: 'Fresh tariff headlines rattle risk appetite, {pair} whipsaws',
    summary: 'Trade-war rhetoric returned to the forefront, denting risk currencies during thinner afternoon liquidity.',
  },
  {
    category: 'FISCAL', impact: 'LOW', sentiment: 0.2, pairs: ['XAUUSD'],
    headline: 'Lawmakers avert shutdown with stopgap bill, markets relieved',
    summary: 'A short-term funding deal passed overnight, removing an immediate fiscal risk from the table and calming bullion.',
  },
  {
    category: 'COMMODITY', impact: 'HIGH', sentiment: 0.65, pairs: ['XAUUSD'],
    headline: 'Gold breaks to a fresh record on central bank buying spree',
    summary: 'Sustained official-sector purchases and softer real yields propelled bullion to a new all-time high.',
  },
  {
    category: 'COMMODITY', impact: 'MEDIUM', sentiment: -0.2, pairs: ['XAUUSD', 'USDJPY'],
    headline: 'Oil slides on demand worries, {pair} follows the commodity complex lower',
    summary: 'Crude extended losses after weak import data, dragging commodity-linked sentiment across majors.',
  },
  {
    category: 'SENTIMENT', impact: 'LOW', sentiment: 0.3, pairs: ['EURUSD', 'GBPUSD'],
    headline: 'Risk-on tone prevails, {pair} grinds higher near session highs',
    summary: 'Equity strength and subsiding volatility kept carry trades in favour through the London session.',
  },
  {
    category: 'BREAKING', impact: 'HIGH', sentiment: -0.7, pairs: ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'],
    headline: 'BREAKING: Flash move in {pair} as thin liquidity amplifies stop cascades',
    summary: 'A sudden burst of volatility hit the majors around the fixing, cascading through stop clusters before stabilizing.',
  },
]

// ------------------------------------------------------------
// POST — fetch-real | generate
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''

    if (action === 'fetch-real') {
      const fhKey = (process.env.FINNHUB_API_KEY ?? '').trim()
      const mxKey = (process.env.MARKETAUX_API_KEY ?? '').trim()
      if (!fhKey && !mxKey) {
        return NextResponse.json(
          {
            error:
              'API key Finnhub/Marketaux belum dikonfigurasi di server (env FINNHUB_API_KEY / MARKETAUX_API_KEY). Gunakan tombol Generate untuk news simulasi, atau jalankan Python engine di PC Anda untuk news real.',
          },
          { status: 400 },
        )
      }

      const [fhItems, mxItems] = await Promise.all([
        fhKey ? fetchFinnhub(fhKey) : Promise.resolve([] as RealItem[]),
        mxKey ? fetchMarketaux(mxKey) : Promise.resolve([] as RealItem[]),
      ])
      const candidates: (RealItem & { source: string })[] = [
        ...fhItems.map((x) => ({ ...x, source: 'FINNHUB' })),
        ...mxItems.map((x) => ({ ...x, source: 'MARKETAUX' })),
      ]

      // Dedupe by headline against existing rows and within the batch
      const existing = await db.newsItem.findMany({ select: { headline: true } })
      const seen = new Set(existing.map((r) => r.headline))
      const toInsert = candidates.filter((c) => {
        if (!c.headline || seen.has(c.headline)) return false
        seen.add(c.headline)
        return true
      })

      if (toInsert.length > 0) {
        await db.newsItem.createMany({
          data: toInsert.map((c) => ({
            source: c.source,
            headline: c.headline,
            summary: c.summary,
            url: c.url,
            sentiment: 0,
            impact: 'MEDIUM',
            category: null,
            pairs: null,
            publishedAt: c.publishedAt,
          })),
        })
      }
      await pruneNews()
      await getSimulator().log(
        'INFO',
        'NEWS',
        `News fetch-real: +${toInsert.length} item baru`,
        `FINNHUB ${fhItems.length} diterima · MARKETAUX ${mxItems.length} diterima`,
      )
      return NextResponse.json({ success: true, inserted: toInsert.length })
    }

    if (action === 'generate') {
      const count = 2 + Math.floor(Math.random() * 2) // 2-3 SIM items
      // Shuffle template indices, take `count` distinct templates
      const order = GEN_TEMPLATES.map((_, i) => i)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = order[i]
        order[i] = order[j]
        order[j] = tmp
      }
      const now = Date.now()
      let inserted = 0
      for (let i = 0; i < Math.min(count, GEN_TEMPLATES.length); i++) {
        const tpl = GEN_TEMPLATES[order[i]]
        const label = getPairConfig(tpl.pairs[0]).name // e.g. 'EUR/USD'
        const headline = tpl.headline.split('{pair}').join(label)
        const sentiment = Math.round(Math.max(-1, Math.min(1, tpl.sentiment + (Math.random() - 0.5) * 0.3)) * 100) / 100
        await db.newsItem.create({
          data: {
            source: 'SIM',
            headline,
            summary: tpl.summary,
            url: null,
            sentiment,
            impact: tpl.impact,
            category: tpl.category,
            pairs: tpl.pairs.join(','),
            publishedAt: new Date(now - i * Math.floor(90_000 + Math.random() * 240_000)),
          },
        })
        inserted++
      }
      await pruneNews()
      await getSimulator().log('INFO', 'NEWS', `News generate: +${inserted} item SIM`)
      return NextResponse.json({ success: true, inserted })
    }

    return NextResponse.json({ error: "Action tidak valid — gunakan 'fetch-real' atau 'generate'" }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Aksi news gagal dijalankan' }, { status: 500 })
  }
}
