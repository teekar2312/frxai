'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  BarChart3,
  Activity,
  Globe,
} from 'lucide-react'

interface SentimentSnapshot {
  id: string
  symbol: string
  overallScore: number
  articleCount: number
  positiveCount: number
  negativeCount: number
  neutralCount: number
  sentimentRegime: string
  confidence: number
  weightedScore: number
  topPositiveWords: string
  topNegativeWords: string
  sectorBreakdown: string
  timestamp: string
}

// Fix #12: topBullish/topBearish are string arrays from API, not objects
interface MarketStats {
  totalSnapshots: number
  latestMarket: SentimentSnapshot | null
  topBullish: string[]
  topBearish: string[]
  avgConfidence: number
  regimeDistribution: Record<string, number>
}

function regimeColor(regime: string): string {
  switch (regime) {
    case 'BULLISH': return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    case 'BEARISH': return 'bg-red-500/10 text-red-600 border-red-500/20'
    case 'EXTREME_FEAR': return 'bg-red-700/10 text-red-700 border-red-700/20'
    case 'EXTREME_GREED': return 'bg-orange-500/10 text-orange-600 border-orange-500/20'
    default: return 'bg-slate-500/10 text-slate-600 border-slate-500/20'
  }
}

function regimeIcon(regime: string) {
  switch (regime) {
    case 'BULLISH': return <TrendingUp className="h-4 w-4" />
    case 'BEARISH': return <TrendingDown className="h-4 w-4" />
    case 'EXTREME_FEAR': return <ShieldAlert className="h-4 w-4" />
    case 'EXTREME_GREED': return <AlertTriangle className="h-4 w-4" />
    default: return <Minus className="h-4 w-4" />
  }
}

function scoreBarColor(score: number): string {
  if (score > 50) return 'bg-emerald-500'
  if (score > 20) return 'bg-emerald-400'
  if (score > -20) return 'bg-slate-400'
  if (score > -50) return 'bg-red-400'
  return 'bg-red-500'
}

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) : fallback } catch { return fallback }
}

