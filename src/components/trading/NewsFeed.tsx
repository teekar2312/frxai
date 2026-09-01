'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Newspaper, ThumbsUp, ThumbsDown, Minus, RefreshCw, AlertTriangle, Zap, Clock } from 'lucide-react'

type Sentiment = 'Positive' | 'Negative' | 'Neutral'
type Category =
  | 'Economic'
  | 'Political'
  | 'Central Bank'
  | 'Fiscal'
  | 'Commodity'
  | 'Breaking'

interface NewsArticle {
  id: string
  title: string
  source: string
  time: string
  category: Category
  sentiment: Sentiment
   sentimentScore?: number
  symbols: string[]
  url?: string
  fetchedAt?: string
}

interface NewsStats {
  totalArticles: number
  last24h: number
  bySource: Record<string, number>
  bySentiment: Record<string, number>
  byCategory: Record<string, number>
  avgFetchTimeMs: number
  cacheHitRate: number
  lastFetchAt: string | null
}

const CATEGORIES = ['All', 'Economic', 'Political', 'Central Bank', 'Fiscal', 'Commodity', 'Breaking'] as const
type CategoryFilter = (typeof CATEGORIES)[number]

const defaultNews: NewsArticle[] = [
  { id: 'N1', title: 'Bank Indonesia Holds Rate at 6.00%, Signals Possible Cut in Q2', source: 'Bloomberg', time: new Date(Date.now() - 3600000).toISOString(), category: 'Central Bank', sentiment: 'Positive', sentimentScore: 65, symbols: ['BBCA', 'BBRI', 'BMRI'] },
  { id: 'N2', title: 'Indonesia Q4 GDP Growth Beats Expectations at 5.2%', source: 'Reuters', time: new Date(Date.now() - 7200000).toISOString(), category: 'Economic', sentiment: 'Positive', sentimentScore: 70, symbols: ['ASII', 'TLKM'] },
  { id: 'N3', title: 'Government Proposes New Tax Incentives for Tech Companies', source: 'Kontan', time: new Date(Date.now() - 10800000).toISOString(), category: 'Fiscal', sentiment: 'Positive', sentimentScore: 45, symbols: ['GOTO', 'EXCL'] },
  { id: 'N4', title: 'CPO Prices Surge 3% on Malaysia Supply Concerns', source: 'Jakarta Post', time: new Date(Date.now() - 14400000).toISOString(), category: 'Commodity', sentiment: 'Positive', sentimentScore: 55, symbols: ['ICBP'] },
  { id: 'N5', title: 'BREAKING: Major Earthquake Strikes Sulawesi, Markets May Open Lower', source: 'CNBC Indonesia', time: new Date(Date.now() - 900000).toISOString(), category: 'Breaking', sentiment: 'Negative', sentimentScore: -85, symbols: ['BBCA', 'BBRI'] },
  { id: 'N6', title: 'Parliament Debates New Financial Regulation Bill', source: 'Kompas', time: new Date(Date.now() - 18000000).toISOString(), category: 'Political', sentiment: 'Neutral', sentimentScore: 5, symbols: ['BRIS', 'ARTO'] },
  { id: 'N7', title: 'Foreign Investors Net Buy IDR 1.2T This Week', source: 'Bareksa', time: new Date(Date.now() - 21600000).toISOString(), category: 'Economic', sentiment: 'Positive', sentimentScore: 60, symbols: ['BBCA', 'TLKM', 'UNVR'] },
  { id: 'N8', title: 'Coal Prices Drop 5% Amid Global Demand Slowdown', source: 'CNBC Indonesia', time: new Date(Date.now() - 25200000).toISOString(), category: 'Commodity', sentiment: 'Negative', sentimentScore: -50, symbols: ['ARTO', 'TBIG'] },
]

