'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Play,
  Square,
  RefreshCw,
  Settings2,
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Minus,
  TrendingUp,
  TrendingDown,
  Zap,
  ChevronDown,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'

// ============================================
// TYPES
// ============================================

interface AutoTradingStatus {
  running: boolean
  enabled: boolean
  config: AutoTradingConfig
  lastScanAt: string | null
  nextScanAt: string | null
  scanCount: number
  tradesOpened: number
  tradesRejected: number
  tradesClosedByAI: number
  lastError: string | null
  currentDecisions: AutoTradingDecisionPreview[]
  uptimeSeconds: number
  startedAt: string | null
  brokerPositionsSynced: boolean
  lastSyncAt: string | null
}

/** Minimal shape of a live decision preview (fields consumed by the UI). */
interface AutoTradingDecisionPreview {
  symbol: string
  decision: string
  confidence: number
}

interface AutoTradingConfig {
  enabled: boolean
  scanIntervalMs: number
  mode: 'SINGLE_STRATEGY' | 'MULTI_STRATEGY'
  strategyId: string
  timeframe: string
  maxOpenPositions: number
  watchlist: string[]
  enabledStrategies: string[]
  adaptiveLearning: boolean
  positionSyncIntervalMs: number
}

interface ScanResult {
  timestamp: string
  symbol: string
  decision: { decision: string; confidence: number; reasoning: string; strategyUsed: string }
  actionTaken: string
  actionDetails: string
  tradeId?: string
}

const AVAILABLE_SYMBOLS = [
  'BBRI', 'BBCA', 'BMRI', 'BBNI', 'BRIS', 'ARTO',
  'TLKM', 'EXCL', 'ASII', 'UNVR', 'ICBP', 'GOTO',
  'TBIG', 'ANTM', 'TINS', 'ADRO', 'PGAS', 'MEDC',
  'WSKT', 'JSMR', 'INKP', 'SMGR', 'EMTK',
]

const TIMEFRAMES = ['M5', 'M15', 'H1', 'H4']
const SCAN_INTERVALS = [
  { label: '15 detik', value: 15000 },
  { label: '30 detik', value: 30000 },
  { label: '1 menit', value: 60000 },
  { label: '2 menit', value: 120000 },
  { label: '5 menit', value: 300000 },
]