export default function SentimentFilter() {
  const [stats, setStats] = useState<MarketStats | null>(null)
  const [snapshots, setSnapshots] = useState<SentimentSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, snapRes] = await Promise.all([
        fetch('/api/sentiment/snapshot?stats=true'),
        fetch('/api/sentiment/snapshot?market=true'),
      ])
      if (statsRes.ok) {
        const json = await statsRes.json()
        if (json.success) setStats(json.data)
      }
      if (snapRes.ok) {
        const json = await snapRes.json()
        if (json.success && json.data) {
          setSnapshots(prev => {
            const exists = prev.some(s => s.id === json.data.id)
            if (exists) return prev
            return [json.data, ...prev]
          })
        }
      }
      // Also fetch per-symbol snapshots from seed data
      const symbolRes = await fetch('/api/sentiment/snapshot?symbol=BBCA')
      if (symbolRes.ok) {
        const json = await symbolRes.json()
        if (json.success && json.data) {
          setSnapshots(prev => {
            const ids = new Set(prev.map(s => s.id))
            if (ids.has(json.data.id)) return prev
            return [...prev, json.data]
          })
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const marketSnap = stats?.latestMarket

  return (
    <div className="space-y-6">
      {/* Market Overview */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" /> Market Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> Loading...
              </div>
            ) : marketSnap ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge className={regimeColor(marketSnap.sentimentRegime)} variant="outline">
                    {regimeIcon(marketSnap.sentimentRegime)}
                    <span className="ml-1.5">{marketSnap.sentimentRegime}</span>
                  </Badge>
                  <span className="text-2xl font-bold">{marketSnap.overallScore > 0 ? '+' : ''}{marketSnap.overallScore.toFixed(1)}</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Score</span>
                    <span>{marketSnap.overallScore.toFixed(1)} / 100</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${scoreBarColor(marketSnap.overallScore)}`}
                      style={{ width: `${Math.abs(marketSnap.overallScore)}%`, marginLeft: marketSnap.overallScore < 0 ? 'auto' : 0, marginRight: marketSnap.overallScore < 0 ? 0 : 'auto' }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-emerald-500/10 p-2">
                    <div className="text-lg font-semibold text-emerald-600">{marketSnap.positiveCount}</div>
                    <div className="text-[10px] text-muted-foreground">Positive</div>
                  </div>
                  <div className="rounded-lg bg-slate-500/10 p-2">
                    <div className="text-lg font-semibold text-slate-600">{marketSnap.neutralCount}</div>
                    <div className="text-[10px] text-muted-foreground">Neutral</div>
                  </div>
                  <div className="rounded-lg bg-red-500/10 p-2">
                    <div className="text-lg font-semibold text-red-600">{marketSnap.negativeCount}</div>
                    <div className="text-[10px] text-muted-foreground">Negative</div>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Confidence: {marketSnap.confidence}%</span>
                  <span>{marketSnap.articleCount} articles</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No market sentiment data yet</p>
            )}
          </CardContent>
        </Card>

        {/* Top Bullish / Bearish */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Top Movers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] text-emerald-600 font-medium mb-1.5">MOST BULLISH</div>
                {(stats?.topBullish ?? []).length > 0 ? (
                  stats!.topBullish.slice(0, 3).map(sym => (
                    <div key={sym} className="flex justify-between items-center py-1">
                      <span className="text-xs font-mono">{sym}</span>
                      <Badge variant="outline" className="text-emerald-600 text-[10px] h-5">
                        Bullish
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-muted-foreground">No data</p>
                )}
              </div>
              <div className="border-t" />
              <div>
                <div className="text-[10px] text-red-600 font-medium mb-1.5">MOST BEARISH</div>
                {(stats?.topBearish ?? []).length > 0 ? (
                  stats!.topBearish.slice(0, 3).map(sym => (
                    <div key={sym} className="flex justify-between items-center py-1">
                      <span className="text-xs font-mono">{sym}</span>
                      <Badge variant="outline" className="text-red-600 text-[10px] h-5">
                        Bearish
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-muted-foreground">No data</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Regime Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" /> Regime Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.regimeDistribution && Object.keys(stats.regimeDistribution).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(stats.regimeDistribution).map(([regime, count]) => (
                  <div key={regime} className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] h-5 ${regimeColor(regime)}`}>
                      {regime.replace('_', ' ')}
                    </Badge>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${regime === 'BULLISH' || regime === 'EXTREME_GREED' ? 'bg-emerald-500' : regime === 'BEARISH' || regime === 'EXTREME_FEAR' ? 'bg-red-500' : 'bg-slate-400'}`}
                        style={{ width: `${Math.min(100, (count / Math.max(stats.totalSnapshots, 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono w-6 text-right">{count}</span>
                  </div>
                ))}
                <div className="text-[10px] text-muted-foreground pt-1">
                  Avg confidence: {stats.avgConfidence?.toFixed(0) ?? 0}% · {stats.totalSnapshots} snapshots
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No regime data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Symbol Grid */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Symbol Sentiment Grid</CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={fetchData}>
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {snapshots.filter(s => s.symbol !== 'MARKET').length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {snapshots.filter(s => s.symbol !== 'MARKET').map(snap => {
                const positiveWords: string[] = safeJsonParse(snap.topPositiveWords, [])
                const negativeWords: string[] = safeJsonParse(snap.topNegativeWords, [])
                return (
                  <div key={snap.id} className={`rounded-lg border p-3 ${regimeColor(snap.sentimentRegime)}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold font-mono">{snap.symbol}</span>
                      <Badge variant="outline" className="text-[10px] h-5">
                        {regimeIcon(snap.sentimentRegime)}
                        {snap.sentimentRegime.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="text-xl font-bold mb-1">
                      {snap.overallScore > 0 ? '+' : ''}{snap.overallScore.toFixed(1)}
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full ${scoreBarColor(snap.overallScore)}`}
                        style={{ width: `${Math.abs(snap.overallScore)}%` }}
                      />
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {positiveWords.slice(0, 2).map(w => (
                        <Badge key={w} variant="outline" className="text-[9px] h-4 text-emerald-600">{w}</Badge>
                      ))}
                      {negativeWords.slice(0, 2).map(w => (
                        <Badge key={w} variant="outline" className="text-[9px] h-4 text-red-600">{w}</Badge>
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                      {snap.articleCount} articles · {snap.confidence}% conf
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-muted-foreground">
              {loading ? 'Loading sentiment data...' : 'No symbol sentiment data. Fetch news first.'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fix #15: Live Trade Filter Demo */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Live Trade Filter Test</CardTitle>
        </CardHeader>
        <CardContent>
          <TradeFilterDemo />
        </CardContent>
      </Card>

      {/* Filter Rules Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Sentiment Filter Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <div><span className="font-medium">EXTREME_FEAR / EXTREME_GREED:</span> All trades blocked. System avoids buying into panic or shorting into euphoria.</div>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
              <div><span className="font-medium">Counter-sentiment trades:</span> 50% position size reduction. Buying when symbol score &lt; -40 or selling when &gt; +40.</div>
            </div>
            <div className="flex items-start gap-2">
              <Activity className="h-4 w-4 text-slate-600 mt-0.5 shrink-0" />
              <div><span className="font-medium">Low confidence (&lt;20%):</span> Warning issued but trade allowed. Sentiment data may be unreliable.</div>
            </div>
            <div className="flex items-start gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div><span className="font-medium">Aligned trades:</span> Full size allowed when trade direction matches sentiment (BUY + bullish or SELL + bearish).</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          Error: {error}
        </div>
      )}
    </div>
  )
}

// Fix #15: Live trade filter demo component
interface SentimentFilterResultData {
  shouldBlock: boolean
  blockReason?: string
  sizeAdjustment: number
  regime: string
  symbolScore: number
  marketScore: number
  confidence: number
  warnings: string[]
}

function TradeFilterDemo() {
  const [symbol, setSymbol] = useState('BBCA')
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY')
  const [result, setResult] = useState<SentimentFilterResultData | null>(null)
  const [testing, setTesting] = useState(false)

  const testFilter = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/sentiment/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, direction }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.success) setResult(json.data)
      }
    } catch { /* ignore */ }
    setTesting(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          className="h-8 w-24 rounded-md border bg-background px-2 text-xs font-mono"
          value={symbol}
          onChange={e => setSymbol(e.target.value.toUpperCase())}
          placeholder="Symbol"
        />
        <Button
          size="sm"
          variant={direction === 'BUY' ? 'default' : 'destructive'}
          className={"h-8 text-xs " + (direction === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
          onClick={() => setDirection(d => d === 'BUY' ? 'SELL' : 'BUY')}
        >{direction}</Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={testFilter} disabled={testing}>
          <ShieldAlert className="h-3 w-3" />
          {testing ? 'Testing...' : 'Test Filter'}
        </Button>
      </div>
      {result && (
        <div className={`rounded-lg border p-3 space-y-2 ${result.shouldBlock ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'}`}>
          <div className="flex items-center gap-2">
            {result.shouldBlock ? <ShieldAlert className="h-4 w-4 text-red-600" /> : <Activity className="h-4 w-4 text-emerald-600" />}
            <span className="text-xs font-medium">{result.shouldBlock ? 'BLOCKED' : 'ALLOWED'}: {direction} {symbol}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            <div>Symbol Score: <span className="font-mono font-medium">{result.symbolScore.toFixed(1)}</span></div>
            <div>Market Score: <span className="font-mono font-medium">{result.marketScore.toFixed(1)}</span></div>
            <div>Regime: <span className="font-mono font-medium">{result.regime}</span></div>
            <div>Size Adj: <span className="font-mono font-medium">{(result.sizeAdjustment * 100).toFixed(0)}%</span></div>
          </div>
          {result.blockReason && <p className="text-xs text-red-700">{result.blockReason}</p>}
          {result.warnings.map((w, i) => <p key={i} className="text-[10px] text-amber-700">⚠ {w}</p>)}
        </div>
      )}
    </div>
  )
}
