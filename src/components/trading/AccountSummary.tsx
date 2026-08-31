'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Wallet,
  TrendingUp,
  BarChart3,
  Shield,
  DollarSign,
  Activity,
  Target,
  Percent,
  Gauge,
} from 'lucide-react'

interface AccountData {
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  marginLevel: number
  dailyPnL: number
  openPositions: number
  totalTradesToday: number
  winRate: number
  leverage: string
  spreadFrom: string
  commission: string
}

const defaultData: AccountData = {
  balance: 0,
  equity: 0,
  marginUsed: 0,
  freeMargin: 0,
  marginLevel: 0,
  dailyPnL: 0,
  openPositions: 0,
  totalTradesToday: 0,
  winRate: 0,
  leverage: '1:25',
  spreadFrom: '0.5 pip',
  commission: '$1/lot',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

export default function AccountSummary() {
  const [data, setData] = useState<AccountData>(defaultData)
  const [loading, setLoading] = useState(true)
  const [marketOpen, setMarketOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [accountRes, mt5Res] = await Promise.all([
        fetch('/api/account'),
        fetch('/api/mt5/status'),
      ])

      // Process account data
      if (accountRes.ok) {
        const json = await accountRes.json()
        const d = json.data ?? json
        setData({
          balance: d.balance ?? 0,
          equity: d.equity ?? 0,
          marginUsed: d.marginUsed ?? 0,
          freeMargin: d.freeMargin ?? 0,
          marginLevel: d.marginLevel ?? 0,
          dailyPnl: d.dailyPnl ?? 0,
          openPositions: d.openPositions ?? 0,
          totalTradesToday: d.totalTradesToday ?? 0,
          winRate: d.winRate ?? 0,
          leverage: d.leverage ?? '1:25',
          spreadFrom: d.spread?.replace(/^from\s+/i, '') ?? d.spreadFrom?.replace(/^from\s+/i, '') ?? '0.5 pip',
          commission: d.commission ?? '$1/lot',
        })
      }

      // Process MT5 status for market awareness
      if (mt5Res.ok) {
        const mt5Json = await mt5Res.json()
        setMarketOpen(mt5Json.data?.isMarketOpen ?? false)
      }
    } catch {
      // Keep previous data on error
    } finally {
      setLoading(false)
    }
  }, [])

  // Smart polling: 10s during market hours, 60s outside
  useEffect(() => {
    let active = true

    const scheduleNext = () => {
      const delay = marketOpen ? 10000 : 60000
      timerRef.current = setTimeout(async () => {
        if (!active) return
        await fetchData()
        scheduleNext()
      }, delay)
    }

    // Initial fetch
    fetchData().then(() => scheduleNext())

    return () => {
      active = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [fetchData, marketOpen])

  const isProfit = data.dailyPnL >= 0
  const isMarginLow = data.marginLevel > 0 && data.marginLevel < 150
  const isMarginCritical = data.marginLevel > 0 && data.marginLevel < 50

  const stats = [
    {
      label: 'Account Balance',
      value: formatCurrency(data.balance),
      icon: Wallet,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'Equity',
      value: formatCurrency(data.equity),
      icon: BarChart3,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'Margin Used',
      value: formatCurrency(data.marginUsed),
      icon: Shield,
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
    },
    {
      label: 'Free Margin',
      value: formatCurrency(data.freeMargin),
      icon: DollarSign,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'Daily P&L',
      value: `${isProfit ? '+' : ''}${formatCurrency(data.dailyPnL)}`,
      icon: TrendingUp,
      color: isProfit ? 'text-emerald-600' : 'text-red-600',
      bg: isProfit
        ? 'bg-emerald-50 dark:bg-emerald-950/40'
        : 'bg-red-50 dark:bg-red-950/40',
    },
    {
      label: 'Open Positions',
      value: String(data.openPositions),
      icon: Activity,
      color: 'text-sky-600',
      bg: 'bg-sky-50 dark:bg-sky-950/40',
    },
    {
      label: 'Total Trades Today',
      value: String(data.totalTradesToday),
      icon: Target,
      color: 'text-violet-600',
      bg: 'bg-violet-50 dark:bg-violet-950/40',
    },
    {
      label: 'Win Rate',
      value: `${data.winRate}%`,
      icon: Percent,
      color: data.winRate >= 50 ? 'text-emerald-600' : 'text-red-600',
      bg:
        data.winRate >= 50
          ? 'bg-emerald-50 dark:bg-emerald-950/40'
          : 'bg-red-50 dark:bg-red-950/40',
    },
    {
      label: 'Margin Level',
      value: data.marginLevel > 0 ? `${data.marginLevel.toFixed(1)}%` : 'N/A',
      icon: Gauge,
      color: isMarginCritical
        ? 'text-red-600'
        : isMarginLow
          ? 'text-amber-600'
          : 'text-emerald-600',
      bg: isMarginCritical
        ? 'bg-red-50 dark:bg-red-950/40'
        : isMarginLow
          ? 'bg-amber-50 dark:bg-amber-950/40'
          : 'bg-emerald-50 dark:bg-emerald-950/40',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          Account Summary
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Spread from {data.spreadFrom}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            Commission {data.commission}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="py-4">
              <CardContent className="flex items-center gap-3 p-4">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${stat.bg}`}
                >
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-muted-foreground">
                    {stat.label}
                  </p>
                  <p
                    className={`truncate text-sm font-bold ${stat.color}`}
                  >
                    {loading ? '—' : stat.value}
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
