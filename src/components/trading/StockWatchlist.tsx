'use client'

import { useEffect, useState, useCallback } from 'react'
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

const defaultStocks: Stock[] = [
  { symbol: 'BBCA', price: 9875, change: 125, changePercent: 1.28, volume: 15234567, marketCap: 1175000000000000 },
  { symbol: 'BBRI', price: 5425, change: -50, changePercent: -0.91, volume: 28765432, marketCap: 821000000000000 },
  { symbol: 'TLKM', price: 3450, change: 30, changePercent: 0.88, volume: 19876543, marketCap: 341000000000000 },
  { symbol: 'ASII', price: 5125, change: -25, changePercent: -0.49, volume: 8765432, marketCap: 199000000000000 },
  { symbol: 'UNVR', price: 4210, change: 60, changePercent: 1.45, volume: 5432109, marketCap: 163000000000000 },
  { symbol: 'BMRI', price: 6250, change: 75, changePercent: 1.22, volume: 12345678, marketCap: 590000000000000 },
  { symbol: 'GOTO', price: 82, change: 3, changePercent: 3.80, volume: 98765432, marketCap: 96000000000000 },
  { symbol: 'BRIS', price: 8850, change: -100, changePercent: -1.12, volume: 7654321, marketCap: 117000000000000 },
  { symbol: 'ICBP', price: 11250, change: 200, changePercent: 1.81, volume: 4321098, marketCap: 270000000000000 },
  { symbol: 'ARTO', price: 2650, change: -15, changePercent: -0.56, volume: 6543210, marketCap: 63000000000000 },
  { symbol: 'EXCL', price: 2340, change: 45, changePercent: 1.96, volume: 3456789, marketCap: 67000000000000 },
  { symbol: 'TBIG', price: 3150, change: -30, changePercent: -0.94, volume: 2345678, marketCap: 92000000000000 },
]

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
  const [stocks, setStocks] = useState<Stock[]>(defaultStocks)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchStocks = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks')
      if (res.ok) {
        const json = await res.json()
        setStocks(Array.isArray(json) ? json : json.stocks ?? defaultStocks)
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStocks()
    const interval = setInterval(fetchStocks, 10000)
    return () => clearInterval(interval)
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
