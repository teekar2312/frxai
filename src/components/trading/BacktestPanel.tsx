'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, LineChart, Trash2, Loader2 } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface EquityPoint {
  date: string
  equity: number
}

interface BacktestResult {
  id: string
  name: string
  symbol: string
  strategy: string
  timeframe: string
  startDate: string
  endDate: string
  initialCapital: number
  finalCapital: number
  totalTrades: number
  winTrades: number
  lossTrades: number
  winRate: number
  totalPnl: number
  maxDrawdown: number
  sharpeRatio: number | null
  profitFactor: number | null
  avgWin: number | null
  avgLoss: number | null
  config?: string
  equityCurve?: EquityPoint[]
  totalReturn?: number
}

const SYMBOLS = [
  'BBCA', 'BBRI', 'TLKM', 'ASII', 'UNVR', 'BMRI', 'GOTO', 'BRIS', 'ICBP', 'ARTO', 'EXCL', 'TBIG',
]

const STRATEGIES = [
  'Moving Average Ribbon',
  'Momentum Scalping',
  'Pivot Point',
  'EMA Crossover',
  'RMI Trend Sync',
  'Linear Regression',
  'EMA/RSI Filter',
]

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1H', '4H', '1D', '1W']

export default function BacktestPanel() {
  const [backtests, setBacktests] = useState<BacktestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedBacktest, setSelectedBacktest] = useState<BacktestResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formSymbol, setFormSymbol] = useState('')
  const [formStrategy, setFormStrategy] = useState('')
  const [formTimeframe, setFormTimeframe] = useState('')
  const [formStartDate, setFormStartDate] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formCapital, setFormCapital] = useState('10000')

  const fetchBacktests = useCallback(async () => {
    try {
      const res = await fetch('/api/backtest')
      if (res.ok) {
        const json = await res.json()
        if (json.success && Array.isArray(json.data)) {
          setBacktests(json.data)
        }
      }
    } catch {
      // silent – empty state shown by UI
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBacktests()
  }, [fetchBacktests])

  const handleRunBacktest = async () => {
    if (!formName || !formSymbol || !formStrategy || !formTimeframe) return
    setError(null)
    setRunning(true)

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          symbol: formSymbol,
          strategy: formStrategy,
          timeframe: formTimeframe,
          startDate: formStartDate || undefined,
          endDate: formEndDate || undefined,
          initialCapital: parseFloat(formCapital) || 10000,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || 'Backtest failed')
        setRunning(false)
        return
      }

      // Prepend the new result (API already saved it to DB)
      setBacktests((prev) => [json.data, ...prev])
      setDialogOpen(false)
      resetForm()
    } catch {
      setError('Network error running backtest')
    } finally {
      setRunning(false)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/backtest?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        setBacktests((prev) => prev.filter((bt) => bt.id !== id))
        if (selectedBacktest?.id === id) setSelectedBacktest(null)
      }
    } catch {
      // silent
    }
  }

  const resetForm = () => {
    setFormName('')
    setFormSymbol('')
    setFormStrategy('')
    setFormTimeframe('')
    setFormStartDate('')
    setFormEndDate('')
    setFormCapital('10000')
    setError(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <LineChart className="h-5 w-5 text-sky-500" />
          Backtest Panel
        </h2>

        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setError(null) }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Run Backtest
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Run New Backtest</DialogTitle>
              <DialogDescription>
                Configure and run a strategy backtest on historical data.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="bt-name">Backtest Name</Label>
                <Input
                  id="bt-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. BBCA MA Ribbon Q4 2024"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Symbol</Label>
                  <Select value={formSymbol} onValueChange={setFormSymbol}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select symbol" />
                    </SelectTrigger>
                    <SelectContent>
                      {SYMBOLS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Strategy</Label>
                  <Select value={formStrategy} onValueChange={setFormStrategy}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGIES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Timeframe</Label>
                <Select value={formTimeframe} onValueChange={setFormTimeframe}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bt-start">Start Date</Label>
                  <Input
                    id="bt-start"
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bt-end">End Date</Label>
                  <Input
                    id="bt-end"
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bt-capital">Initial Capital (USD)</Label>
                <Input
                  id="bt-capital"
                  type="number"
                  value={formCapital}
                  onChange={(e) => setFormCapital(e.target.value)}
                  placeholder="10000"
                />
              </div>

              {error && (
                <p className="text-sm text-red-500">{error}</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRunBacktest}
                disabled={!formName || !formSymbol || !formStrategy || !formTimeframe || running}
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running...
                  </>
                ) : (
                  'Run Backtest'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Equity Curve Chart (when a backtest is selected) */}
      {selectedBacktest && selectedBacktest.equityCurve && selectedBacktest.equityCurve.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                Equity Curve — {selectedBacktest.name}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelectedBacktest(null)}
              >
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={selectedBacktest.equityCurve}>
                  <defs>
                    <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={selectedBacktest.totalPnl >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={selectedBacktest.totalPnl >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v: string) => {
                      const d = new Date(v)
                      return `${d.getDate()}/${d.getMonth() + 1}`
                    }}
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
                    formatter={(value: number) => [`$${value.toLocaleString()}`, 'Equity']}
                    labelFormatter={(label: string) => `Date: ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="equity"
                    stroke={selectedBacktest.totalPnl >= 0 ? '#10b981' : '#ef4444'}
                    fill="url(#equityGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Backtest Results Table */}
      <Card>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="hidden md:table-cell">Strategy</TableHead>
                  <TableHead className="hidden lg:table-cell">TF</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Total P&L</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Max DD</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Sharpe</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">PF</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-10" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-14 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell className="text-right hidden sm:table-cell"><Skeleton className="h-4 w-14 ml-auto" /></TableCell>
                        <TableCell className="text-right hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        <TableCell className="text-right hidden lg:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-6" /></TableCell>
                      </TableRow>
                    ))
                  : backtests.map((bt) => {
                      const isProfit = bt.totalPnl >= 0
                      const isSelected = selectedBacktest?.id === bt.id
                      return (
                        <TableRow
                          key={bt.id}
                          className={`cursor-pointer hover:bg-muted/50 ${isSelected ? 'bg-muted' : ''}`}
                          onClick={() => setSelectedBacktest(isSelected ? null : bt)}
                        >
                          <TableCell className="font-medium max-w-[180px] truncate">
                            {bt.name}
                          </TableCell>
                          <TableCell className="font-semibold">{bt.symbol}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className="text-xs text-muted-foreground">{bt.strategy}</span>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <Badge variant="outline">{bt.timeframe}</Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={bt.winRate >= 50 ? 'text-emerald-600' : 'text-red-600'}>
                              {bt.winRate}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            <span className={isProfit ? 'text-emerald-600' : 'text-red-600'}>
                              {isProfit ? '+' : ''}{bt.totalPnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono hidden sm:table-cell">
                            <span className={bt.maxDrawdown > 15 ? 'text-red-600' : bt.maxDrawdown > 10 ? 'text-amber-600' : 'text-emerald-600'}>
                              {bt.maxDrawdown}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono hidden md:table-cell">
                            <span className={(bt.sharpeRatio ?? 0) >= 1.5 ? 'text-emerald-600' : (bt.sharpeRatio ?? 0) >= 1.0 ? 'text-amber-600' : 'text-red-600'}>
                              {bt.sharpeRatio ?? '-'}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono hidden lg:table-cell">
                            <span className={(bt.profitFactor ?? 0) >= 1.5 ? 'text-emerald-600' : (bt.profitFactor ?? 0) >= 1.0 ? 'text-amber-600' : 'text-red-600'}>
                              {bt.profitFactor ?? '-'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-red-600"
                              onClick={(e) => handleDelete(bt.id, e)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
              </TableBody>
            </Table>
          </div>
          {backtests.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No backtest results. Click &quot;Run Backtest&quot; to get started.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
