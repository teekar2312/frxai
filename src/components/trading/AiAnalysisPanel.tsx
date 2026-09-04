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
  BrainCircuit,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Zap,
  Clock,
  RefreshCw,
  ShieldAlert,
  BarChart3,
  Lock,
  Sparkles,
  Timer,
} from 'lucide-react'

type MarketCondition = 'TRENDING' | 'RANGE_BOUND' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY'
type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL'
type FactorImpact = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'

interface AnalysisFactor {
  name: string
  key: string
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

// Phase 6: Decision Engine types
interface DecisionLog {
  id: string
  symbol: string
  decision: string
  confidence: number
  reasoning: string
  factors: string
  signalSources: string
  riskScore: number
  sentimentScore: number
  volatilityRegime: string
  strategyUsed: string | null
  finalAction: string
  overridden: boolean
  overrideReason: string | null
  createdAt: string
}

const SYMBOLS = ['BBCA', 'BBRI', 'BMRI', 'TLKM', 'ASII', 'UNVR', 'GOTO', 'ICBP', 'ARTO', 'EXCL']

const defaultAnalysis: AnalysisData = {
  condition: 'TRENDING',
  trendDirection: 'BULLISH',
  volatilityLevel: 65,
  confidenceScore: 78,
  factors: [
    { name: 'Central Bank Policy', key: 'centralBankPolicy', score: 75, impact: 'POSITIVE', detail: 'BI maintaining accommodative stance' },
    { name: 'Economic Data', key: 'economicData', score: 60, impact: 'POSITIVE', detail: 'GDP growth above expectations at 5.2%' },
    { name: 'Political / Geopolitical', key: 'politicalGeopolitical', score: 45, impact: 'NEUTRAL', detail: 'Stable domestic political environment' },
    { name: 'Fiscal Policy', key: 'fiscalPolicy', score: 55, impact: 'POSITIVE', detail: 'Government stimulus in infrastructure' },
    { name: 'Commodity Prices', key: 'commodityPrices', score: 70, impact: 'POSITIVE', detail: 'CPO and coal prices trending upward' },
    { name: 'Market Sentiment', key: 'marketSentiment', score: 80, impact: 'POSITIVE', detail: 'Foreign net buying, retail participation up' },
    { name: 'Breaking News', key: 'breakingNews', score: 30, impact: 'NEUTRAL', detail: 'No major breaking news' },
  ],
  recommendations: [
    { action: 'BUY', symbol: 'BBCA', reason: 'Strong uptrend with increasing volume and positive fundamental catalysts.', confidence: 85 },
    { action: 'SELL', symbol: 'ASII', reason: 'Resistance level rejection with declining momentum indicators.', confidence: 72 },
    { action: 'HOLD', symbol: 'TLKM', reason: 'Consolidation phase, wait for breakout confirmation.', confidence: 60 },
  ],
  lastAnalyzed: new Date().toISOString(),
}

const conditionConfig: Record<MarketCondition, { label: string; color: string; bg: string }> = {
  TRENDING: { label: 'Trending', color: 'text-emerald-700', bg: 'bg-emerald-100 dark:bg-emerald-950/50' },
  RANGE_BOUND: { label: 'Range Bound', color: 'text-amber-700', bg: 'bg-amber-100 dark:bg-amber-950/50' },
  HIGH_VOLATILITY: { label: 'High Volatility', color: 'text-red-700', bg: 'bg-red-100 dark:bg-red-950/50' },
  LOW_VOLATILITY: { label: 'Low Volatility', color: 'text-sky-700', bg: 'bg-sky-100 dark:bg-sky-950/50' },
}

const trendIcon = (dir: TrendDirection) => {
  switch (dir) {
    case 'BULLISH': return <TrendingUp className="h-5 w-5 text-emerald-600" />
    case 'BEARISH': return <TrendingDown className="h-5 w-5 text-red-600" />
    default: return <Minus className="h-5 w-5 text-amber-600" />
  }
}

const impactBadge = (impact: FactorImpact) => {
  switch (impact) {
    case 'POSITIVE': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400"><ArrowUpRight className="h-3 w-3" />Positive</Badge>
    case 'NEGATIVE': return <Badge variant="destructive"><ArrowDownRight className="h-3 w-3" />Negative</Badge>
    default: return <Badge variant="outline"><ArrowRight className="h-3 w-3" />Neutral</Badge>
  }
}

const actionColor: Record<string, string> = {
  BUY: 'bg-emerald-600 hover:bg-emerald-700',
  SELL: 'bg-red-600 hover:bg-red-700',
  HOLD: 'bg-amber-600 hover:bg-amber-700',
  SKIP: 'bg-slate-600 hover:bg-slate-700',
}

const decisionColor: Record<string, string> = {
  BUY: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/50',
  SELL: 'text-red-600 bg-red-100 dark:bg-red-950/50',
  HOLD: 'text-amber-600 bg-amber-100 dark:bg-amber-950/50',
  SKIP: 'text-slate-600 bg-slate-100 dark:bg-slate-950/50',
  REDUCE: 'text-orange-600 bg-orange-100 dark:bg-orange-950/50',
  CLOSE_ALL: 'text-red-700 bg-red-100 dark:bg-red-950/50',
}

function factorBar(score: number, label: string) {
  const abs = Math.abs(score)
  const color = score > 30 ? 'bg-emerald-500' : score > 0 ? 'bg-emerald-400' : score > -30 ? 'bg-red-400' : 'bg-red-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{score > 0 ? '+' : ''}{score.toFixed(0)}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${abs}%` }} />
      </div>
    </div>
  )
}

