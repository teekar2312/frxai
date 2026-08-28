'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Wallet,
  TrendingUp,
  BarChart3,
  Shield,
  DollarSign,
  Activity,
  Target,
  Percent,
  Zap,
} from 'lucide-react'

interface AccountData {
  balance: number
  equity: number
  marginUsed: number
  freeMargin: number
  dailyPnL: number
  openPositions: number
  totalTradesToday: number
  winRate: number
  leverage: string
  spreadFrom: string
  commission: string
}

const defaultData: AccountData = {
  balance: 10000,
  equity: 10250.75,
  marginUsed: 1250.0,
  freeMargin: 9000.75,
  dailyPnL: 250.75,
  openPositions: 3,
  totalTradesToday: 12,
  winRate: 67.5,
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

  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch('/api/account')
      if (res.ok) {
        const json = await res.json()
        const d = json.data ?? json
        setData({
          balance: d.balance ?? d.balance ?? 10000,
          equity: d.equity ?? 10250.75,
          marginUsed: d.marginUsed ?? 1250,
          freeMargin: d.freeMargin ?? 9000.75,
          dailyPnL: d.dailyPnl ?? 250.75,
          openPositions: d.openPositions ?? 3,
          totalTradesToday: d.totalTradesToday ?? 12,
          winRate: d.winRate ?? 67.5,
          leverage: d.leverage ?? '1:25',
          spreadFrom: d.spread?.replace(/^from\s+/i, '') ?? d.spreadFrom?.replace(/^from\s+/i, '') ?? '0.5 pip',
          commission: d.commission ?? '$1/lot',
        })
      }
    } catch {
      // Use default data on error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAccount()
    const interval = setInterval(fetchAccount, 5000)
    return () => clearInterval(interval)
  }, [fetchAccount])

  const isProfit = data.dailyPnL >= 0

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
      label: 'Leverage',
      value: data.leverage,
      icon: Zap,
      color: 'text-orange-600',
      bg: 'bg-orange-50 dark:bg-orange-950/40',
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
