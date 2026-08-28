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
import { Plus, LineChart } from 'lucide-react'
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
  winRate: number
  totalPnL: number
  maxDrawdown: number
  sharpeRatio: number
  profitFactor: number
  equityCurve: EquityPoint[]
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

function generateEquityCurve(positive: boolean): EquityPoint[] {
  const points: EquityPoint[] = []
  let equity = 10000
  for (let i = 0; i < 60; i++) {
    const date = new Date(2024, 9, 1)
    date.setDate(date.getDate() + i)
    const change = (Math.random() - (positive ? 0.42 : 0.58)) * 200
    equity = Math.max(equity + change, 2000)
    points.push({
      date: date.toISOString().split('T')[0],
      equity: Math.round(equity * 100) / 100,
    })
  }
  return points
}

const defaultBacktests: BacktestResult[] = [
  {
    id: 'BT001',
    name: 'BBCA MA Ribbon 2024',
    symbol: 'BBCA',
    strategy: 'Moving Average Ribbon',
    timeframe: '1D',
    winRate: 62.5,
    totalPnL: 3250.0,
    maxDrawdown: 8.4,
    sharpeRatio: 1.85,
    profitFactor: 2.1,
    equityCurve: generateEquityCurve(true),
  },
  {
    id: 'BT002',
    name: 'BBRI Momentum 2024',
    symbol: 'BBRI',
    strategy: 'Momentum Scalping',
    timeframe: '4H',
    winRate: 55.2,
    totalPnL: 1820.0,
    maxDrawdown: 12.1,
    sharpeRatio: 1.32,
    profitFactor: 1.65,
    equityCurve: generateEquityCurve(true),
  },
  {
    id: 'BT003',
    name: 'GOTO EMA Cross Q4',
    symbol: 'GOTO',
    strategy: 'EMA Crossover',
    timeframe: '1H',
    winRate: 48.8,
    totalPnL: -420.0,
    maxDrawdown: 18.5,
    sharpeRatio: 0.65,
    profitFactor: 0.88,
    equityCurve: generateEquityCurve(false),
  },
  {
    id: 'BT004',
    name: 'TLKM RMI Trend 2024',
    symbol: 'TLKM',
    strategy: 'RMI Trend Sync',
    timeframe: '4H',
    winRate: 58.3,
    totalPnL: 2150.0,
    maxDrawdown: 9.7,
    sharpeRatio: 1.55,
    profitFactor: 1.92,
    equityCurve: generateEquityCurve(true),
  },
]

export default function BacktestPanel() {
  const [backtests, setBacktests] = useState<BacktestResult[]>(defaultBacktests)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedBacktest, setSelectedBacktest] = useState<BacktestResult | null>(null)
  const [running, setRunning] = useState(false)

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
        setBacktests(Array.isArray(json) ? json : json.results ?? defaultBacktests)
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBacktests()
  }, [fetchBacktests])

  const handleRunBacktest = async () => {
    if (!formName || !formSymbol || !formStrategy || !formTimeframe) return

    setRunning(true)
    // Simulate running
    await new Promise((r) => setTimeout(r, 1500))

    const isPositive = Math.random() > 0.35
    const newResult: BacktestResult = {
      id: `BT${Date.now()}`,
      name: formName,
      symbol: formSymbol,
      strategy: formStrategy,
      timeframe: formTimeframe,
      winRate: Math.round(40 + Math.random() * 30) * 10 / 10,
      totalPnL: Math.round((Math.random() - (isPositive ? 0.3 : 0.6)) * 5000 * 100) / 100,
      maxDrawdown: Math.round((5 + Math.random() * 20) * 10) / 10,
      sharpeRatio: Math.round((0.3 + Math.random() * 2) * 100) / 100,
      profitFactor: Math.round((0.5 + Math.random() * 2) * 100) / 100,
      equityCurve: generateEquityCurve(isPositive),
    }

    setBacktests((prev) => [newResult, ...prev])
    setRunning(false)
    setDialogOpen(false)
    resetForm()
  }

  const resetForm = () => {
    setFormName('')
    setFormSymbol('')
    setFormStrategy('')
    setFormTimeframe('')
    setFormStartDate('')
    setFormEndDate('')
    setFormCapital('10000')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <LineChart className="h-5 w-5 text-sky-500" />
          Backtest Panel
        </h2>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRunBacktest}
                disabled={!formName || !formSymbol || !formStrategy || !formTimeframe || running}
              >
                {running ? 'Running...' : 'Run Backtest'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Equity Curve Chart (when a backtest is selected) */}
      {selectedBacktest && (
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
                      <stop offset="5%" stopColor={selectedBacktest.totalPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={selectedBacktest.totalPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
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
                    stroke={selectedBacktest.totalPnL >= 0 ? '#10b981' : '#ef4444'}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={9} className="h-10 text-center text-muted-foreground">
                          Loading...
                        </TableCell>
                      </TableRow>
                    ))
                  : backtests.map((bt) => {
                      const isProfit = bt.totalPnL >= 0
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
                              {isProfit ? '+' : ''}{bt.totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono hidden sm:table-cell">
                            <span className={bt.maxDrawdown > 15 ? 'text-red-600' : bt.maxDrawdown > 10 ? 'text-amber-600' : 'text-emerald-600'}>
                              {bt.maxDrawdown}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono hidden md:table-cell">
                            <span className={bt.sharpeRatio >= 1.5 ? 'text-emerald-600' : bt.sharpeRatio >= 1.0 ? 'text-amber-600' : 'text-red-600'}>
                              {bt.sharpeRatio}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono hidden lg:table-cell">
                            <span className={bt.profitFactor >= 1.5 ? 'text-emerald-600' : bt.profitFactor >= 1.0 ? 'text-amber-600' : 'text-red-600'}>
                              {bt.profitFactor}
                            </span>
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
