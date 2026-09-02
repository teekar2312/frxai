'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search } from 'lucide-react'

interface Stock {
  symbol: string
  price: number
  change: number
  changePercent: number
  volume: number
  marketCap: number
}

function formatIDR(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(1)}T`
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  return value.toLocaleString('id-ID')
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return String(value)
}

function formatPrice(price: number): string {
  return `Rp ${price.toLocaleString('id-ID')}`
}

export default function StockWatchlist() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const abortRef = useRef<AbortController | null>(null)

  const fetchStocks = useCallback(async () => {
    try {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const res = await fetch('/api/stocks', { signal: controller.signal })
      if (res.ok) {
        const json = await res.json()
        setStocks(json.data ?? [])
      }
    } catch {
      // use stale data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStocks()
    const interval = setInterval(fetchStocks, 10000)
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval)
      } else {
        fetchStocks()
        // Need to restart interval — handle by re-running effect
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchStocks])

  const filtered = stocks.filter(
    (s) =>
      s.symbol.toLowerCase().includes(search.toLowerCase()) ||
      formatPrice(s.price).toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Stock Watchlist</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Price (IDR)</TableHead>
                <TableHead className="text-right">Change %</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Volume</TableHead>
                <TableHead className="text-right hidden md:table-cell">Market Cap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5} className="h-10 text-center text-muted-foreground">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ))
                : filtered.map((stock) => {
                    const isPositive = stock.changePercent >= 0
                    return (
                      <TableRow key={stock.symbol}>
                        <TableCell className="font-semibold">
                          {stock.symbol}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPrice(stock.price)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-sm font-medium ${
                              isPositive ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {isPositive ? '+' : ''}
                            {stock.changePercent.toFixed(2)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono hidden sm:table-cell">
                          {formatVolume(stock.volume)}
                        </TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">
                          {formatIDR(stock.marketCap)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
            </TableBody>
          </Table>
        </div>
        {filtered.length === 0 && !loading && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No stocks found matching &quot;{search}&quot;
          </div>
        )}
      </CardContent>
    </Card>
  )
}
