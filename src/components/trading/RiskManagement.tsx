'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ShieldAlert, TrendingDown, Activity, Percent, Gauge, AlertTriangle, Ban, AlertOctagon, CheckCircle2, XCircle, TriangleAlert } from 'lucide-react'

interface PositionRisk {
  tradeId: string
  symbol: string
  direction: string
  lotSize: number
  entryPrice: number
  currentPrice: number
  sl: number | null
  tp: number | null
  margin: number
  pnl: number
  pnlPercent: number
  riskAmount: number
  riskPercent: number
  strategy: string | null
  trailingStop: boolean
}

interface RiskEventItem {
  eventType: string
  severity: string
  message: string
  createdAt: string
  resolved: boolean
}

interface RiskData {
  equity: number
  balance: number
  freeMargin: number
  marginUsed: number
  marginLevelPercent: number
  dailyPnl: number
  dailyPnlPercent: number
  weeklyPnl: number
  weeklyPnlPercent: number
  monthlyPnl: number
  monthlyPnlPercent: number
  currentDrawdown: number
  maxDrawdown: number
  maxAllowedDrawdown: number
  riskScore: number
  riskLevel: string
  openPositions: number
  maxPositionsAllowed: number
  marginUsagePercent: number
  maxMarginAllowed: number
  dailyLossRemaining: number
  dailyLossLimit: number
  isDailyLimitReached: boolean
  isMarginCallWarning: boolean
  isStopOutWarning: boolean
  isTradingAllowed: boolean
  tradingBlockReason?: string
  recentRiskEvents: RiskEventItem[]
  recommendations: string[]
  positions: PositionRisk[]
}

function getRiskColor(score: number): string {
  if (score <= 2) return 'text-emerald-600'
  if (score <= 4) return 'text-amber-600'
  return 'text-red-600'
}

function getRiskBg(score: number): string {
  if (score <= 2) return 'bg-emerald-50 dark:bg-emerald-950/40'
  if (score <= 4) return 'bg-amber-50 dark:bg-amber-950/40'
  return 'bg-red-50 dark:bg-red-950/40'
}

function getRiskLevelBadge(level: string) {
  switch (level) {
    case 'LOW': return <Badge className='bg-emerald-600 hover:bg-emerald-700'>LOW</Badge>
    case 'MODERATE': return <Badge className='bg-sky-600 hover:bg-sky-700'>MODERATE</Badge>
    case 'ELEVATED': return <Badge className='bg-amber-600 hover:bg-amber-700'>ELEVATED</Badge>
    case 'HIGH': return <Badge className='bg-orange-600 hover:bg-orange-700'>HIGH</Badge>
    case 'CRITICAL': return <Badge variant='destructive'>CRITICAL</Badge>
    default: return <Badge variant='secondary'>{level}</Badge>
  }
}

function getProgressColor(value: number, max: number): string {
  const pct = (value / max) * 100
  if (pct < 50) return '[&>div]:bg-emerald-500'
  if (pct < 80) return '[&>div]:bg-amber-500'
  return '[&>div]:bg-red-500'
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value)
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

