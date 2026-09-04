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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Plus, LineChart, Trash2, Loader2, AlertTriangle, ChevronDown, ChevronUp, Cpu } from 'lucide-react'
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

interface SimulatedTrade {
  entryBar: number
  exitBar: number
  /** v1 sends LONG/SHORT; the v2 engine sends BUY/SELL — both are supported */
  direction: 'LONG' | 'SHORT' | 'BUY' | 'SELL'
  entryPrice: number
  exitPrice: number
  pnl: number
  commission: number
  sl: number | null
  tp: number | null
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
  simulatedTrades?: SimulatedTrade[]
  mockWarning?: boolean
  engine?: string
  // --- v2 engine fields ---
  sortinoRatio?: number | null
  calmarRatio?: number | null
  expectancy?: number | null
  grossProfit?: number
  grossLoss?: number
  maxConsecWins?: number
  maxConsecLosses?: number
  commissionTotal?: number
  dataSource?: 'database' | 'synthetic'
  engineVersion?: string
  v2Metrics?: Record<string, unknown>
  /** v2 GET rows persist the curve here (JSON string) */
  finalEquityCurve?: string
}

const SYMBOLS = [
  'BBCA', 'BBRI', 'TLKM', 'ASII', 'UNVR', 'BMRI', 'GOTO', 'BRIS', 'ICBP', 'ARTO', 'EXCL', 'TBIG',
]

const STRATEGIES = [
  'SMA Crossover',
  'EMA Crossover',
  'RSI Mean Reversion',
  'MACD Momentum',
  'Bollinger Breakout',
  'Donchian Breakout',
]

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1H', '4H', '1D', '1W']

/** Normalize a raw API result: GET rows keep v2 metadata inside JSON strings. */
function normalizeResult(raw: BacktestResult): BacktestResult {
  const out: BacktestResult = { ...raw }
  // Equity curve: v2 list responses store it as finalEquityCurve (JSON string)
  if (!out.equityCurve && out.finalEquityCurve) {
    try {
      const parsed = JSON.parse(out.finalEquityCurve) as EquityPoint[]
      if (Array.isArray(parsed)) out.equityCurve = parsed
    } catch { /* ignore malformed */ }
  }
  // dataSource / engineVersion: embedded in the config JSON string on GET rows
  if (!out.engineVersion || !out.dataSource) {
    try {
      const cfg = out.config ? (JSON.parse(out.config) as Record<string, unknown>) : null
      if (cfg) {
        if (!out.engineVersion && typeof cfg.engineVersion === 'string') out.engineVersion = cfg.engineVersion
        if (!out.dataSource && (cfg.dataSource === 'database' || cfg.dataSource === 'synthetic')) {
          out.dataSource = cfg.dataSource
        }
      }
    } catch { /* ignore malformed */ }
  }
  return out
}

function fmtMetric(v: number | null | undefined, digits = 2, fallback = '—'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return fallback
  return v.toFixed(digits)
}

