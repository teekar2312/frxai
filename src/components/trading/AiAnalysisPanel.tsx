'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  BrainCircuit,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Zap,
  Clock,
} from 'lucide-react'

type MarketCondition =
  | 'TRENDING'
  | 'RANGE_BOUND'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'

type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

type FactorImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'

type FactorKey =
  | 'centralBankPolicy'
  | 'economicData'
  | 'politicalGeopolitical'
  | 'fiscalPolicy'
  | 'commodityPrices'
  | 'marketSentiment'
  | 'breakingNews'

interface AnalysisFactor {
  name: string
  key: FactorKey
  score: number
  impact: FactorImpact
  detail: string
}

interface Recommendation {
  action: 'BUY' | 'SELL' | 'HOLD'
  symbol: string
  reason: string
  confidence: number
}

interface AnalysisData {
  condition: MarketCondition
  trendDirection: TrendDirection
  volatilityLevel: number
  confidenceScore: number
  factors: AnalysisFactor[]
  recommendations: Recommendation[]
  lastAnalyzed: string
}

const defaultAnalysis: AnalysisData = {
  condition: 'TRENDING',
  trendDirection: 'BULLISH',
  volatilityLevel: 65,
  confidenceScore: 78,
  factors: [
    {
      name: 'Central Bank Policy',
      key: 'centralBankPolicy',
      score: 75,
      impact: 'POSITIVE',
      detail: 'BI maintaining accommodative stance',
    },
    {
      name: 'Economic Data (NFP/CPI/GDP)',
      key: 'economicData',
      score: 60,
      impact: 'POSITIVE',
      detail: 'GDP growth above expectations at 5.2%',
    },
    {
      name: 'Political / Geopolitical',
      key: 'politicalGeopolitical',
      score: 45,
      impact: 'NEUTRAL',
      detail: 'Stable domestic political environment',
    },
    {
      name: 'Fiscal Policy',
      key: 'fiscalPolicy',
      score: 55,
      impact: 'POSITIVE',
      detail: 'Government stimulus in infrastructure',
    },
    {
      name: 'Commodity Prices',
      key: 'commodityPrices',
      score: 70,
      impact: 'POSITIVE',
      detail: 'CPO and coal prices trending upward',
    },
    {
      name: 'Market Sentiment',
      key: 'marketSentiment',
      score: 80,
      impact: 'POSITIVE',
      detail: 'Foreign net buying, retail participation up',
    },
    {
      name: 'Breaking News',
      key: 'breakingNews',
      score: 30,
      impact: 'NEUTRAL',
      detail: 'No major breaking news',
    },
  ],
  recommendations: [
    {
      action: 'BUY',
      symbol: 'BBCA',
      reason: 'Strong uptrend with increasing volume and positive fundamental catalysts.',
      confidence: 85,
    },
    {
      action: 'SELL',
      symbol: 'ASII',
      reason: 'Resistance level rejection with declining momentum indicators.',
      confidence: 72,
    },
    {
      action: 'HOLD',
      symbol: 'TLKM',
      reason: 'Consolidation phase, wait for breakout confirmation.',
      confidence: 60,
    },
  ],
  lastAnalyzed: '2025-01-15T10:30:00Z',
}

const conditionConfig: Record<MarketCondition, { label: string; color: string; bg: string }> = {
  TRENDING: { label: 'Trending', color: 'text-emerald-700', bg: 'bg-emerald-100 dark:bg-emerald-950/50' },
  RANGE_BOUND: { label: 'Range Bound', color: 'text-amber-700', bg: 'bg-amber-100 dark:bg-amber-950/50' },
  HIGH_VOLATILITY: { label: 'High Volatility', color: 'text-red-700', bg: 'bg-red-100 dark:bg-red-950/50' },
  LOW_VOLATILITY: { label: 'Low Volatility', color: 'text-sky-700', bg: 'bg-sky-100 dark:bg-sky-950/50' },
}

const trendIcon = (dir: TrendDirection) => {
  switch (dir) {
    case 'BULLISH':
      return <TrendingUp className="h-5 w-5 text-emerald-600" />
    case 'BEARISH':
      return <TrendingDown className="h-5 w-5 text-red-600" />
    default:
      return <Minus className="h-5 w-5 text-amber-600" />
  }
}

const impactBadge = (impact: FactorImpact) => {
  switch (impact) {
    case 'POSITIVE':
      return (
        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400">
          <ArrowUpRight className="h-3 w-3" />
          Positive
        </Badge>
      )
    case 'NEGATIVE':
      return (
        <Badge variant="destructive">
          <ArrowDownRight className="h-3 w-3" />
          Negative
        </Badge>
      )
    default:
      return (
        <Badge variant="outline">
          <ArrowRight className="h-3 w-3" />
          Neutral
        </Badge>
      )
  }
}

