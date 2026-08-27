'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ShieldAlert, TrendingDown, Activity, Percent, Gauge, AlertTriangle } from 'lucide-react'

interface PositionRisk {
  symbol: string
  direction: 'BUY' | 'SELL'
  lotSize: number
  entryPrice: number
  stopLoss: number
  riskAmount: number
  riskPct: number
  strategy: string
}

interface RiskData {
  dailyPnL: number
  maxDailyLoss: number
  riskPerTrade: number
  totalExposure: number
  marginUsage: number
  currentDrawdown: number
  riskScore: number
  positions: PositionRisk[]
}

const defaultData: RiskData = {
  dailyPnL: 185.5,
  maxDailyLoss: 500,
  riskPerTrade: 0.42,
  totalExposure: 4250,
  marginUsage: 28.5,
  currentDrawdown: 3.2,
  riskScore: 3,
  positions: [
    {
      symbol: 'BBCA',
      direction: 'BUY',
      lotSize: 0.5,
      entryPrice: 9750,
      stopLoss: 9650,
      riskAmount: 50,
      riskPct: 0.5,
      strategy: 'MA Ribbon',
    },
    {
      symbol: 'BBRI',
      direction: 'SELL',
      lotSize: 1.0,
      entryPrice: 5500,
      stopLoss: 5650,
      riskAmount: 150,
      riskPct: 1.5,
      strategy: 'Momentum',
    },
    {
      symbol: 'GOTO',
      direction: 'BUY',
      lotSize: 2.0,
      entryPrice: 79,
      stopLoss: 74,
      riskAmount: 10,
      riskPct: 0.1,
      strategy: 'EMA Cross',
    },
  ],
}

const RISK_RULES = [
  { label: 'Max Risk per Trade', value: '0.5%', icon: Percent },
  { label: 'Max Daily Loss', value: '5%', icon: TrendingDown },
  { label: 'Max Margin Usage', value: '50%', icon: Activity },
  { label: 'Leverage', value: '1:25', icon: Gauge },
]

function getRiskColor(score: number): string {
  if (score <= 3) return 'text-emerald-600'
  if (score <= 6) return 'text-amber-600'
  return 'text-red-600'
}

function getRiskBg(score: number): string {
  if (score <= 3) return 'bg-emerald-50 dark:bg-emerald-950/40'
  if (score <= 6) return 'bg-amber-50 dark:bg-amber-950/40'
  return 'bg-red-50 dark:bg-red-950/40'
}

function getRiskBadge(score: number): 'default' | 'secondary' | 'destructive' {
  if (score <= 3) return 'default'
  if (score <= 6) return 'secondary'
  return 'destructive'
}

function getRiskLabel(score: number): string {
  if (score <= 3) return 'Low'
  if (score <= 6) return 'Medium'
  return 'High'
}

