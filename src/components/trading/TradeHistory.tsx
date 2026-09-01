'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowUpDown,
  Loader2,
  TrendingUp,
  TrendingDown,
  BarChart3,
} from 'lucide-react'

type SortField = 'closeTime' | 'pnl' | 'pnlPercent'
type SortDir = 'asc' | 'desc'

interface TradeRecord {
  id: string
  symbol: string
  direction: string
  lotSize: number
  entryPrice: number
  closePrice: number | null
  pnl: number
  pnlPercent: number
  reason: string | null
  strategy: string | null
  timeframe: string | null
  openTime: string
  closeTime: string | null
  commission: number
  slippage: number
}

interface Aggregates {
  totalPnl: number
  winRate: number
  avgPnl: number
  totalCommission: number
  totalSlippage: number
}

interface HistoryResponse {
  success: boolean
  data: TradeRecord[]
  total: number
  page: number
  limit: number
  aggregates: Aggregates
}

const REASON_STYLES: Record<string, string> = {
  SL: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  TP: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  Manual: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  'Trailing Stop': 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  'AI Signal': 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  'Margin Call': 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200',
  'Stop Out': 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200',
}

function formatDuration(openTime: string, closeTime: string | null): string {
  if (!closeTime) return '—'
  const ms = new Date(closeTime).getTime() - new Date(openTime).getTime()
  const totalMin = Math.floor(ms / 60000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return `${d}d ${rh}h`
}

function formatCloseTime(ct: string | null): string {
  if (!ct) return '—'
  const d = new Date(ct)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function TradeHistory() {
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [total, setTotal] = useState(0)
  const [aggregates, setAggregates] = useState<Aggregates | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [symbolFilter, setSymbolFilter] = useState('')
  const [strategyFilter, setStrategyFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Sort
  const [sortField, setSortField] = useState<SortField>('closeTime')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const limit = 20

  const fetchTrades = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(limit))
      params.set('sort', sortField)
      params.set('order', sortDir)
      if (symbolFilter) params.set('symbol', symbolFilter)
      if (strategyFilter) params.set('strategy', strategyFilter)
      if (outcomeFilter !== 'all') params.set('outcome', outcomeFilter)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const res = await fetch(`/api/trades/history?${params.toString()}`)
      if (!res.ok) {
        throw new Error('Failed to fetch trades')
      }
      const json: HistoryResponse = await res.json()
      if (json.success) {
        setTrades(json.data)
        setTotal(json.total)
        setAggregates(json.aggregates)
      } else {
        throw new Error('API returned error')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [page, symbolFilter, strategyFilter, outcomeFilter, startDate, endDate, sortField, sortDir])

  useEffect(() => {
    fetchTrades()
  }, [fetchTrades])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [symbolFilter, strategyFilter, outcomeFilter, startDate, endDate, sortField, sortDir])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const totalPages = Math.ceil(total / limit)

  // Summary stats (from server-side aggregates, not current page)
  const totalPnl = aggregates?.totalPnl ?? 0
  const winRate = aggregates?.winRate ?? 0
  const avgPnl = aggregates?.avgPnl ?? 0
  const totalCommission = aggregates?.totalCommission ?? 0
  const totalSlippage = aggregates?.totalSlippage ?? 0

  function renderPagination() {
    if (totalPages <= 1) return null

    const pages: (number | 'ellipsis')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push('ellipsis')
      const start = Math.max(2, page - 1)
      const end = Math.min(totalPages - 1, page + 1)
      for (let i = start; i <= end; i++) pages.push(i)
      if (page < totalPages - 2) pages.push('ellipsis')
      pages.push(totalPages)
    }

    return (
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === 'ellipsis' ? (
              <PaginationItem key={`e${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  onClick={() => setPage(p)}
                  isActive={p === page}
                  className="cursor-pointer"
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <TrendingUp className="h-4 w-4" />
            Total P&L
          </div>
          <p className={`text-xl font-bold ${totalPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ${totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <BarChart3 className="h-4 w-4" />
            Win Rate
          </div>
          <p className="text-xl font-bold">
            {winRate.toFixed(1)}%
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <TrendingDown className="h-4 w-4" />
            Avg P&L
          </div>
          <p className={`text-xl font-bold ${avgPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ${avgPnl >= 0 ? '+' : ''}{avgPnl.toFixed(2)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            Commission
          </div>
          <p className="text-xl font-bold text-amber-600">
            -${totalCommission.toFixed(2)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            Slippage
          </div>
          <p className="text-xl font-bold text-red-600">
            -${totalSlippage.toFixed(2)}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground mb-1 block">Symbol</label>
              <Input
                placeholder="e.g. BBCA"
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground mb-1 block">Strategy</label>
              <Input
                placeholder="e.g. SMA"
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="w-[120px]">
              <label className="text-xs text-muted-foreground mb-1 block">Outcome</label>
              <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
                <SelectTrigger size="sm" className="h-8 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="win">Win</SelectItem>
                  <SelectItem value="loss">Loss</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[130px]">
              <label className="text-xs text-muted-foreground mb-1 block">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="min-w-[130px]">
              <label className="text-xs text-muted-foreground mb-1 block">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setSymbolFilter('')
                setStrategyFilter('')
                setOutcomeFilter('all')
                setStartDate('')
                setEndDate('')
              }}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Trade Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              Closed Trades
              {total > 0 && (
                <span className="ml-2 text-muted-foreground font-normal">
                  ({total} total)
                </span>
              )}
            </CardTitle>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="p-4 text-sm text-red-600">Error: {error}</div>
          )}

          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : trades.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No closed trades found matching your filters.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Symbol</TableHead>
                      <TableHead className="text-xs">Direction</TableHead>
                      <TableHead className="text-xs">Strategy</TableHead>
                      <TableHead className="text-xs text-right">Entry Price</TableHead>
                      <TableHead className="text-xs text-right">Close Price</TableHead>
                      <TableHead
                        className="text-xs text-right cursor-pointer select-none"
                        onClick={() => handleSort('pnl')}
                      >
                        <span className="inline-flex items-center gap-1">
                          P&L
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </TableHead>
                      <TableHead
                        className="text-xs text-right cursor-pointer select-none"
                        onClick={() => handleSort('pnlPercent')}
                      >
                        <span className="inline-flex items-center gap-1">
                          P&L %
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </TableHead>
                      <TableHead className="text-xs">Reason</TableHead>
                      <TableHead className="text-xs">Duration</TableHead>
                      <TableHead
                        className="text-xs cursor-pointer select-none"
                        onClick={() => handleSort('closeTime')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Close Time
                          <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="text-xs font-medium">{trade.symbol}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 h-5 ${
                              trade.direction === 'BUY'
                                ? 'border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50'
                                : 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950/50'
                            }`}
                          >
                            {trade.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {trade.strategy || '—'}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {trade.entryPrice.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {trade.closePrice?.toFixed(0) ?? '—'}
                        </TableCell>
                        <TableCell
                          className={`text-xs text-right font-semibold ${
                            trade.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                        </TableCell>
                        <TableCell
                          className={`text-xs text-right ${
                            trade.pnlPercent >= 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                        </TableCell>
                        <TableCell>
                          {trade.reason ? (
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 h-5 ${
                                REASON_STYLES[trade.reason] || ''
                              }`}
                            >
                              {trade.reason}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDuration(trade.openTime, trade.closeTime)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatCloseTime(trade.closeTime)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-muted-foreground">
                  Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
                </span>
                {renderPagination()}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
