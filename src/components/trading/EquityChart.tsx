'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TrendingUp, TrendingDown, DollarSign, Mountain, ArrowDownToLine, BarChart3 } from 'lucide-react'
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
  balance: number
  equity: number
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

interface EquityChartProps {
  isMarketOpen?: boolean
}

export default function EquityChart({ isMarketOpen }: EquityChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1M')
  const [data, setData] = useState<EquityDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const fetchEquityData = useCallback((range: TimeRange, open: boolean) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetch(`/api/account/equity-curve?range=${range}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch')
        return res.json()
      })
      .then((json) => {
        setData(json.data ?? [])
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setData([])
          setLoading(false)
        }
      })
  }, [])

  // Initial fetch + auto-refresh: 60s during market hours, 5min outside
  useEffect(() => {
    const delay = isMarketOpen === true ? 60000 : 300000
    fetchEquityData(timeRange, isMarketOpen === true)
    const interval = setInterval(() => {
      fetchEquityData(timeRange, isMarketOpen === true)
    }, delay)
    return () => clearInterval(interval)
  }, [timeRange, isMarketOpen, fetchEquityData])

  const stats = useMemo(() => {
    if (data.length === 0) return { start: 0, current: 0, peak: 0, trough: 0, maxDD: 0 }
    const start = data[0].equity
    const current = data[data.length - 1].equity
    let peak = -Infinity
    let trough = Infinity
    let maxDD = 0
    let runningPeak = -Infinity

    for (const p of data) {
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
  }, [data])

  const yDomain = useMemo(() => {
    if (data.length === 0) return ['auto', 'auto'] as [string, string]
    const values = data.flatMap(d => [d.balance, d.equity]).filter(v => v != null && isFinite(v))
    if (values.length === 0) return ['auto', 'auto'] as [string, string]
    const min = Math.min(...values)
    const max = Math.max(...values)
    if (max === min) return [max - 500, max + 500] as [number, number]
    const padding = (max - min) * 0.05
    return [min - padding, max + padding] as [number, number]
  }, [data])

  const isPositive = data.length > 0 ? stats.current >= stats.start : true

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
              <p className="text-xs font-bold">{loading ? '—' : formatCurrency(stats.start)}</p>
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
                {loading ? '—' : formatCurrency(stats.current)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-3">
          <CardContent className="flex items-center gap-2 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40">
              <BarChart3 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">Peak</p>
              <p className="text-xs font-bold text-emerald-600">{loading ? '—' : formatCurrency(stats.peak)}</p>
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
              <p className="text-xs font-bold text-red-600">{loading ? '—' : formatCurrency(stats.trough)}</p>
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
                {loading ? '—' : `${stats.maxDD}%`}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardContent className="p-4">
          {loading ? (
            <div className="flex h-72 sm:h-80 lg:h-96 items-center justify-center">
              <BarChart3 className="h-8 w-8 text-muted-foreground animate-pulse" />
            </div>
          ) : data.length === 0 ? (
            <div className="flex h-72 sm:h-80 lg:h-96 items-center justify-center">
              <div className="text-center space-y-2">
                <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">No equity data yet</p>
                <p className="text-xs text-muted-foreground">Daily performance records will appear here once trading begins.</p>
              </div>
            </div>
          ) : (
            <div className="h-72 sm:h-80 lg:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
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
                    domain={yDomain}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: unknown, name: string) => {
                      const display = typeof value === 'number' ? `$${value.toLocaleString()}` : '—'
                      return [display, name === 'balance' ? 'Balance' : 'Equity']
                    }}
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