function getProgressColor(value: number, max: number): string {
  const pct = (value / max) * 100
  if (pct < 50) return '[&>div]:bg-emerald-500'
  if (pct < 80) return '[&>div]:bg-amber-500'
  return '[&>div]:bg-red-500'
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

export default function RiskManagement() {
  const [data, setData] = useState<RiskData>(defaultData)
  const [loading, setLoading] = useState(true)

  const fetchRisk = useCallback(async () => {
    try {
      const res = await fetch('/api/risk')
      if (res.ok) {
        const json = await res.json()
        const d = json.data ?? json
        setData({
          dailyPnL: d.currentDailyPnl ?? d.dailyPnL ?? 185.5,
          maxDailyLoss: d.maxDailyLoss ?? 500,
          riskPerTrade: d.riskPerTradePercent ?? d.riskPerTrade ?? 0.42,
          totalExposure: d.totalMarginUsed ?? d.totalExposure ?? 4250,
          marginUsage: d.marginUsagePercent ?? d.marginUsage ?? 28.5,
          currentDrawdown: d.drawdown?.current ?? d.currentDrawdown ?? 3.2,
          riskScore: d.riskScore ?? 3,
          positions: d.positions ?? d.positionSizes?.map((p: Record<string, unknown>) => ({
            symbol: p.symbol,
            direction: p.direction,
            lotSize: p.lotSize,
            entryPrice: 0,
            stopLoss: 0,
            riskAmount: p.margin ?? 0,
            riskPct: p.riskPercent ?? 0,
            strategy: '',
          })) ?? defaultData.positions,
        })
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRisk()
    const interval = setInterval(fetchRisk, 10000)
    return () => clearInterval(interval)
  }, [fetchRisk])

  const dailyPnLPct = Math.min(Math.abs(data.dailyPnL / data.maxDailyLoss) * 100, 100)
  const isDailyLoss = data.dailyPnL < 0
  const marginPct = Math.min(data.marginUsage, 100)
  const drawdownPct = Math.min(data.currentDrawdown, 100)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          Risk Management
        </h2>
        <Badge variant={getRiskBadge(data.riskScore)} className={
          data.riskScore <= 3
            ? 'bg-emerald-600 hover:bg-emerald-700'
            : data.riskScore <= 6
              ? 'bg-amber-600 hover:bg-amber-700'
              : ''
        }>
          Risk Score: {loading ? '—' : data.riskScore}/10
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Risk Score Card */}
        <Card className={`py-4 ${getRiskBg(data.riskScore)}`}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${getRiskBg(data.riskScore)}`}>
              <Gauge className={`h-5 w-5 ${getRiskColor(data.riskScore)}`} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">Risk Level</p>
              <p className={`truncate text-sm font-bold ${getRiskColor(data.riskScore)}`}>
                {loading ? '—' : `${getRiskLabel(data.riskScore)} (${data.riskScore}/10)`}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Risk per Trade */}
        <Card className="py-4">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <Percent className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">Risk / Trade</p>
              <p className={`truncate text-sm font-bold ${data.riskPerTrade <= 0.5 ? 'text-emerald-600' : 'text-red-600'}`}>
                {loading ? '—' : `${data.riskPerTrade}%`}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Total Exposure */}
        <Card className="py-4">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/40">
              <Activity className="h-5 w-5 text-sky-600" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">Total Exposure</p>
              <p className="truncate text-sm font-bold text-sky-600">
                {loading ? '—' : formatCurrency(data.totalExposure)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Current Drawdown */}
        <Card className="py-4">
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${drawdownPct > 10 ? 'bg-red-50 dark:bg-red-950/40' : 'bg-amber-50 dark:bg-amber-950/40'}`}>
              <TrendingDown className={`h-5 w-5 ${drawdownPct > 10 ? 'text-red-600' : 'text-amber-600'}`} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">Drawdown</p>
              <p className={`truncate text-sm font-bold ${drawdownPct > 10 ? 'text-red-600' : 'text-amber-600'}`}>
                {loading ? '—' : `${data.currentDrawdown}%`}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Daily P&L vs Max Loss */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Daily P&L vs Max Daily Loss</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className={isDailyLoss ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'}>
                {isDailyLoss ? 'Loss' : 'Profit'}: {isDailyLoss ? '' : '+'}{formatCurrency(data.dailyPnL)}
              </span>
              <span className="text-muted-foreground">
                Max Loss: {formatCurrency(data.maxDailyLoss)}
              </span>
            </div>
            <Progress value={dailyPnLPct} className={`h-3 ${getProgressColor(Math.abs(data.dailyPnL), data.maxDailyLoss)}`} />
            <p className="text-xs text-muted-foreground">
              {dailyPnLPct >= 100
                ? '⚠️ Daily loss limit reached!'
                : `${((100 - dailyPnLPct) * data.maxDailyLoss / 100).toFixed(2)} remaining before limit`}
            </p>
          </CardContent>
        </Card>

        {/* Margin Usage */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Margin Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className={marginPct > 50 ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'}>
                {data.marginUsage.toFixed(1)}% used
              </span>
              <span className="text-muted-foreground">
                Max: 50%
              </span>
            </div>
            <Progress value={marginPct} className={`h-3 ${getProgressColor(data.marginUsage, 50)}`} />
            <p className="text-xs text-muted-foreground">
              {marginPct > 50
                ? '⚠️ Margin usage exceeds limit!'
                : `${(50 - marginPct).toFixed(1)}% margin available`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Position-Level Risk Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Position-Level Risk Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Lot</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Entry</TableHead>
                  <TableHead className="text-right hidden md:table-cell">SL</TableHead>
                  <TableHead className="text-right">Risk $</TableHead>
                  <TableHead className="text-right">Risk %</TableHead>
                  <TableHead className="hidden lg:table-cell">Strategy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((pos, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-semibold">{pos.symbol}</TableCell>
                    <TableCell>
                      <Badge
                        variant={pos.direction === 'BUY' ? 'default' : 'destructive'}
                        className={pos.direction === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                      >
                        {pos.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono hidden sm:table-cell">
                      {pos.lotSize}
                    </TableCell>
                    <TableCell className="text-right font-mono hidden md:table-cell">
                      {pos.entryPrice.toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell className="text-right font-mono hidden md:table-cell">
                      {pos.stopLoss.toLocaleString('id-ID')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(pos.riskAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-medium ${pos.riskPct <= 0.5 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {pos.riskPct}%
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">{pos.strategy}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.positions.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No open positions
            </div>
          )}
        </CardContent>
      </Card>

      {/* Risk Rules Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Risk Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RISK_RULES.map((rule) => {
              const Icon = rule.icon
              return (
                <div
                  key={rule.label}
                  className="flex flex-col items-center gap-2 rounded-lg border p-3 text-center"
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{rule.label}</p>
                  <p className="text-sm font-bold">{rule.value}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