export default function RiskManagement() {
  const [data, setData] = useState<RiskData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchRisk = useCallback(async () => {
    try {
      const res = await fetch('/api/risk')
      if (res.ok) {
        const json = await res.json()
        setData(json.data)
      }
    } catch {
      // use stale data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRisk()
    const interval = setInterval(fetchRisk, 10000)
    return () => clearInterval(interval)
  }, [fetchRisk])

  // ---- Derived values ----
  const dailyPnLPct = data ? Math.min(Math.abs(data.dailyPnl / data.dailyLossLimit) * 100, 100) : 0
  const isDailyLoss = data ? data.dailyPnl < 0 : false
  const marginPct = data ? Math.min(data.marginUsagePercent, 100) : 0
  const drawdownPct = data ? Math.min(data.currentDrawdown / data.maxAllowedDrawdown * 100, 100) : 0
  const riskScore = data?.riskScore ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          Risk Management
        </h2>
        {data && getRiskLevelBadge(data.riskLevel)}
      </div>

      {/* ---- CRITICAL ALERTS ---- */}
      {data?.isStopOutWarning && (
        <Alert variant="destructive">
          <AlertOctagon className="h-4 w-4" />
          <AlertDescription>
            <strong>STOP OUT WARNING</strong> — Margin level at {data.marginLevelPercent}% (stop out at 20%). All positions at risk of forced closure.
          </AlertDescription>
        </Alert>
      )}
      {data?.isMarginCallWarning && !data?.isStopOutWarning && (
        <Alert className="border-red-500 bg-red-50 dark:bg-red-950/30">
          <TriangleAlert className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 dark:text-red-200">
            <strong>MARGIN CALL WARNING</strong> — Margin level at {data.marginLevelPercent}%. Reduce positions immediately.
          </AlertDescription>
        </Alert>
      )}
      {data?.isDailyLimitReached && (
        <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/30">
          <Ban className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200">
            <strong>DAILY LOSS LIMIT REACHED</strong> — {formatCurrency(data.dailyPnl)} loss. No new trades allowed today.
          </AlertDescription>
        </Alert>
      )}
      {data && !data.isTradingAllowed && !data.isDailyLimitReached && !data.isStopOutWarning && (
        <Alert className="border-red-500 bg-red-50 dark:bg-red-950/30">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 dark:text-red-200">
            <strong>TRADING BLOCKED:</strong> {data.tradingBlockReason}
          </AlertDescription>
        </Alert>
      )}

      {/* ---- STAT CARDS ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Risk Score */}
        <Card className={`py-4 ${getRiskBg(riskScore)}`}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${getRiskBg(riskScore)}`}>
              <Gauge className={`h-5 w-5 ${getRiskColor(riskScore)}`} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">Risk Score</p>
              <p className={`truncate text-sm font-bold ${getRiskColor(riskScore)}`}>
                {loading ? '—' : `${riskScore}/10`}
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
              <p className="truncate text-sm font-bold text-emerald-600">
                0.5%
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Drawdown */}
        <Card className="py-4">
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${drawdownPct > 80 ? 'bg-red-50 dark:bg-red-950/40' : 'bg-amber-50 dark:bg-amber-950/40'}`}>
              <TrendingDown className={`h-5 w-5 ${drawdownPct > 80 ? 'text-red-600' : 'text-amber-600'}`} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">Drawdown</p>
              <p className={`truncate text-sm font-bold ${drawdownPct > 80 ? 'text-red-600' : 'text-amber-600'}`}>
                {loading ? '—' : `${data?.currentDrawdown ?? 0}% / ${data?.maxAllowedDrawdown ?? 10}%`}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Positions */}
        <Card className="py-4">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/40">
              <Activity className="h-5 w-5 text-sky-600" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">Positions</p>
              <p className="truncate text-sm font-bold text-sky-600">
                {loading ? '—' : `${data?.openPositions ?? 0}/${data?.maxPositionsAllowed ?? 200}`}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---- P&L BARS ---- */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Daily P&L vs Max Loss */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Daily P&L</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className={isDailyLoss ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium'}>
                {isDailyLoss ? '' : '+'}{data ? formatCurrency(data.dailyPnl) : '—'}
              </span>
              <span className="text-muted-foreground text-xs">
                Limit: {data ? formatCurrency(data.dailyLossLimit) : '—'}
              </span>
            </div>
            <Progress value={dailyPnLPct} className={`h-3 ${getProgressColor(Math.abs(data?.dailyPnl ?? 0), data?.dailyLossLimit ?? 200)}`} />
            <p className="text-xs text-muted-foreground">
              {data ? `${formatCurrency(data.dailyLossRemaining)} remaining` : '—'}
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
                {data ? `${data.marginUsagePercent.toFixed(1)}%` : '—'}
              </span>
              <span className="text-muted-foreground text-xs">Max: {data?.maxMarginAllowed ?? 50}%</span>
            </div>
            <Progress value={marginPct} className={`h-3 ${getProgressColor(data?.marginUsagePercent ?? 0, data?.maxMarginAllowed ?? 50)}`} />
            <p className="text-xs text-muted-foreground">
              Free: {data ? formatCurrency(data.freeMargin) : '—'}
            </p>
          </CardContent>
        </Card>

        {/* Drawdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Drawdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className={drawdownPct > 80 ? 'text-red-600 font-medium' : 'text-amber-600 font-medium'}>
                {data ? `${data.currentDrawdown}%` : '—'}
              </span>
              <span className="text-muted-foreground text-xs">Max: {data?.maxAllowedDrawdown ?? 10}%</span>
            </div>
            <Progress value={drawdownPct} className={`h-3 ${getProgressColor(data?.currentDrawdown ?? 0, data?.maxAllowedDrawdown ?? 10)}`} />
            <p className="text-xs text-muted-foreground">
              All-time max: {data ? `${data.maxDrawdown}%` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ---- TIME-BASED P&L ---- */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Today', value: data?.dailyPnl, pct: data?.dailyPnlPercent },
          { label: 'This Week', value: data?.weeklyPnl, pct: data?.weeklyPnlPercent },
          { label: 'This Month', value: data?.monthlyPnl, pct: data?.monthlyPnlPercent },
        ].map((item) => (
          <Card key={item.label} className="py-3">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
              <p className={`text-sm font-bold ${(item.value ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {item.value != null ? `${(item.value >= 0 ? '+' : '')}${formatCurrency(item.value)}` : '—'}
              </p>
              <p className={`text-xs ${(item.value ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {item.pct != null ? `${(item.pct >= 0 ? '+' : '')}${item.pct}%` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---- POSITION-LEVEL RISK ---- */}
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
                  <TableHead className="text-right hidden lg:table-cell">P&L</TableHead>
                  <TableHead className="hidden xl:table-cell">Strategy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.positions.map((pos) => (
                  <TableRow key={pos.tradeId}>
                    <TableCell className="font-semibold">{pos.symbol}</TableCell>
                    <TableCell>
                      <Badge variant={pos.direction === 'BUY' ? 'default' : 'destructive'}
                        className={pos.direction === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}>
                        {pos.direction}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono hidden sm:table-cell">{pos.lotSize}</TableCell>
                    <TableCell className="text-right font-mono hidden md:table-cell">{pos.entryPrice.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right font-mono hidden md:table-cell">{pos.sl?.toLocaleString('id-ID') ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(pos.riskAmount)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-medium ${pos.riskPercent <= 0.5 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {pos.riskPercent}%
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-mono hidden lg:table-cell ${pos.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {pos.pnl >= 0 ? '+' : ''}{formatCurrency(pos.pnl)}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <span className="text-xs text-muted-foreground">{pos.strategy || '—'}</span>
                      {pos.trailingStop && <Badge variant="outline" className="ml-1 text-[10px]">TS</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {(!data?.positions || data.positions.length === 0) && (
            <div className="py-6 text-center text-sm text-muted-foreground">No open positions</div>
          )}
        </CardContent>
      </Card>

      {/* ---- RECOMMENDATIONS ---- */}
      {data && data.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {data.recommendations.map((rec, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ---- RISK RULES ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Risk Rules (FINEX Indonesia)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: 'Risk / Trade', value: '0.5%', icon: Percent },
              { label: 'Daily Loss', value: '2%', icon: TrendingDown },
              { label: 'Max DD', value: '10%', icon: TrendingDown },
              { label: 'Margin', value: '50%', icon: Activity },
              { label: 'MC Level', value: '50%', icon: ShieldAlert },
              { label: 'SO Level', value: '20%', icon: ShieldAlert },
              { label: 'Leverage', value: '1:25', icon: Gauge },
            ].map((rule) => {
              const Icon = rule.icon
              return (
                <div key={rule.label} className="flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">{rule.label}</p>
                  <p className="text-xs font-bold">{rule.value}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
