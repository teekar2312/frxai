'use client'

import { useState } from 'react'
import { useApiQuery, extractApiData } from '@/hooks/use-api-query'
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
  const [search, setSearch] = useState('')

  // Centralised 10s poll. The old hand-rolled visibility handler cleared the
  // interval on tab-hide and never restarted it (polling died permanently
  // after a tab switch) — that bug is gone with the hook.
  const { data, loading } = useApiQuery<Stock[]>({
    url: '/api/stocks',
    intervalMs: 10_000,
    initialData: [],
    transform: (json) => extractApiData<Stock[]>(json, []),
  })

  const stocks = data ?? []

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
