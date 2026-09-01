'use client'

import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  LineChart,
  BrainCircuit,
  Newspaper,
  Bell,
  Shield,
  ShieldCheck,
  FlaskConical,
  Cpu,
  Globe,
  Bot,
  Wifi,
  WifiOff,
  Terminal,
  Loader2,
  AlertCircle,
  Clock,
  History,
} from 'lucide-react'
import AccountSummary from '@/components/trading/AccountSummary'
import StockWatchlist from '@/components/trading/StockWatchlist'
import TradingPositions from '@/components/trading/TradingPositions'
import AiAnalysisPanel from '@/components/trading/AiAnalysisPanel'
import NewsFeed from '@/components/trading/NewsFeed'
import PriceAlerts from '@/components/trading/PriceAlerts'
import RiskManagement from '@/components/trading/RiskManagement'
import BacktestPanel from '@/components/trading/BacktestPanel'
import StrategyMonitor from '@/components/trading/StrategyMonitor'
import TradingSessions from '@/components/trading/TradingSessions'
import EquityChart from '@/components/trading/EquityChart'
import LogViewer from '@/components/trading/LogViewer'
import AuditCompliance from '@/components/trading/AuditCompliance'
import TradeHistory from '@/components/trading/TradeHistory'
import SentimentFilter from '@/components/trading/SentimentFilter'
import { useLiveNotifications } from '@/lib/notification-hooks'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'trading', label: 'Live Trading', icon: LineChart },
  { id: 'ai', label: 'AI & Sentiment', icon: BrainCircuit },
  { id: 'strategies', label: 'Strategies', icon: Cpu },
  { id: 'risk', label: 'Risk & Money', icon: Shield },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'backtest', label: 'Backtest', icon: FlaskConical },
  { id: 'sessions', label: 'Sessions', icon: Globe },
  { id: 'logs', label: 'System Logs', icon: Terminal },
  { id: 'audit', label: 'Audit', icon: ShieldCheck },
  { id: 'history', label: 'Trade History', icon: History },
] as const

type TabId = (typeof NAV_ITEMS)[number]['id']

