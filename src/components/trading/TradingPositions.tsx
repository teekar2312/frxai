'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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
import { Plus, X, Wind } from 'lucide-react'
import { toast } from 'sonner'

interface Trade {
  id: string
  symbol: string
  direction: 'BUY' | 'SELL'
  lotSize: number
  entryPrice: number
  currentPrice: number
  sl: number | null
  tp: number | null
  pnl: number
  strategy: string
  trailingStop: boolean
  trailingDist: number | null
}

const SYMBOLS = [
  'BBCA', 'BBRI', 'TLKM', 'ASII', 'UNVR', 'BMRI', 'GOTO', 'BRIS', 'ICBP', 'ARTO', 'EXCL',
]
const STRATEGIES = [
  'Momentum Breakout',
  'Mean Reversion',
  'Scalping',
  'Swing Trade',
  'News Trading',
  'Support/Resistance',
]

function formatIDR(value: number): string {
  return `Rp ${value.toLocaleString('id-ID')}`
}

export default function TradingPositions() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  // New trade form state
  const [newSymbol, setNewSymbol] = useState('')
  const [newDirection, setNewDirection] = useState<'BUY' | 'SELL'>('BUY')
  const [newLotSize, setNewLotSize] = useState('0.1')
  const [newSL, setNewSL] = useState('')
  const [newTP, setNewTP] = useState('')
  const [newStrategy, setNewStrategy] = useState('')
  const [newTrailingStop, setNewTrailingStop] = useState(false)
  const [newTrailingDist, setNewTrailingDist] = useState('')

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/trades')
      if (res.ok) {
        const json = await res.json()
        setTrades(json.data ?? [])
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrades()
    const interval = setInterval(fetchTrades, 5000)
    return () => clearInterval(interval)
  }, [fetchTrades])

  const handleCloseTrade = async (id: string) => {
    try {
      const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setTrades((prev) => prev.filter((t) => t.id !== id))
      }
    } catch {
      // Keep trade in list on failure
    }
  }

  const handleToggleTrailingStop = async (id: string) => {
    const trade = trades.find((t) => t.id === id)
    if (!trade) return

    // Optimistic UI update
    const newTrailingState = !trade.trailingStop
    setTrades((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, trailingStop: newTrailingState } : t
      )
    )

    try {
      await fetch(`/api/trades/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trailingStop: newTrailingState }),
      })
    } catch {
      // Revert on failure
      setTrades((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, trailingStop: !newTrailingState } : t
        )
      )
    }
  }

  const handleSubmitNewTrade = async () => {
    if (!newSymbol) return
    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newSymbol,
          direction: newDirection,
          lotSize: parseFloat(newLotSize) || 0.1,
          sl: newSL ? parseFloat(newSL) : null,
          tp: newTP ? parseFloat(newTP) : null,
          strategy: newStrategy,
          trailingStop: newTrailingStop,
          trailingDistance: newTrailingDist ? parseFloat(newTrailingDist) : null,
        }),
      })
      if (res.ok) {
        // Response body still consumed; binding dropped (was unused)
        await res.json()
        setDialogOpen(false)
        resetForm()
        // Re-fetch to get server-side trade with real ID
        fetchTrades()
      } else {
        toast.error('Failed to open trade')
      }
    } catch {
      toast.error('Failed to open trade')
    }
  }

  const resetForm = () => {
    setNewSymbol('')
    setNewDirection('BUY')
    setNewLotSize('0.1')
    setNewSL('')
    setNewTP('')
    setNewStrategy('')
    setNewTrailingStop(false)
    setNewTrailingDist('')
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            Open Positions{' '}
            <span className="text-muted-foreground font-normal">({trades.length})</span>
          </CardTitle>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                New Trade
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Open New Trade</DialogTitle>
                <DialogDescription>
                  Fill in the details to open a new position.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Symbol</label>
                    <Select value={newSymbol} onValueChange={setNewSymbol}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select symbol" />
                      </SelectTrigger>
                      <SelectContent>
                        {SYMBOLS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Direction</label>
                    <Select
                      value={newDirection}
                      onValueChange={(v) => setNewDirection(v as 'BUY' | 'SELL')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BUY">BUY</SelectItem>
                        <SelectItem value="SELL">SELL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Lot Size</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={newLotSize}
                    onChange={(e) => setNewLotSize(e.target.value)}
                    placeholder="0.1"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Stop Loss (IDR)</label>
                    <Input
                      type="number"
                      value={newSL}
                      onChange={(e) => setNewSL(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Take Profit (IDR)</label>
                    <Input
                      type="number"
                      value={newTP}
                      onChange={(e) => setNewTP(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Strategy</label>
                  <Select value={newStrategy} onValueChange={setNewStrategy}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Trailing Stop</p>
                    <p className="text-xs text-muted-foreground">
                      Automatically adjust stop loss as price moves favorably
                    </p>
                  </div>
                  <Switch
                    checked={newTrailingStop}
                    onCheckedChange={setNewTrailingStop}
                  />
                </div>

                {newTrailingStop && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Trailing Distance (IDR)</label>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={newTrailingDist}
                      onChange={(e) => setNewTrailingDist(e.target.value)}
                      placeholder="e.g. 50"
                    />
                    <p className="text-xs text-muted-foreground">
                      SL ratchets once price moves this far in your favor.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitNewTrade}
                  disabled={!newSymbol || (newTrailingStop && !newTrailingDist)}
                >
                  Open Position
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead className="text-right">Lot</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Entry</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right hidden md:table-cell">SL</TableHead>
                <TableHead className="text-right hidden md:table-cell">TP</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="hidden lg:table-cell">Strategy</TableHead>
                <TableHead className="hidden xl:table-cell">Trailing</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={11} className="h-10 text-center text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ))
                : trades.map((trade) => {
                    const isProfit = trade.pnl >= 0
                    return (
                      <TableRow key={trade.id}>
                        <TableCell className="font-semibold">
                          {trade.symbol}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={trade.direction === 'BUY' ? 'default' : 'destructive'}
                            className={
                              trade.direction === 'BUY'
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : ''
                            }
                          >
                            {trade.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {trade.lotSize}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden sm:table-cell">
                          {trade.entryPrice > 0 ? formatIDR(trade.entryPrice) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {trade.currentPrice > 0 ? formatIDR(trade.currentPrice) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">
                          {trade.sl ? formatIDR(trade.sl) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">
                          {trade.tp ? formatIDR(trade.tp) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm font-semibold ${
                              isProfit ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {isProfit ? '+' : ''}
                            {trade.pnl.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">
                            {trade.strategy}
                          </span>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <Badge
                            variant={trade.trailingStop ? 'default' : 'outline'}
                            className={
                              trade.trailingStop
                                ? 'bg-sky-600 hover:bg-sky-700'
                                : ''
                            }
                          >
                            {trade.trailingStop ? 'Active' : 'Off'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={() => handleToggleTrailingStop(trade.id)}
                              title="Toggle Trailing Stop"
                            >
                              <Wind className="h-3 w-3" />
                              <span className="hidden sm:inline">Trail</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleCloseTrade(trade.id)}
                              title="Close Trade"
                            >
                              <X className="h-3 w-3" />
                              <span className="hidden sm:inline">Close</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
            </TableBody>
          </Table>
        </div>
        {trades.length === 0 && !loading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No open positions
          </div>
        )}
      </CardContent>
    </Card>
  )
}
