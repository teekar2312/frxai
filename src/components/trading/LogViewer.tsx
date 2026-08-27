'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Terminal, Filter, RefreshCw, Bug, Info, AlertTriangle, XCircle, AlertOctagon, Skull } from 'lucide-react'

interface LogEntry {
  id: string
  level: string
  category: string
  message: string
  source: string | null
  details: string | null
  tradeId: string | null
  symbol: string | null
  createdAt: string
}

interface LogStats {
  total: number
  lastHourTotal: number
  lastHourErrors: number
  byLevel: { level: string; count: number }[]
  byCategory: { category: string; count: number }[]
}

const LEVEL_CONFIG: Record<string, { icon: typeof Bug; color: string; bg: string; badgeClass: string }> = {
  DEBUG: { icon: Bug, color: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-950/30', badgeClass: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200' },
  INFO: { icon: Info, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  WARN: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  ERROR: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  CRITICAL: { icon: AlertOctagon, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30', badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  FATAL: { icon: Skull, color: 'text-red-800', bg: 'bg-red-100 dark:bg-red-950/50', badgeClass: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100' },
}

const CATEGORIES = [
  'ALL', 'MT5_CONNECTION', 'TRADE_EXECUTION', 'RISK_MANAGEMENT',
  'MONEY_MANAGEMENT', 'DATA_FEED', 'AI_ENGINE', 'SYSTEM', 'NOTIFICATION',
]

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [levelFilter, setLevelFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (levelFilter !== 'ALL') params.set('level', levelFilter)
      if (categoryFilter !== 'ALL') params.set('category', categoryFilter)

      const res = await fetch(`/api/logs?${params}`)
      if (res.ok) {
        const json = await res.json()
        setLogs(json.data.logs || [])
        setStats(json.data.stats || null)
      }
    } catch {
      // use stale data
    } finally {
      setLoading(false)
    }
  }, [levelFilter, categoryFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchLogs])

  const filteredLogs = logs

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
          <Terminal className="h-5 w-5 text-muted-foreground" />
          System Logs
        </h2>
        <div className="flex items-center gap-2">
          {stats && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span>{stats.total} total</span>
              <span className="text-red-500 font-medium">{stats.lastHourErrors} errors/hr</span>
            </div>
          )}
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            className={autoRefresh ? 'h-7 text-xs bg-emerald-600 hover:bg-emerald-700' : 'h-7 text-xs'}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${autoRefresh ? 'animate-spin' : ''}`} style={autoRefresh ? { animationDuration: '3s' } : {}} />
            Live
          </Button>
        </div>
      </div>

      {/* ---- Stats Bar ---- */}
      {stats && (
        <div className="flex flex-wrap gap-2">
          {stats.byLevel.map((l) => {
            const cfg = LEVEL_CONFIG[l.level]
            if (!cfg) return null
            const Icon = cfg.icon
            return (
              <Badge key={l.level} variant="outline" className={`text-xs gap-1 ${cfg.color}`}>
                <Icon className="h-3 w-3" />
                {l.level}: {l.count}
              </Badge>
            )
          })}
        </div>
      )}

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Levels</SelectItem>
              {Object.keys(LEVEL_CONFIG).map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c === 'ALL' ? 'All Categories' : c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground self-center">
          {filteredLogs.length} entries
        </span>
      </div>

      {/* ---- Log Entries ---- */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            {filteredLogs.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {loading ? 'Loading logs...' : 'No log entries found'}
              </div>
            ) : (
              <div className="divide-y">
                {filteredLogs.map((entry) => {
                  const cfg = LEVEL_CONFIG[entry.level]
                  if (!cfg) return null
                  const Icon = cfg.icon
                  return (
                    <div key={entry.id} className={`flex gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 ${cfg.bg}`}
                      >
                      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${cfg.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.badgeClass}`}>
                            {entry.level}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {entry.category}
                          </Badge>
                          {entry.symbol && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                              {entry.symbol}
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                            {new Date(entry.createdAt).toLocaleTimeString('id-ID')}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed break-words">{entry.message}</p>
                        {entry.details && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:underline">
                              Details
                            </summary>
                            <pre className="text-[10px] mt-1 p-2 rounded bg-muted/50 overflow-x-auto max-h-32 overflow-y-auto">
                              {entry.details}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
