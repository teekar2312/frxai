'use client'

import { useState, useMemo, useSyncExternalStore } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TrendingUp, TrendingDown, DollarSign, Mountain, ArrowDownToLine } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

type TimeRange = '1D' | '1W' | '1M' | '3M'

interface EquityDataPoint {
  date: string
  time: string
  balance: number
  equity: number
}

function generateMockData(): EquityDataPoint[] {
  const points: EquityDataPoint[] = []
  let balance = 10000
  let unrealizedPnL = 0
  const now = new Date()

  for (let i = 89; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)

    // Realistic daily equity fluctuations
    const baseTrend = i > 60 ? 0.0005 : i > 30 ? 0.0008 : -0.0002
    const dailyReturn = baseTrend + (Math.random() - 0.48) * 0.025
    balance = balance * (1 + dailyReturn)
    balance = Math.max(balance, 3000)

    // Unrealized P&L oscillates more
    unrealizedPnL = (Math.random() - 0.4) * 500
    const equity = balance + unrealizedPnL

    const hours = 9 + Math.floor(Math.random() * 7)
    const mins = Math.floor(Math.random() * 60)

    points.push({
      date: date.toISOString().split('T')[0],
      time: `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
      balance: Math.round(balance * 100) / 100,
      equity: Math.round(equity * 100) / 100,
    })
  }
  return points
}

let cachedData: EquityDataPoint[] | null = null

function getMockDataSnapshot(): EquityDataPoint[] {
  if (cachedData === null) {
    cachedData = generateMockData()
  }
  return cachedData
}

const emptySubscribe = () => () => {}

function useMockData() {
  return useSyncExternalStore(emptySubscribe, getMockDataSnapshot, () => [] as EquityDataPoint[])
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

const TIME_RANGES: TimeRange[] = ['1D', '1W', '1M', '3M']

export default function EquityChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1M')
  const ALL_DATA = useMockData()

  const filteredData = useMemo(() => {
    if (ALL_DATA.length === 0) return []
    const now = new Date()
    let cutoff: Date
    switch (timeRange) {
      case '1D':
        cutoff = new Date(now)
        cutoff.setDate(cutoff.getDate() - 1)
        break
      case '1W':
        cutoff = new Date(now)
        cutoff.setDate(cutoff.getDate() - 7)
        break
      case '1M':
        cutoff = new Date(now)
        cutoff.setMonth(cutoff.getMonth() - 1)
        break
      case '3M':
        cutoff = new Date(now)
        cutoff.setMonth(cutoff.getMonth() - 3)
        break
    }
    return ALL_DATA.filter((p) => new Date(p.date) >= cutoff)
  }, [timeRange, ALL_DATA])

  const stats = useMemo(() => {
    if (filteredData.length === 0) return { start: 0, current: 0, peak: 0, trough: 0, maxDD: 0 }
    const start = filteredData[0].equity
    const current = filteredData[filteredData.length - 1].equity
    let peak = -Infinity
    let trough = Infinity
    let maxDD = 0
    let runningPeak = -Infinity

    for (const p of filteredData) {
      if (p.equity > peak) peak = p.equity
      if (p.equity < trough) trough = p.equity
      if (p.equity > runningPeak) runningPeak = p.equity
      const dd = runningPeak > 0 ? ((runningPeak - p.equity) / runningPeak) * 100 : 0
      if (dd > maxDD) maxDD = dd
    }

    return {
      start: Math.round(start),
      current: Math.round(current),
      peak: Math.round(peak),
      trough: Math.round(trough),
      maxDD: Math.round(maxDD * 10) / 10,
    }
  }, [filteredData])

  const isPositive = stats.current >= stats.start

  const labelFormatter = (label: string) => {
    const d = new Date(label)
    if (timeRange === '1D') return `${d.getDate()}/${d.getMonth() + 1} ${label.split(' ')[1] ?? ''}`
    return `${d.getDate()}/${d.getMonth() + 1}`
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          {isPositive
            ? <TrendingUp className="h-5 w-5 text-emerald-500" />
            : <TrendingDown className="h-5 w-5 text-red-500" />
          }
          Equity Curve
        </h2>
        <div className="flex items-center gap-1">
          {TIME_RANGES.map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setTimeRange(range)}
            >
              {range}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="py-3">
          <CardContent className="flex items-center gap-2 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/40">
              <DollarSign className="h-4 w-4 text-sky-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">Starting</p>
              <p className="text-xs font-bold">{formatCurrency(stats.start)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-3">
          <CardContent className="flex items-center gap-2 p-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isPositive ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-red-50 dark:bg-red-950/40'}`}>
              {isPositive
                ? <TrendingUp className="h-4 w-4 text-emerald-600" />
                : <TrendingDown className="h-4 w-4 text-red-600" />
              }
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">Current</p>
              <p className={`text-xs font-bold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(stats.current)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-3">
          <CardContent className="flex items-center gap-2 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">Peak</p>
              <p className="text-xs font-bold text-emerald-600">{formatCurrency(stats.peak)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-3">
          <CardContent className="flex items-center gap-2 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-950/40">
              <ArrowDownToLine className="h-4 w-4 text-red-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">Trough</p>
              <p className="text-xs font-bold text-red-600">{formatCurrency(stats.trough)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-3 col-span-2 sm:col-span-1">
          <CardContent className="flex items-center gap-2 p-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stats.maxDD > 10 ? 'bg-red-50 dark:bg-red-950/40' : 'bg-amber-50 dark:bg-amber-950/40'}`}>
              <Mountain className={`h-4 w-4 ${stats.maxDD > 10 ? 'text-red-600' : 'text-amber-600'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">Max Drawdown</p>
              <p className={`text-xs font-bold ${stats.maxDD > 10 ? 'text-red-600' : 'text-amber-600'}`}>
                {stats.maxDD}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardContent className="p-4">
          <div className="h-72 sm:h-80 lg:h-96">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredData}>
                <defs>
                  <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={labelFormatter}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
                  domain={['dataMin - 500', 'dataMax + 500']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: number, name: string) => [
                    `$${value.toLocaleString()}`,
                    name === 'balance' ? 'Balance' : 'Equity',
                  ]}
                  labelFormatter={(label: string) => `Date: ${label}`}
                />
                <Legend
                  formatter={(value: string) => (value === 'balance' ? 'Balance' : 'Equity')}
                  wrapperStyle={{ fontSize: '12px' }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#0ea5e9"
                  fill="url(#balanceGradient)"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke={isPositive ? '#10b981' : '#ef4444'}
                  fill="url(#equityGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
