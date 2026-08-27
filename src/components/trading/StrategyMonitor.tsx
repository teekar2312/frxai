'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

const STRATEGY_DEFINITIONS: Omit<StrategyInfo, 'status' | 'signal' | 'confidence' | 'activeSymbol' | 'lastSignalTime'>[] = [
  {
    id: 'ma-ribbon',
    name: 'Moving Average Ribbon',
    description: 'Uses 5-8-13 SMA ribbon to identify trend direction and momentum shifts. Entry on ribbon expansion with price alignment.',
  },
  {
    id: 'momentum-scalp',
    name: 'Momentum Scalping',
    description: 'Combines RSI overbought/oversold with MACD histogram crossovers for high-frequency momentum-based entries.',
  },
  {
    id: 'pivot-point',
    name: 'Pivot Point',
    description: 'Calculates daily pivot levels (S1-S3, R1-R3) from previous session high/low/close. Trades bounces and breakouts at key levels.',
  },
  {
    id: 'ema-cross',
    name: 'EMA Crossover',
    description: '9/21 EMA crossover system. BUY on golden cross, SELL on death cross with confirmation filters.',
  },
  {
    id: 'rmi-trend',
    name: 'RMI Trend Sync',
    description: 'Relative Momentum Index synced with ADX trend strength. Only enters when RMI and ADX confirm the same direction.',
  },
  {
    id: 'lin-reg',
    name: 'Linear Regression Channels',
    description: 'Fits linear regression channels to price data. Trades mean reversion within channels and breakouts above/below.',
  },
  {
    id: 'ema-rsi-filter',
    name: 'EMA/RSI Filter',
    description: 'EMA trend direction filtered by RSI confirmation. Uses dynamic stop based on ATR for risk management.',
  },
]

const defaultStrategies: StrategyInfo[] = [
  {
    id: 'ma-ribbon',
    name: 'Moving Average Ribbon',
    description: STRATEGY_DEFINITIONS[0].description,
    status: 'Active',
    signal: 'BUY',
    confidence: 78,
    activeSymbol: 'BBCA',
    lastSignalTime: '2025-01-15 09:32:15',
  },
  {
    id: 'momentum-scalp',
    name: 'Momentum Scalping',
    description: STRATEGY_DEFINITIONS[1].description,
    status: 'Active',
    signal: 'SELL',
    confidence: 65,
    activeSymbol: 'BBRI',
    lastSignalTime: '2025-01-15 10:15:42',
  },
  {
    id: 'pivot-point',
    name: 'Pivot Point',
    description: STRATEGY_DEFINITIONS[2].description,
    status: 'Active',
    signal: 'HOLD',
    confidence: 42,
    activeSymbol: 'TLKM',
    lastSignalTime: '2025-01-15 08:00:00',
  },
  {
    id: 'ema-cross',
    name: 'EMA Crossover',
    description: STRATEGY_DEFINITIONS[3].description,
    status: 'Paused',
    signal: 'HOLD',
    confidence: 0,
    activeSymbol: '—',
    lastSignalTime: '2025-01-14 15:45:30',
  },
  {
    id: 'rmi-trend',
    name: 'RMI Trend Sync',
    description: STRATEGY_DEFINITIONS[4].description,
    status: 'Active',
    signal: 'BUY',
    confidence: 82,
    activeSymbol: 'ASII',
    lastSignalTime: '2025-01-15 09:45:10',
  },
  {
    id: 'lin-reg',
    name: 'Linear Regression Channels',
    description: STRATEGY_DEFINITIONS[5].description,
    status: 'Active',
    signal: 'SELL',
    confidence: 71,
    activeSymbol: 'GOTO',
    lastSignalTime: '2025-01-15 10:05:33',
  },
  {
    id: 'ema-rsi-filter',
    name: 'EMA/RSI Filter',
    description: STRATEGY_DEFINITIONS[6].description,
    status: 'Active',
    signal: 'BUY',
    confidence: 58,
    activeSymbol: 'BMRI',
    lastSignalTime: '2025-01-15 09:58:22',
  },
]

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
  const [strategies, setStrategies] = useState<StrategyInfo[]>(defaultStrategies)
  const [loading, setLoading] = useState(true)

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch('/api/strategies')
      if (res.ok) {
        const json = await res.json()
        setStrategies(Array.isArray(json) ? json : json.strategies ?? defaultStrategies)
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStrategies()
    const interval = setInterval(fetchStrategies, 10000)
    return () => clearInterval(interval)
  }, [fetchStrategies])

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