const sentimentConfig: Record<Sentiment, { icon: typeof ThumbsUp; color: string; bg: string }> = {
  Positive: { icon: ThumbsUp, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-950/50' },
  Negative: { icon: ThumbsDown, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-950/50' },
  Neutral: { icon: Minus, color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-800/50' },
}

const categoryColor: Record<Category, string> = {
  Economic: 'bg-sky-100 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-400',
  Political: 'bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/50 dark:text-purple-400',
  'Central Bank': 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400',
  Fiscal: 'bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-400',
  Commodity: 'bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/50 dark:text-orange-400',
  Breaking: 'bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-400',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sentimentBadge(score: number | undefined) {
  if (score === undefined || score === 0) return null
  const color = score > 30 ? 'text-emerald-600' : score < -30 ? 'text-red-600' : 'text-slate-500'
  return (
    <span className={`text-[10px] font-mono font-medium ${color}`}>
      {score > 0 ? '+' : ''}{score.toFixed(0)}
    </span>
  )
}

export default function NewsFeed() {
  const [news, setNews] = useState<NewsArticle[]>(defaultNews)
  const [stats, setStats] = useState<NewsStats | null>(null)
  const [breakingNews, setBreakingNews] = useState<NewsArticle[]>([])
  const [activeTab, setActiveTab] = useState<CategoryFilter>('All')
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/news/fetch')
      if (res.ok) {
        const json = await res.json()
        if (json.success) {
          setStats(json.data.stats)
          if (json.data.breakingNews && json.data.breakingNews.length > 0) {
            setBreakingNews(json.data.breakingNews.map((a: Record<string, unknown>) => ({
              id: String(a.id ?? ''),
              title: String(a.title ?? ''),
              source: String(a.source ?? ''),
              time: String(a.publishedAt ?? a.fetchedAt ?? new Date().toISOString()),
              category: 'Breaking' as Category,
              sentiment: 'Negative' as Sentiment,
              sentimentScore: -80,
              symbols: [],
            })))
          }
        }
      }
    } catch { /* ignore */ }
  }, [])

  const fetchLiveNews = useCallback(async () => {
    setFetching(true)
    try {
      const res = await fetch('/api/news/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh: true, maxArticles: 30 }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data?.articles) {
          const mapped = json.data.articles.map((a: Record<string, unknown>) => ({
            id: String(a.id ?? Math.random().toString()),
            title: String(a.title ?? ''),
            source: String(a.source ?? 'Unknown'),
            time: String(a.publishedAt ?? a.fetchedAt ?? new Date().toISOString()),
            category: (String(a.category ?? 'Economic')) as Category,
            sentiment: (String(a.sentiment ?? 'Neutral')) as Sentiment,
            sentimentScore: Number(a.sentimentScore ?? 0),
            symbols: Array.isArray(a.symbols) ? a.symbols.map(String) : [],
            url: a.url ? String(a.url) : undefined,
            fetchedAt: a.fetchedAt ? String(a.fetchedAt) : undefined,
          }))
          setNews(mapped)
          await loadStats()
        }
      }
    } catch { /* use existing */ }
    finally {
      setFetching(false)
    }
  }, [loadStats])

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/news')
        if (res.ok) {
          const json = await res.json()
          if (Array.isArray(json)) setNews(json)
          else if (json.news) setNews(json.news)
        }
      } catch { /* use default */ }
      await loadStats()
      setLoading(false)
    }
    init()
  }, [loadStats])

  const filtered = activeTab === 'All' ? news : news.filter((a) => a.category === activeTab)
  const allArticles = [...breakingNews, ...filtered]

  return (
    <div className="space-y-4">
      {/* Breaking News Alert */}
      {breakingNews.length > 0 && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-bold text-red-700">Breaking News Alert</span>
            <Badge variant="destructive" className="text-[10px] h-5">{breakingNews.length}</Badge>
          </div>
          <div className="space-y-1.5">
            {breakingNews.slice(0, 3).map(a => (
              <div key={a.id} className="flex items-start gap-2 text-xs">
                <Zap className="h-3 w-3 text-red-600 mt-0.5 shrink-0" />
                <span className="text-red-800 font-medium">{a.title}</span>
                <span className="text-red-500 shrink-0">{formatTime(a.time)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-sky-600" />
              <CardTitle className="text-base">Market News</CardTitle>
              {stats && (
                <Badge variant="outline" className="text-[10px] h-5">
                  {stats.totalArticles} articles · {stats.last24h} last 24h
                </Badge>
              )}
            </div>
            <Button
              variant="outline" size="sm" className="h-7 text-xs gap-1"
              onClick={fetchLiveNews} disabled={fetching}
            >
              <RefreshCw className={`h-3 w-3 ${fetching ? 'animate-spin' : ''}`} />
              {fetching ? 'Fetching...' : 'Fetch Live'}
            </Button>
          </div>
          {/* News Stats Bar */}
          {stats && (
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground mt-2">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last fetch: {stats.lastFetchAt ? formatTime(stats.lastFetchAt) : 'Never'}
              </span>
              <span>Avg: {stats.avgFetchTimeMs.toFixed(0)}ms</span>
              <span>Cache hit: {(stats.cacheHitRate * 100).toFixed(0)}%</span>
              {Object.entries(stats.bySource).slice(0, 3).map(([src, cnt]) => (
                <span key={src}>{src}: {cnt}</span>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CategoryFilter)}>
            <TabsList className="mb-4 flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <TabsTrigger key={cat} value={cat} className="text-xs">
                  {cat}
                </TabsTrigger>
              ))}
            </TabsList>

            {CATEGORIES.map((cat) => (
              <TabsContent key={cat} value={cat}>
                <ScrollArea className="max-h-96 overflow-y-auto">
                  <div className="space-y-3 pr-3">
                    {loading ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">Loading news...</div>
                    ) : allArticles.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">No news in this category</div>
                    ) : (
                      allArticles.map((article) => {
                        const sent = sentimentConfig[article.sentiment]
                        const SentIcon = sent.icon
                        return (
                          <article key={article.id} className="rounded-lg border p-3 transition-colors hover:bg-muted/30">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <h4 className="text-sm font-medium leading-snug">{article.title}</h4>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {sentimentBadge(article.sentimentScore)}
                                <Badge className={categoryColor[article.category]}>{article.category}</Badge>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{article.source}</span>
                              <span>·</span>
                              <span>{formatTime(article.time)}</span>
                              <span>·</span>
                              <span className={`flex items-center gap-1 ${sent.color}`}>
                                <SentIcon className="h-3 w-3" />{article.sentiment}
                              </span>
                            </div>
                            {article.symbols.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {article.symbols.map((sym) => (
                                  <Badge key={sym} variant="outline" className="text-xs">{sym}</Badge>
                                ))}
                              </div>
                            )}
                          </article>
                        )
                      })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
