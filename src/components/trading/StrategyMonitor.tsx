'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { BrainCircuit, TrendingUp, TrendingDown, Minus, Pause, Play, Clock } from 'lucide-react'

type SignalType = 'BUY' | 'SELL' | 'HOLD'
type StrategyStatus = 'Active' | 'Paused'

interface StrategyInfo {
  id: string
  name: string
  description: string
  status: StrategyStatus
  signal: SignalType
  confidence: number
  activeSymbol: string
  lastSignalTime: string
}

/** Raw strategy object returned by GET /api/strategies (data.strategies[]). */
interface ApiStrategy {
  id: string
  name: string
  description: string
  enabled: boolean
  currentSignal: 'BUY' | 'SELL' | 'NEUTRAL'
  confidence: number
  lastUpdated: string
  symbols?: Array<{ symbol: string; signal: string; confidence: number }>
}

/** Map the API payload into the shape this component renders. */
function toStrategyInfo(s: ApiStrategy, fallbackSymbol: string): StrategyInfo {
  // First symbol with a non-neutral signal, else the strongest-confidence entry,
  // else the endpoint's primary symbol.
  const perSymbol = Array.isArray(s.symbols) ? s.symbols : []
  const signalSymbol =
    perSymbol.find((x) => x.signal === 'BUY' || x.signal === 'SELL')?.symbol ??
    perSymbol[0]?.symbol ??
    fallbackSymbol

  const time = new Date(s.lastUpdated)
  const lastSignalTime = Number.isNaN(time.getTime())
    ? '--'
    : time.toLocaleTimeString('id-ID', { hour12: false })

  return {
    id: s.id,
    name: s.name,
    description: s.description,
    status: s.enabled ? 'Active' : 'Paused',
    signal: s.currentSignal === 'BUY' ? 'BUY' : s.currentSignal === 'SELL' ? 'SELL' : 'HOLD',
    confidence: typeof s.confidence === 'number' ? Math.round(s.confidence) : 0,
    activeSymbol: signalSymbol,
    lastSignalTime,
  }
}


function getSignalBadge(signal: SignalType) {
  switch (signal) {
    case 'BUY':
      return <Badge className="bg-emerald-600 hover:bg-emerald-700 gap-1"><TrendingUp className="h-3 w-3" /> BUY</Badge>
    case 'SELL':
      return <Badge variant="destructive" className="gap-1"><TrendingDown className="h-3 w-3" /> SELL</Badge>
    case 'HOLD':
      return <Badge variant="outline" className="gap-1 text-muted-foreground"><Minus className="h-3 w-3" /> HOLD</Badge>
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 70) return '[&>div]:bg-emerald-500'
  if (confidence >= 50) return '[&>div]:bg-amber-500'
  return '[&>div]:bg-red-500'
}

export default function StrategyMonitor() {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([])
  const [, setLoading] = useState(true)
  const [visible, setVisible] = useState(true)

  const abortRef = useRef<AbortController | null>(null)

  const fetchStrategies = useCallback(async () => {
    try {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const res = await fetch('/api/strategies', { signal: controller.signal })
      if (res.ok) {
        const json = await res.json()
        // The endpoint returns { data: { strategies: [...], summary, ... } }.
        // Guard with Array.isArray so an unexpected shape degrades to the
        // previous data instead of crashing render
        // (fix: "strategies.filter is not a function").
        const raw = json?.data?.strategies
        const primarySymbol = json?.data?.dataInfo?.symbol ?? 'BBCA'
        if (Array.isArray(raw)) {
          setStrategies(raw.map((s: ApiStrategy) => toStrategyInfo(s, primarySymbol)))
        }
        // non-array / malformed → keep stale data (initial state is [])
      }
    } catch {
      // use stale data
    } finally {
      setLoading(false)
    }
  }, [])

  // Track tab visibility in state so the polling effect re-runs when the tab
  // becomes visible again (the old handler cleared the interval and never
  // restarted it — polling died permanently after a tab switch).
  useEffect(() => {
    const handleVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    if (!visible) return
    fetchStrategies()
    const interval = setInterval(fetchStrategies, 10000)
    return () => clearInterval(interval)
  }, [fetchStrategies, visible])

  const activeCount = strategies.filter((s) => s.status === 'Active').length
  const buyCount = strategies.filter((s) => s.signal === 'BUY').length
  const sellCount = strategies.filter((s) => s.signal === 'SELL').length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-violet-500" />
          Strategy Monitor
        </h2>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            {activeCount} Active
          </Badge>
          <Badge className="bg-emerald-600 hover:bg-emerald-700">
            {buyCount} BUY
          </Badge>
          <Badge variant="destructive">
            {sellCount} SELL
          </Badge>
        </div>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {strategies.map((strategy) => (
          <AccordionItem
            key={strategy.id}
            value={strategy.id}
            className="rounded-lg border bg-card px-4"
          >
            <AccordionTrigger className="hover:no-underline py-4">
              <div className="flex flex-1 items-center gap-3 pr-2">
                {/* Status indicator */}
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${strategy.status === 'Active' ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-muted'}`}>
                  {strategy.status === 'Active' 
                    ? <Play className="h-4 w-4 text-emerald-600" />
                    : <Pause className="h-4 w-4 text-muted-foreground" />
                  }
                </div>

                <div className="flex flex-1 flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{strategy.name}</span>
                    {getSignalBadge(strategy.signal)}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {strategy.status === 'Active' && (
                      <>
                        <span className="font-medium">{strategy.activeSymbol}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {strategy.lastSignalTime.split(' ')[1] ?? strategy.lastSignalTime}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Confidence bar - inline on trigger */}
                {strategy.status === 'Active' && (
                  <div className="hidden sm:flex flex-col items-end gap-1 min-w-[100px]">
                    <span className={`text-xs font-medium ${strategy.confidence >= 70 ? 'text-emerald-600' : strategy.confidence >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                      {strategy.confidence}%
                    </span>
                    <Progress value={strategy.confidence} className={`h-1.5 w-24 ${getConfidenceColor(strategy.confidence)}`} />
                  </div>
                )}
              </div>
            </AccordionTrigger>

            <AccordionContent>
              <Card className="border-0 shadow-none">
                <CardContent className="p-4 pt-0">
                  <div className="space-y-4">
                    {/* Description */}
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {strategy.description}
                    </p>

                    {/* Details grid */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Status</p>
                        <Badge variant={strategy.status === 'Active' ? 'default' : 'outline'} className={strategy.status === 'Active' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}>
                          {strategy.status}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Current Signal</p>
                        {getSignalBadge(strategy.signal)}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Confidence</p>
                        <div className="flex items-center gap-2">
                          <Progress value={strategy.confidence} className={`h-2 flex-1 ${getConfidenceColor(strategy.confidence)}`} />
                          <span className={`text-xs font-bold ${strategy.confidence >= 70 ? 'text-emerald-600' : strategy.confidence >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                            {strategy.confidence}%
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Active Symbol</p>
                        <p className="text-sm font-medium">{strategy.activeSymbol}</p>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last signal: {strategy.lastSignalTime} WIB
                    </div>
                  </div>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