function fmtUsd(v: number | null | undefined, fallback = '—'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return fallback
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function BacktestPanel() {
  const [backtests, setBacktests] = useState<BacktestResult[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedBacktest, setSelectedBacktest] = useState<BacktestResult | null>(null)
  const [tradesOpen, setTradesOpen] = useState(false)
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
          setBacktests(json.data.map(normalizeResult))
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
      setBacktests((prev) => [normalizeResult(json.data), ...prev])
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

  // Reset trades collapsible when selection changes
  const handleSelectBacktest = (bt: BacktestResult | null) => {
    setSelectedBacktest(bt)
    setTradesOpen(false)
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

      {/* Backtest Detail (when a result is selected) */}
      {selectedBacktest && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm font-medium">
                  Backtest Detail — {selectedBacktest.name}
                </CardTitle>
                {/* Mock warning badge (legacy v1 — v2 never mocks) */}
                {selectedBacktest.mockWarning && (
                  <Badge variant="destructive" className="gap-1 text-xs">
                    <AlertTriangle className="h-3 w-3" />
                    Mock Data
                  </Badge>
                )}
                {/* v2 data-source badge: synthetic candles were simulated */}
                {selectedBacktest.dataSource === 'synthetic' && (
                  <Badge
                    className="gap-1 text-xs bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/40"
                    title="No real candles in DB — deterministic synthetic series was generated"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    SYNTHETIC DATA
                  </Badge>
                )}
                {/* v2 engine badge */}
                {selectedBacktest.engineVersion === 'v2' && (
                  <Badge
                    className="gap-1 text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                  >
                    <Cpu className="h-3 w-3" />
                    v2 ENGINE
                  </Badge>
                )}
                {/* Legacy engine badge for pre-v2 results */}
                {!selectedBacktest.mockWarning && selectedBacktest.engine && !selectedBacktest.engineVersion && (
                  <Badge variant="outline" className="text-xs font-mono">
                    {selectedBacktest.engine === 'EMA_CROSSOVER' ? 'EMA' :
                     selectedBacktest.engine === 'SMA_CROSSOVER' ? 'SMA' :
                     selectedBacktest.engine === 'SMA_CROSSOVER_FALLBACK' ? 'SMA (fallback)' :
                     selectedBacktest.engine}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleSelectBacktest(null)}
              >
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* v2 Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Sortino</div>
                <div className="font-mono text-sm font-semibold">
                  {fmtMetric(selectedBacktest.sortinoRatio)}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Calmar</div>
                <div className="font-mono text-sm font-semibold">
                  {fmtMetric(selectedBacktest.calmarRatio)}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Expectancy</div>
                <div
                  className={`font-mono text-sm font-semibold ${
                    (selectedBacktest.expectancy ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {(selectedBacktest.expectancy ?? 0) >= 0 ? '+' : ''}
                  {fmtMetric(selectedBacktest.expectancy)}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Gross Profit</div>
                <div className="font-mono text-sm font-semibold text-emerald-600">
                  {fmtUsd(selectedBacktest.grossProfit ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Gross Loss</div>
                <div className="font-mono text-sm font-semibold text-red-600">
                  {fmtUsd(selectedBacktest.grossLoss ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Consec W / L</div>
                <div className="font-mono text-sm font-semibold">
                  <span className="text-emerald-600">{selectedBacktest.maxConsecWins ?? 0}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-red-600">{selectedBacktest.maxConsecLosses ?? 0}</span>
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Commission</div>
                <div className="font-mono text-sm font-semibold">
                  {fmtUsd(selectedBacktest.commissionTotal ?? 0)}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Sharpe</div>
                <div className="font-mono text-sm font-semibold">
                  {selectedBacktest.sharpeRatio ?? '—'}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Profit Factor</div>
                <div className="font-mono text-sm font-semibold">
                  {selectedBacktest.profitFactor ?? '—'}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Total P&amp;L</div>
                <div
                  className={`font-mono text-sm font-semibold ${
                    selectedBacktest.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {selectedBacktest.totalPnl >= 0 ? '+' : ''}
                  {selectedBacktest.totalPnl.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Max DD</div>
                <div className="font-mono text-sm font-semibold">
                  {selectedBacktest.maxDrawdown}%
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10px] text-muted-foreground">Total Return</div>
                <div
                  className={`font-mono text-sm font-semibold ${
                    (selectedBacktest.totalReturn ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {selectedBacktest.totalReturn !== undefined
                    ? `${selectedBacktest.totalReturn >= 0 ? '+' : ''}${selectedBacktest.totalReturn.toFixed(2)}%`
                    : '—'}
                </div>
              </div>
            </div>

            {/* Equity Curve Chart */}
            {selectedBacktest.equityCurve && selectedBacktest.equityCurve.length > 0 && (
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
            )}

            {/* Simulated Trades Detail Section */}
            {selectedBacktest.simulatedTrades && selectedBacktest.simulatedTrades.length > 0 && (
              <div>
                <Collapsible open={tradesOpen} onOpenChange={setTradesOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-between gap-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        Simulated Trades
                        <Badge variant="secondary" className="text-xs">
                          {selectedBacktest.simulatedTrades.length}
                        </Badge>
                      </span>
                      {tradesOpen ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div className="max-h-80 overflow-y-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">#</TableHead>
                            <TableHead className="w-16">Dir</TableHead>
                            <TableHead className="text-right">Entry</TableHead>
                            <TableHead className="text-right">Exit</TableHead>
                            <TableHead className="text-right">P&L</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Comm</TableHead>
                            <TableHead className="text-right hidden md:table-cell">SL</TableHead>
                            <TableHead className="text-right hidden md:table-cell">TP</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedBacktest.simulatedTrades.map((trade, idx) => {
                            const isWin = trade.pnl > 0
                            // v1 sends LONG/SHORT, v2 engine sends BUY/SELL — normalise for styling
                            const isLong = trade.direction === 'LONG' || trade.direction === 'BUY'
                            return (
                              <TableRow key={idx}>
                                <TableCell className="text-muted-foreground text-xs">
                                  {idx + 1}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={isLong ? 'default' : 'secondary'}
                                    className={`text-xs font-mono ${
                                      isLong
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                    }`}
                                  >
                                    {trade.direction}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                  {trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                  {trade.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className={`text-right font-mono text-xs font-medium ${
                                  isWin ? 'text-emerald-600' : 'text-red-600'
                                }`}>
                                  {isWin ? '+' : ''}{trade.pnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                                  {trade.commission.toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground hidden md:table-cell">
                                  {trade.sl !== null && trade.sl !== undefined
                                    ? trade.sl.toLocaleString(undefined, { maximumFractionDigits: 2 })
                                    : '—'}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground hidden md:table-cell">
                                  {trade.tp !== null && trade.tp !== undefined
                                    ? trade.tp.toLocaleString(undefined, { maximumFractionDigits: 2 })
                                    : '—'}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
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
                      // Check if this backtest used mock data (from config or mockWarning field)
                      const isMock = bt.mockWarning === true ||
                        (bt.config ? bt.config.includes('"engine":"MOCK"') : false)
                      return (
                        <TableRow
                          key={bt.id}
                          className={`cursor-pointer hover:bg-muted/50 ${isSelected ? 'bg-muted' : ''}`}
                          onClick={() => handleSelectBacktest(isSelected ? null : bt)}
                        >
                          <TableCell className="font-medium max-w-[180px] truncate">
                            <div className="flex items-center gap-1.5">
                              {isMock && (
                                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                              )}
                              <span className={isMock ? 'text-amber-700 dark:text-amber-400' : ''}>
                                {bt.name}
                              </span>
                            </div>
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