const actionColor: Record<string, string> = {
  BUY: 'bg-emerald-600 hover:bg-emerald-700',
  SELL: 'bg-red-600 hover:bg-red-700',
  HOLD: 'bg-amber-600 hover:bg-amber-700',
}

export default function AiAnalysisPanel() {
  const [data, setData] = useState<AnalysisData>(defaultAnalysis)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)

  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await fetch('/api/analysis')
      if (res.ok) {
        const json = await res.json()
        const arr = json.data ?? json
        if (Array.isArray(arr) && arr.length > 0) {
          const latest = arr[0]
          setData({
            condition: (latest.marketCondition as MarketCondition) || 'TRENDING',
            trendDirection: (latest.trendDirection as TrendDirection) || 'NEUTRAL',
            volatilityLevel: latest.volatility ?? 65,
            confidenceScore: latest.confidence ?? 78,
            factors: typeof latest.factors === 'string' ? JSON.parse(latest.factors) : (latest.factors ?? defaultAnalysis.factors),
            recommendations: typeof latest.recommendations === 'string' ? JSON.parse(latest.recommendations) : (latest.recommendations ?? defaultAnalysis.recommendations),
            lastAnalyzed: latest.createdAt ?? new Date().toISOString(),
          })
        }
        // else keep default data
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAnalysis()
  }, [fetchAnalysis])

  const handleRunAnalysis = async () => {
    setAnalyzing(true)
    try {
      const res = await fetch('/api/analysis', { method: 'POST' })
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch {
      // keep existing
    } finally {
      setAnalyzing(false)
    }
  }

  const condCfg = conditionConfig[data.condition]
  const timestamp = data.lastAnalyzed
    ? new Date(data.lastAnalyzed).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'N/A'

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-600" />
            <CardTitle className="text-base">AI Market Analysis</CardTitle>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {timestamp}
            </span>
            <Button
              size="sm"
              onClick={handleRunAnalysis}
              disabled={analyzing}
              className="gap-1.5"
            >
              <Zap className={`h-3.5 w-3.5 ${analyzing ? 'animate-pulse' : ''}`} />
              {analyzing ? 'Analyzing...' : 'Run Analysis'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading analysis...
          </div>
        ) : (
          <>
            {/* Market Condition & Trend */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-xs text-muted-foreground">Market Condition</p>
                <Badge className={`${condCfg.bg} ${condCfg.color}`}>
                  {condCfg.label}
                </Badge>
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-xs text-muted-foreground">Trend Direction</p>
                <div className="flex items-center gap-2">
                  {trendIcon(data.trendDirection)}
                  <span className="text-sm font-semibold">{data.trendDirection}</span>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-xs text-muted-foreground">Volatility</p>
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-orange-500" />
                  <Progress value={data.volatilityLevel} className="h-2 flex-1" />
                  <span className="text-xs font-medium">{data.volatilityLevel}%</span>
                </div>
              </div>
            </div>

            {/* Confidence Score */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">AI Confidence Score</p>
                <span
                  className={`text-sm font-bold ${
                    data.confidenceScore >= 70
                      ? 'text-emerald-600'
                      : data.confidenceScore >= 50
                        ? 'text-amber-600'
                        : 'text-red-600'
                  }`}
                >
                  {data.confidenceScore}%
                </span>
              </div>
              <Progress value={data.confidenceScore} className="h-3" />
            </div>

            {/* Analysis Factors */}
            <div>
              <p className="mb-3 text-sm font-semibold">Analysis Factors</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {data.factors.map((factor) => (
                  <div
                    key={factor.key}
                    className="flex items-start justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{factor.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {factor.detail}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {impactBadge(factor.impact)}
                      <span className="text-xs font-mono text-muted-foreground">
                        {factor.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Recommendations */}
            <div>
              <p className="mb-3 text-sm font-semibold">AI Recommendations</p>
              <div className="space-y-2">
                {data.recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <Badge className={`${actionColor[rec.action] || ''} shrink-0`}>
                      {rec.action}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{rec.symbol}</p>
                      <p className="text-xs text-muted-foreground">{rec.reason}</p>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        rec.confidence >= 70
                          ? 'text-emerald-600'
                          : rec.confidence >= 50
                            ? 'text-amber-600'
                            : 'text-red-600'
                      }`}
                    >
                      {rec.confidence}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
