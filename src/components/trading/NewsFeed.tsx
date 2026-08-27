'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Newspaper, ThumbsUp, ThumbsDown, Minus, ExternalLink } from 'lucide-react'

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
  symbols: string[]
  url?: string
}

const CATEGORIES = ['All', 'Economic', 'Political', 'Central Bank', 'Fiscal', 'Commodity', 'Breaking'] as const

type CategoryFilter = (typeof CATEGORIES)[number]

const defaultNews: NewsArticle[] = [
  {
    id: 'N1',
    title: 'Bank Indonesia Holds Rate at 6.00%, Signals Possible Cut in Q2',
    source: 'Bloomberg',
    time: '2025-01-15T10:00:00Z',
    category: 'Central Bank',
    sentiment: 'Positive',
    symbols: ['BBCA', 'BBRI', 'BMRI'],
  },
  {
    id: 'N2',
    title: 'Indonesia Q4 GDP Growth Beats Expectations at 5.2%',
    source: 'Reuters',
    time: '2025-01-15T09:30:00Z',
    category: 'Economic',
    sentiment: 'Positive',
    symbols: ['ASII', 'TLKM'],
  },
  {
    id: 'N3',
    title: 'Government Proposes New Tax Incentives for Tech Companies',
    source: 'Kontan',
    time: '2025-01-15T09:00:00Z',
    category: 'Fiscal',
    sentiment: 'Positive',
    symbols: ['GOTO', 'EXCL'],
  },
  {
    id: 'N4',
    title: 'CPO Prices Surge 3% on Malaysia Supply Concerns',
    source: 'Jakarta Post',
    time: '2025-01-15T08:45:00Z',
    category: 'Commodity',
    sentiment: 'Positive',
    symbols: ['ICBP'],
  },
  {
    id: 'N5',
    title: 'BREAKING: Major Earthquake Strikes Sulawesi, Markets May Open Lower',
    source: 'CNBC Indonesia',
    time: '2025-01-15T08:15:00Z',
    category: 'Breaking',
    sentiment: 'Negative',
    symbols: ['BBCA', 'BBRI'],
  },
  {
    id: 'N6',
    title: 'Parliament Debates New Financial Regulation Bill',
    source: 'Kompas',
    time: '2025-01-15T08:00:00Z',
    category: 'Political',
    sentiment: 'Neutral',
    symbols: ['BRIS', 'ARTO'],
  },
  {
    id: 'N7',
    title: 'Foreign Investors Net Buy IDR 1.2T This Week',
    source: 'Bareksa',
    time: '2025-01-15T07:30:00Z',
    category: 'Economic',
    sentiment: 'Positive',
    symbols: ['BBCA', 'TLKM', 'UNVR'],
  },
  {
    id: 'N8',
    title: 'Coal Prices Drop 5% Amid Global Demand Slowdown',
    source: 'CNBC Indonesia',
    time: '2025-01-15T07:00:00Z',
    category: 'Commodity',
    sentiment: 'Negative',
    symbols: ['ARTO', 'TBIG'],
  },
]

const sentimentConfig: Record<Sentiment, { icon: typeof ThumbsUp; color: string; bg: string }> = {
  Positive: {
    icon: ThumbsUp,
    color: 'text-emerald-600',
    bg: 'bg-emerald-100 dark:bg-emerald-950/50',
  },
  Negative: {
    icon: ThumbsDown,
    color: 'text-red-600',
    bg: 'bg-red-100 dark:bg-red-950/50',
  },
  Neutral: {
    icon: Minus,
    color: 'text-gray-500',
    bg: 'bg-gray-100 dark:bg-gray-800/50',
  },
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

export default function NewsFeed() {
  const [news, setNews] = useState<NewsArticle[]>(defaultNews)
  const [activeTab, setActiveTab] = useState<CategoryFilter>('All')
  const [loading, setLoading] = useState(true)

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news')
      if (res.ok) {
        const json = await res.json()
        setNews(Array.isArray(json) ? json : json.news ?? defaultNews)
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  const filtered =
    activeTab === 'All'
      ? news
      : news.filter((a) => a.category === activeTab)

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-sky-600" />
          <CardTitle className="text-base">Market News</CardTitle>
        </div>
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
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Loading news...
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No news in this category
                    </div>
                  ) : (
                    filtered.map((article) => {
                      const sent = sentimentConfig[article.sentiment]
                      const SentIcon = sent.icon
                      return (
                        <article
                          key={article.id}
                          className="rounded-lg border p-3 transition-colors hover:bg-muted/30"
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <h4 className="text-sm font-medium leading-snug">
                              {article.title}
                            </h4>
                            <Badge
                              className={`shrink-0 ${categoryColor[article.category]}`}
                            >
                              {article.category}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{article.source}</span>
                            <span>·</span>
                            <span>{formatTime(article.time)}</span>
                            <span>·</span>
                            <span className={`flex items-center gap-1 ${sent.color}`}>
                              <SentIcon className="h-3 w-3" />
                              {article.sentiment}
                            </span>
                          </div>
                          {article.symbols.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {article.symbols.map((sym) => (
                                <Badge key={sym} variant="outline" className="text-xs">
                                  {sym}
                                </Badge>
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
  )
}