export default function AiAnalysisPanel() {
  const [data, setData] = useState<AnalysisData>(defaultAnalysis)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)

  // Phase 6: Decision Engine state
  const [selectedSymbol, setSelectedSymbol] = useState('BBCA')
  const [deciding, setDeciding] = useState(false)
  const [decisionHistory, setDecisionHistory] = useState<DecisionLog[]>([])
  const [accuracy, setAccuracy] = useState<{ totalDecisions: number; winRate: number; avgConfidence: number } | null>(null)
  const [lastLlmEnhancement, setLastLlmEnhancement] = useState<{
    used: boolean
    provider: string | null
    model: string | null
    latencyMs: number | null
    llmAction: string | null
    llmConfidence: number | null
    llmReasoning: string | null
    llmKeyFactors: Array<{ name: string; impact: string; score: number; detail: string }> | null
    llmRiskAssessment: string | null
    error: string | null
    usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null
  } | null>(null)

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
      }
    } catch { /* use default */ }
    finally { setLoading(false) }
  }, [])

  const fetchDecisionHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/decide')
      if (res.ok) {
        const json = await res.json()
        if (json.success) setDecisionHistory(json.data)
      }
    } catch { /* ignore */ }
  }, [])

  const fetchAccuracy = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/accuracy')
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data.accuracy) setAccuracy(json.data.accuracy)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchAnalysis()
    fetchDecisionHistory()
    fetchAccuracy()
  }, [fetchAnalysis, fetchDecisionHistory, fetchAccuracy])

  const handleRunAnalysis = async () => {
    setAnalyzing(true)
    try {
      const res = await fetch('/api/analysis', { method: 'POST' })
      if (res.ok) setData(await res.json())
    } catch { /* keep existing */ }
    finally { setAnalyzing(false) }
  }

  const handleMakeDecision = async () => {
    setDeciding(true)
    try {
      const res = await fetch('/api/ai/enhanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.success) {
          // Store LLM enhancement data
          if (json.data?.llmEnhancement) {
            const llm = json.data.llmEnhancement
            setLastLlmEnhancement({
              used: llm.used,
              provider: llm.provider,
              model: llm.model,
              latencyMs: llm.latencyMs,
              llmAction: llm.llmAction,
              llmConfidence: llm.llmConfidence,
              llmReasoning: llm.llmReasoning,
              llmKeyFactors: llm.llmKeyFactors,
              llmRiskAssessment: llm.llmRiskAssessment,
              error: llm.error,
              usage: llm.usage,
            })
          }
          await fetchDecisionHistory()
          await fetchAccuracy()
        }
      }
    } catch { /* ignore */ }
    finally { setDeciding(false) }
  }

  const condCfg = conditionConfig[data.condition]
  const timestamp = data.lastAnalyzed ? new Date(data.lastAnalyzed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'

  return (
    <div className="space-y-4">
      {/* Original AI Market Analysis Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-violet-600" />
              <CardTitle className="text-base">AI Market Analysis</CardTitle>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{timestamp}</span>
              <Button size="sm" onClick={handleRunAnalysis} disabled={analyzing} className="gap-1.5">
                <Zap className={`h-3.5 w-3.5 ${analyzing ? 'animate-pulse' : ''}`} />{analyzing ? 'Analyzing...' : 'Run Analysis'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading analysis...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="mb-1 text-xs text-muted-foreground">Market Condition</p>
                  <Badge className={`${condCfg.bg} ${condCfg.color}`}>{condCfg.label}</Badge>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-1 text-xs text-muted-foreground">Trend Direction</p>
                  <div className="flex items-center gap-2">{trendIcon(data.trendDirection)}<span className="text-sm font-semibold">{data.trendDirection}</span></div>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-1 text-xs text-muted-foreground">Volatility</p>
                  <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-orange-500" /><Progress value={data.volatilityLevel} className="h-2 flex-1" /><span className="text-xs font-medium">{data.volatilityLevel}%</span></div>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">AI Confidence Score</p>
                  <span className={`text-sm font-bold ${data.confidenceScore >= 70 ? 'text-emerald-600' : data.confidenceScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{data.confidenceScore}%</span>
                </div>
                <Progress value={data.confidenceScore} className="h-3" />
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold">Analysis Factors</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {data.factors.map((factor, i) => (
                    <div key={factor.key ?? `factor-${i}`} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0"><p className="text-sm font-medium">{factor.name}</p><p className="truncate text-xs text-muted-foreground">{factor.detail}</p></div>
                      <div className="flex shrink-0 flex-col items-end gap-1">{impactBadge(factor.impact)}<span className="text-xs font-mono text-muted-foreground">{factor.score}</span></div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold">AI Recommendations</p>
                <div className="space-y-2">
                  {data.recommendations.map((rec, idx) => (
                    <div key={idx} className="flex items-start gap-3 rounded-lg border p-3">
                      <Badge className={`${actionColor[rec.action] || ''} shrink-0`}>{rec.action}</Badge>
                      <div className="min-w-0"><p className="text-sm font-semibold">{rec.symbol}</p><p className="text-xs text-muted-foreground">{rec.reason}</p></div>
                      <span className={`shrink-0 text-xs font-medium ${rec.confidence >= 70 ? 'text-emerald-600' : rec.confidence >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{rec.confidence}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Phase 6: AI Decision Engine Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-violet-600" />
              <CardTitle className="text-base">AI Decision Engine</CardTitle>
              {accuracy && (
                <Badge variant="outline" className="text-[10px] h-5">
                  {accuracy.totalDecisions} decisions · {accuracy.winRate.toFixed(0)}% win · avg conf {accuracy.avgConfidence.toFixed(0)}%
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Symbol Selector + Decide Button */}
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap gap-1 flex-1">
              {SYMBOLS.map(sym => (
                <Button
                  key={sym} variant={selectedSymbol === sym ? 'default' : 'outline'}
                  size="sm" className="h-7 text-xs px-2"
                  onClick={() => setSelectedSymbol(sym)}
                >{sym}</Button>
              ))}
            </div>
            <Button size="sm" onClick={handleMakeDecision} disabled={deciding} className="gap-1.5 h-7 shrink-0">
              <Sparkles className={`h-3 w-3 ${deciding ? 'animate-pulse' : ''}`} />
              {deciding ? 'Analyzing...' : 'AI Analyze'}
            </Button>
          </div>

          {/* Latest Decision Detail */}
          {decisionHistory.length > 0 && (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold font-mono">{decisionHistory[0].symbol}</span>
                  <Badge className={decisionColor[decisionHistory[0].decision] || ''}>{decisionHistory[0].decision}</Badge>
                  {decisionHistory[0].overridden && (
                    <Badge variant="outline" className="text-orange-600 text-[10px] h-5 gap-1">
                      <Lock className="h-3 w-3" />Override
                    </Badge>
                  )}
                </div>
                <span className={`text-lg font-bold ${decisionHistory[0].confidence >= 65 ? 'text-emerald-600' : decisionHistory[0].confidence >= 45 ? 'text-amber-600' : 'text-red-600'}`}>
                  {decisionHistory[0].confidence}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{decisionHistory[0].reasoning}</p>

              {/* Factor Bars */}
              {(() => {
                try {
                  const factors = typeof decisionHistory[0].factors === 'string' ? JSON.parse(decisionHistory[0].factors) : decisionHistory[0].factors
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      {factors.technical && factorBar(factors.technical.overallScore ?? 0, 'Technical')}
                      {factors.news && factorBar(factors.news.impactScore ?? 0, 'News')}
                      {factors.sentiment && factorBar(factors.sentiment.score ?? 0, 'Sentiment')}
                      {factors.risk && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Risk</span>
                            <span className="font-mono">{factors.risk.score.toFixed(1)}/10</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full ${factors.risk.score > 6 ? 'bg-red-500' : factors.risk.score > 4 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${factors.risk.score * 10}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                } catch { return null }
              })()}

              {/* Signal Sources */}
              {(() => {
                try {
                  const sources: string[] = typeof decisionHistory[0].signalSources === 'string' ? JSON.parse(decisionHistory[0].signalSources) : decisionHistory[0].signalSources
                  if (!Array.isArray(sources) || sources.length === 0) return null
                  return (
                    <div className="flex flex-wrap gap-1">
                      {sources.map((s, i) => <Badge key={`${i}-${String(s)}`} variant="outline" className="text-[10px] h-5">{s}</Badge>)}
                    </div>
                  )
                } catch { return null }
              })()}

              {/* Meta info */}
              <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                <span>Risk: {decisionHistory[0].riskScore}/10</span>
                <span>Sentiment: {decisionHistory[0].sentimentScore}</span>
                <span>Vol: {decisionHistory[0].volatilityRegime}</span>
                {decisionHistory[0].strategyUsed && <span>Strategy: {decisionHistory[0].strategyUsed}</span>}
                <span>{new Date(decisionHistory[0].createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {/* LLM Enhancement Section */}
              {lastLlmEnhancement && (
                <div className={
                  'rounded-lg border p-3 space-y-2 ' +
                  (lastLlmEnhancement.used
                    ? 'border-violet-200 bg-violet-50/30 dark:border-violet-800 dark:bg-violet-950/20'
                    : 'border-border')
                }>
                  <div className="flex items-center gap-2">
                    <Sparkles className={"h-3.5 w-3.5 " + (lastLlmEnhancement.used ? "text-violet-500" : "text-muted-foreground")} />
                    <span className="text-xs font-semibold">LLM Analysis</span>
                    {lastLlmEnhancement.used && lastLlmEnhancement.provider && (
                      <Badge variant="outline" className="text-[10px] h-5 gap-1">
                        {lastLlmEnhancement.provider}
                        {lastLlmEnhancement.model && <span className="text-muted-foreground">/ {lastLlmEnhancement.model.split('/').pop()}</span>}
                      </Badge>
                    )}
                    {lastLlmEnhancement.used && lastLlmEnhancement.latencyMs != null && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Timer className="h-2.5 w-2.5" />{lastLlmEnhancement.latencyMs}ms
                      </span>
                    )}
                    {lastLlmEnhancement.used && lastLlmEnhancement.llmAction && (
                      <Badge className={
                        'text-[10px] h-5 ml-auto ' +
                        (lastLlmEnhancement.llmAction === 'BUY' ? 'bg-emerald-600' : lastLlmEnhancement.llmAction === 'SELL' ? 'bg-red-600' : 'bg-slate-600')
                      }>
                        LLM: {lastLlmEnhancement.llmAction}
                        {lastLlmEnhancement.llmConfidence != null && ` (${lastLlmEnhancement.llmConfidence}%)`}
                      </Badge>
                    )}
                  </div>

                  {/* LLM Key Factors */}
                  {lastLlmEnhancement.used && lastLlmEnhancement.llmKeyFactors && lastLlmEnhancement.llmKeyFactors.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {lastLlmEnhancement.llmKeyFactors.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className={
                            'h-1.5 w-1.5 rounded-full shrink-0 ' +
                            (f.impact === 'POSITIVE' ? 'bg-emerald-500' : f.impact === 'NEGATIVE' ? 'bg-red-500' : 'bg-amber-500')
                          } />
                          <span className="font-medium truncate">{f.name}</span>
                          <span className="text-muted-foreground truncate">{f.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* LLM Reasoning */}
                  {lastLlmEnhancement.used && lastLlmEnhancement.llmReasoning && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{lastLlmEnhancement.llmReasoning}</p>
                  )}

                  {/* LLM Risk Assessment */}
                  {lastLlmEnhancement.used && lastLlmEnhancement.llmRiskAssessment && (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium">Risk:</span> {lastLlmEnhancement.llmRiskAssessment}
                    </p>
                  )}

                  {/* Token Usage */}
                  {lastLlmEnhancement.used && lastLlmEnhancement.usage && (
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span>Prompt: {lastLlmEnhancement.usage.promptTokens}</span>
                      <span>Completion: {lastLlmEnhancement.usage.completionTokens}</span>
                      <span>Total: {lastLlmEnhancement.usage.totalTokens}</span>
                    </div>
                  )}

                  {/* Error */}
                  {!lastLlmEnhancement.used && lastLlmEnhancement.error && (
                    <p className="text-[11px] text-amber-600">LLM tidak tersedia: {lastLlmEnhancement.error}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Decision History */}
          {decisionHistory.length > 1 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Decision History</p>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={fetchDecisionHistory}>
                  <RefreshCw className="h-3 w-3" /> Refresh
                </Button>
              </div>
              <ScrollArea className="max-h-60 overflow-y-auto">
                <div className="space-y-1.5 pr-2">
                  {decisionHistory.slice(1, 15).map(d => (
                    <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
                      <span className="font-mono font-medium w-12">{d.symbol}</span>
                      <Badge className={`text-[10px] h-5 ${decisionColor[d.decision] || ''}`}>{d.decision}</Badge>
                      <span className={`font-mono ${d.confidence >= 65 ? 'text-emerald-600' : d.confidence >= 45 ? 'text-amber-600' : 'text-red-600'}`}>{d.confidence}%</span>
                      <span className="text-muted-foreground flex-1 truncate">{d.reasoning}</span>
                      <span className="text-muted-foreground shrink-0">{new Date(d.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      {d.overridden && <ShieldAlert className="h-3 w-3 text-orange-500 shrink-0" />}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