export default function TradingDashboard() {
  // Enable toast notifications for critical risk events
  useLiveNotifications()

  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [autoTrading, setAutoTrading] = useState(false)

  // Load initial auto-trading state from server
  useEffect(() => {
    fetch('/api/system/trading-enabled').then(r => r.json()).then(json => {
      if (json.success) setAutoTrading(json.data.enabled)
    }).catch(() => {})
  }, [])

  const handleToggleAutoTrading = useCallback(async () => {
    const newValue = !autoTrading
    setAutoTrading(newValue)
    try {
      await fetch('/api/system/trading-enabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newValue }),
      })
    } catch { /* revert on error */ setAutoTrading(!newValue) }
  }, [autoTrading])
  const [mt5Status, setMt5Status] = useState<string>('DISCONNECTED')
  const [mt5Latency, setMt5Latency] = useState<number>(0)
  const [mt5Uptime, setMt5Uptime] = useState<number>(0)
  const [isMarketOpen, setIsMarketOpen] = useState(false)
  const [tradingPhase, setTradingPhase] = useState('CLOSED')

  const fetchMt5Status = useCallback(async () => {
    try {
      const res = await fetch('/api/mt5/status')
      if (res.ok) {
        const json = await res.json()
        setMt5Status(json.data.status)
        setMt5Latency(json.data.latencyMs)
        setMt5Uptime(json.data.uptimeSeconds)
        setIsMarketOpen(json.data.isMarketOpen)
        setTradingPhase(json.data.tradingPhase)
      }
    } catch { /* stale */ }
  }, [])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    const startPolling = () => {
      fetchMt5Status()
      interval = setInterval(fetchMt5Status, 10000)
    }
    const stopPolling = () => {
      clearInterval(interval)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchMt5Status])

  const isConnected = mt5Status === 'CONNECTED'
  const isDegraded = mt5Status === 'DEGRADED'
  const isReconnecting = mt5Status === 'RECONNECTING'
  const isAuthFailed = mt5Status === 'AUTH_FAILED'

  function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-bold leading-none tracking-tight">FINEX AI Trader</h1>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                Indonesian Stock Market
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {/* Market Hours - Deep Audit */}
            <Badge
              variant={isMarketOpen ? 'default' : 'outline'}
              className={"h-6 gap-1 text-[10px] " + (isMarketOpen ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
            >
              <Clock className="h-3 w-3" />
              IDX {isMarketOpen ? 'OPEN' : tradingPhase === 'CLOSED' ? 'CLOSED' : tradingPhase}
            </Badge>

            <div className="hidden md:flex items-center gap-2">
              <Button
                variant={autoTrading ? 'default' : 'outline'}
                size="sm"
                className={"h-7 gap-1.5 text-xs " + (autoTrading ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
                onClick={handleToggleAutoTrading}
              >
                {autoTrading && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                  </span>
                )}
                Auto Trading {autoTrading ? 'ON' : 'OFF'}
              </Button>
            </div>

            {/* MT5 Connection Status */}
            <Badge
              variant={isConnected ? 'default' : isAuthFailed || isDegraded ? 'destructive' : 'outline'}
              className={"h-6 gap-1 text-[10px] " + (isConnected ? 'bg-emerald-600 hover:bg-emerald-700' : isDegraded ? 'bg-orange-600 hover:bg-orange-700 text-white border-orange-600' : isReconnecting ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600' : '')}
            >
              {isReconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : isConnected ? <Wifi className="h-3 w-3" /> : isAuthFailed ? <AlertCircle className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isConnected ? `MT5 ${mt5Latency}ms` : isDegraded ? `DEGRADED ${mt5Latency}ms` : isReconnecting ? 'Reconnecting...' : isAuthFailed ? 'Auth Failed' : 'Disconnected'}
            </Badge>

            {isConnected && mt5Uptime > 0 && (
              <span className="hidden lg:inline text-[10px] text-muted-foreground">
                Up {formatUptime(mt5Uptime)}
              </span>
            )}

            <Badge variant="outline" className="hidden sm:flex h-6 text-[10px]">
              Real Account
            </Badge>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 lg:px-6 py-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
          <div className="mb-4 overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
            <TabsList className="w-full justify-start bg-muted p-1 h-auto gap-0.5 min-w-max lg:min-w-0">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          <TabsContent value="dashboard" className="space-y-6">
            <AccountSummary />
            <EquityChart isMarketOpen={isMarketOpen} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <StockWatchlist />
              <TradingPositions />
            </div>
            <TradingSessions />
          </TabsContent>

          <TabsContent value="trading" className="space-y-6">
            <TradingPositions />
            <StockWatchlist />
          </TabsContent>

          <TabsContent value="ai" className="space-y-6">
            <AiAnalysisPanel />
            <SentimentFilter />
          </TabsContent>

          <TabsContent value="strategies" className="space-y-6">
            <StrategyMonitor />
          </TabsContent>

          <TabsContent value="news" className="space-y-6">
            <NewsFeed />
          </TabsContent>

          <TabsContent value="alerts" className="space-y-6">
            <PriceAlerts />
          </TabsContent>

          <TabsContent value="risk" className="space-y-6">
            <RiskManagement />
          </TabsContent>

          <TabsContent value="logs" className="space-y-6">
            <LogViewer />
          </TabsContent>

          <TabsContent value="backtest" className="space-y-6">
            <BacktestPanel />
          </TabsContent>

          <TabsContent value="audit" className="space-y-6">
            <AuditCompliance />
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <TradeHistory />
          </TabsContent>

          <TabsContent value="sessions" className="space-y-6">
            <TradingSessions />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t bg-background mt-auto">
        <div className="flex h-10 items-center justify-between px-4 lg:px-6 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>FINEX Indonesia Broker</span>
            <span className="hidden sm:inline">|</span>
            <span className="hidden sm:inline">Leverage 1:25</span>
            <span className="hidden sm:inline">|</span>
            <span className="hidden sm:inline">Spread from 0.5 pip</span>
            <span className="hidden sm:inline">|</span>
            <span className="hidden sm:inline">Commission $1/lot</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden md:inline">MC: 50%</span>
            <span className="hidden md:inline">|</span>
            <span className="hidden md:inline">SO: 20%</span>
            <span className="hidden lg:inline">|</span>
            <span className="hidden lg:inline">Proactive: 70%/60%</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