export default function AutoTradingDashboard() {
  const [status, setStatus] = useState<AutoTradingStatus | null>(null)
  const [recentScans, setRecentScans] = useState<ScanResult[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Local config state
  const [mode, setMode] = useState<'SINGLE_STRATEGY' | 'MULTI_STRATEGY'>('MULTI_STRATEGY')
  const [timeframe, setTimeframe] = useState('M15')
  const [scanInterval, setScanInterval] = useState(60000)
  const [maxPositions, setMaxPositions] = useState(3)
  const [watchlist, setWatchlist] = useState<string[]>(['BBRI', 'BBCA', 'BMRI', 'TLKM', 'ASII', 'ANTM'])
  const [adaptiveLearning, setAdaptiveLearning] = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auto-trading')
      if (res.ok) {
        const json = await res.json()
        setStatus(json.data?.status ?? json.data)
        setRecentScans(json.data?.recentScans ?? [])

        // Sync local config from server
        if (json.data?.config) {
          const cfg = json.data.config as AutoTradingConfig
          setMode(cfg.mode)
          setTimeframe(cfg.timeframe)
          setScanInterval(cfg.scanIntervalMs)
          setMaxPositions(cfg.maxOpenPositions)
          setWatchlist(cfg.watchlist ?? [])
          setAdaptiveLearning(cfg.adaptiveLearning)
        }
      }
    } catch {
      // use stale
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    pollRef.current = setInterval(fetchStatus, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchStatus])

  const handleStart = async () => {
    setStarting(true)
    try {
      const res = await fetch('/api/auto-trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      if (res.ok) {
        toast.success('Auto-trading dimulai')
        fetchStatus()
      } else {
        const json = await res.json().catch(() => ({}))
        toast.error(`Gagal memulai: ${json.error || 'Unknown'}`)
      }
    } catch {
      toast.error('Gagal menghubungi server')
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    setStopping(true)
    try {
      await fetch('/api/auto-trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
      toast.success('Auto-trading dihentikan')
      fetchStatus()
    } catch {
      toast.error('Gagal menghentikan')
    } finally {
      setStopping(false)
    }
  }

  const handleSaveConfig = async () => {
    try {
      const res = await fetch('/api/auto-trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure',
          mode,
          timeframe,
          scanIntervalMs: scanInterval,
          maxOpenPositions: maxPositions,
          watchlist,
          adaptiveLearning,
        }),
      })
      if (res.ok) {
        toast.success('Konfigurasi loop disimpan')
      } else {
        const json = await res.json().catch(() => ({}))
        toast.error(`Gagal: ${json.error || 'Unknown'}`)
      }
    } catch {
      toast.error('Gagal menyimpan konfigurasi')
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/execution/sync', { method: 'POST' })
      if (res.ok) {
        const json = await res.json()
        toast.success(`Sinkronisasi berhasil: ${json.data?.brokerPositionCount ?? 0} posisi`)  
        fetchStatus()
      } else {
        toast.error('Sinkronisasi gagal')
      }
    } catch {
      toast.error('Gagal sinkronisasi')
    } finally {
      setSyncing(false)
    }
  }

  const toggleWatchlistSymbol = (symbol: string) => {
    setWatchlist(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol],
    )
  }

  function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}d`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}d`
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}j ${m}m`
  }

  function formatTime(dateStr: string | null): string {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function getActionColor(action: string): string {
    switch (action) {
      case 'EXECUTED': return 'bg-emerald-600'
      case 'REJECTED_RISK': return 'bg-red-600'
      case 'ERROR': return 'bg-orange-600'
      case 'CLOSE_ALL': return 'bg-red-700'
      default: return 'bg-gray-500'
    }
  }

  function getDecisionBadge(decision: string, confidence: number) {
    switch (decision) {
      case 'BUY':
        return <Badge className="bg-emerald-600 hover:bg-emerald-700 gap-1 text-[10px]"><TrendingUp className="h-3 w-3" /> BUY {confidence}%</Badge>
      case 'SELL':
        return <Badge variant="destructive" className="gap-1 text-[10px]"><TrendingDown className="h-3 w-3" /> SELL {confidence}%</Badge>
      case 'HOLD':
        return <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground"><Minus className="h-3 w-3" /> HOLD</Badge>
      default:
        return <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">{decision}</Badge>
    }
  }

  if (loading || !status) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-spin h-6 w-6 border-2 border-emerald-600 border-t-transparent rounded-full" />
        </CardContent>
      </Card>
    )
  }

  const isRunning = status.running

  return (
    <div className="space-y-6">
      {/* Status Panel */}
      <Card className={isRunning ? 'border-emerald-500/50' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className={`h-4 w-4 ${isRunning ? 'text-emerald-500' : 'text-muted-foreground'}`} />
              Status Auto-Trading
            </CardTitle>
            <div className="flex items-center gap-2">
              {isRunning ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-700 gap-1 text-[10px]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                  </span>
                  RUNNING
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">STOPPED</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Control Buttons */}
          <div className="flex items-center gap-3">
            {!isRunning ? (
              <Button
                size="sm"
                onClick={handleStart}
                disabled={starting}
                className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
              >
                <Play className="h-3.5 w-3.5" />
                {starting ? 'Memulai...' : 'Mulai Auto-Trading'}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStop}
                disabled={stopping}
                className="text-xs gap-1.5"
              >
                <Square className="h-3.5 w-3.5" />
                {stopping ? 'Menghentikan...' : 'Hentikan'}
              </Button>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <MiniStat label="Scan" value={String(status.scanCount)} icon={<Activity className="h-3 w-3" />} />
            <MiniStat label="Trade Dibuka" value={String(status.tradesOpened)} icon={<CheckCircle2 className="h-3 w-3 text-emerald-500" />} />
            <MiniStat label="Ditolak" value={String(status.tradesRejected)} icon={<XCircle className="h-3 w-3 text-red-500" />} />
            <MiniStat label="Ditutup AI" value={String(status.tradesClosedByAI)} icon={<AlertTriangle className="h-3 w-3 text-amber-500" />} />
            <MiniStat label="Uptime" value={formatUptime(status.uptimeSeconds)} icon={<Clock className="h-3 w-3" />} />
            <MiniStat label="Scan Terakhir" value={formatTime(status.lastScanAt)} icon={<Eye className="h-3 w-3" />} />
            <MiniStat label="Scan Berikutnya" value={formatTime(status.nextScanAt)} icon={<Clock className="h-3 w-3" />} />
          </div>

          {/* Last Error */}
          {status.lastError && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-red-700 dark:text-red-400">Error Terakhir</p>
                <p className="text-[11px] text-red-600 dark:text-red-300 mt-0.5">{status.lastError}</p>
              </div>
            </div>
          )}

          {/* Current Decisions */}
          {status.currentDecisions && status.currentDecisions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground font-medium">Keputusan Saat Ini</p>
              <div className="flex flex-wrap gap-1.5">
                {status.currentDecisions.map((d: AutoTradingDecisionPreview, i: number) => (
                  <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px]">
                    <span className="font-mono font-bold">{d.symbol}</span>
                    {getDecisionBadge(d.decision, d.confidence)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Konfigurasi Loop */}
      <Card>
        <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger className="w-full flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                Konfigurasi Loop
              </CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${configOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-5 border-t pt-4">
              {/* Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Mode</Label>
                  <Select value={mode} onValueChange={v => setMode(v === 'SINGLE_STRATEGY' ? 'SINGLE_STRATEGY' : 'MULTI_STRATEGY')}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MULTI_STRATEGY" className="text-xs">Multi-Strategi (Konsensus)</SelectItem>
                      <SelectItem value="SINGLE_STRATEGY" className="text-xs">Strategi Tunggal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Timeframe</Label>
                  <Select value={timeframe} onValueChange={setTimeframe}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEFRAMES.map(tf => (
                        <SelectItem key={tf} value={tf} className="text-xs">{tf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Interval Scan</Label>
                  <Select value={String(scanInterval)} onValueChange={v => setScanInterval(Number(v))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SCAN_INTERVALS.map(si => (
                        <SelectItem key={si.value} value={String(si.value)} className="text-xs">{si.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Maks. Posisi Terbuka</Label>
                  <Select value={String(maxPositions)} onValueChange={v => setMaxPositions(Number(v))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5,6,7,8,9,10].map(n => (
                        <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Adaptive Learning Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <Label className="text-xs font-medium">Adaptive Learning</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Otomatis menyesuaikan bobot berdasarkan performa historis</p>
                </div>
                <Switch checked={adaptiveLearning} onCheckedChange={setAdaptiveLearning} />
              </div>

              {/* Watchlist */}
              <Collapsible open={watchlistOpen} onOpenChange={setWatchlistOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronDown className={`h-3 w-3 transition-transform ${watchlistOpen ? 'rotate-180' : ''}`} />
                  Watchlist ({watchlist.length} simbol)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {AVAILABLE_SYMBOLS.map(symbol => (
                      <button
                        key={symbol}
                        onClick={() => toggleWatchlistSymbol(symbol)}
                        className={`
                          px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors
                          ${watchlist.includes(symbol)
                            ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                            : 'bg-background border-border hover:border-emerald-500 text-muted-foreground'
                          }
                        `}
                      >
                        {symbol}
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={handleSaveConfig}
                  className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Simpan Konfigurasi Loop
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Posisi Broker & Sync */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''} text-blue-500`} />
              Posisi Broker
            </CardTitle>
            <div className="flex items-center gap-3">
              {status.lastSyncAt && (
                <span className="text-[10px] text-muted-foreground">
                  Terakhir sync: {formatTime(status.lastSyncAt)}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleSync}
                disabled={syncing}
                className="text-xs gap-1.5"
              >
                <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
                Sinkronisasi
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border space-y-1">
              <p className="text-[10px] text-muted-foreground">Status Sync</p>
              <p className="text-xs font-semibold">
                {status.brokerPositionsSynced ? (
                  <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Tersinkronisasi</span>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1"><XCircle className="h-3 w-3" /> Belum sync</span>
                )}
              </p>
            </div>
            <div className="p-3 rounded-lg border space-y-1">
              <p className="text-[10px] text-muted-foreground">Interval Sync</p>
              <p className="text-xs font-semibold">
                {status.config.positionSyncIntervalMs / 1000} detik
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Aktivitas Scan Terbaru */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" />
            Aktivitas Scan Terbaru
            {recentScans.length > 0 && (
              <Badge variant="outline" className="text-[10px] ml-auto">{recentScans.length} scan</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentScans.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              Belum ada aktivitas scan. Mulai auto-trading untuk melihat aktivitas.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1.5">
              {recentScans.slice().reverse().map((scan, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-lg border text-[11px] hover:bg-muted/50"
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${getActionColor(scan.actionTaken)}`} />
                  <span className="text-muted-foreground min-w-[5rem]">
                    {formatTime(scan.timestamp)}
                  </span>
                  <span className="font-mono font-bold min-w-[3rem]">{scan.symbol}</span>
                  {getDecisionBadge(scan.decision.decision, scan.decision.confidence)}
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {scan.actionTaken}
                  </Badge>
                  <span className="text-muted-foreground truncate flex-1 ml-auto" title={scan.actionDetails}>
                    {scan.actionDetails}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-2 rounded-lg border space-y-0.5">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-xs font-bold font-mono">{value}</p>
    </div>
  )
}
