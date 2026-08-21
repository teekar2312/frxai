'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Menu, TrendingUp, Wifi, WifiOff, Globe, CircleDot, Cable, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { FOREX_PAIRS, type QuoteData, type ForexPair } from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';
import { safeLog } from '@/lib/safe-log';
import { t, initI18n } from '@/lib/i18n';
import { SidebarContent } from '@/components/trading/Sidebar';
import { DashboardPanel } from '@/components/trading/DashboardPanel';
import { ChartPanel } from '@/components/trading/ChartPanel';
import { AiAnalysisPanel } from '@/components/trading/AiAnalysisPanel';
import { TradingSignalsPanel } from '@/components/trading/TradingSignalsPanel';
import { LiveTradingPanel } from '@/components/trading/LiveTradingPanel';
import { PendingOrdersPanel } from '@/components/trading/PendingOrdersPanel';
import { RiskManagementPanel } from '@/components/trading/RiskManagementPanel';
import { PriceAlertsPanel } from '@/components/trading/PriceAlertsPanel';
import { EconomicCalendarPanel } from '@/components/trading/EconomicCalendarPanel';
import { TradeAnalyticsPanel } from '@/components/trading/TradeAnalyticsPanel';
import { BacktestingPanel } from '@/components/trading/BacktestingPanel';
import { CorrelationMatrixPanel } from '@/components/trading/CorrelationMatrixPanel';
import { WatchlistPanel } from '@/components/trading/WatchlistPanel';
import { SignalSharingPanel } from '@/components/trading/SignalSharingPanel';
import { ActivityLogPanel } from '@/components/trading/ActivityLogPanel';
import { SettingsPanel } from '@/components/trading/SettingsPanel';
import { TimeframeSessionBar } from '@/components/trading/TimeframeSessionBar';
import { NotificationBell } from '@/components/trading/NotificationCenter';

export default function TradingDashboard() {
  const { activeTab, setQuote, setNews, isAutoTrading, tradingMode, mt5ConnectionStatus } = useTradingStore();
  const [connected, setConnected] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [jakartaTime, setJakartaTime] = useState('');
  const [priceSourceWarning, setPriceSourceWarning] = useState(false);
  const [isSimulated, setIsSimulated] = useState(true);
  const [_newsSimulated, setNewsSimulated] = useState(true);
  const isMt5Live = tradingMode === 'mt5_live' && mt5ConnectionStatus === 'connected';
  const [isVisible, setIsVisible] = useState(true);

  // Initialize i18n on mount
  useEffect(() => { initI18n(); }, []);

  // Track tab visibility
  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Jakarta timezone clock
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      setJakartaTime(format(jakarta, 'HH:mm:ss'));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch prices every 5 seconds
  const fetchPrices = useCallback(async () => {
    try {
      if (isMt5Live) {
        const res = await fetch('/api/mt5/prices');
        if (res.ok) {
          const mt5Prices = await res.json() as Record<string, { bid: number; ask: number; timestamp: number }>;
          FOREX_PAIRS.forEach((pair) => {
            const p = mt5Prices[pair];
            if (p && p.bid > 0 && p.ask > 0) {
              const mid = (p.bid + p.ask) / 2;
              const spread = p.ask - p.bid;
              const pipSize = pair === 'USDJPY' || pair === 'XAUUSD' ? 0.01 : 0.0001;
              const spreadPips = spread / pipSize;
              const prev = useTradingStore.getState().quotes[pair];
              const change = prev ? mid - prev.mid : 0;
              const changePercent = prev?.mid ? (change / prev.mid) * 100 : 0;
              setQuote(pair, {
                pair,
                bid: p.bid,
                ask: p.ask,
                mid,
                spread: spreadPips,
                change,
                changePercent,
                high: Math.max(prev?.high ?? mid, mid),
                low: Math.min(prev?.low ?? mid, mid),
                timestamp: p.timestamp,
              });
            }
          });
          setConnected(true);
          return;
        }
        safeLog({ level: 'warn', route: 'Page', message: 'MT5 prices unavailable, skipping fetch cycle' });
        setPriceSourceWarning(true);
        return;
      }
      const res = await fetch('/api/finnhub');
      if (!res.ok) throw new Error('Failed to fetch prices');
      const data = await res.json();
      if (data.quotes) {
        FOREX_PAIRS.forEach((pair) => {
          if (data.quotes[pair]) setQuote(pair, data.quotes[pair] as QuoteData);
        });
      }
      if (data.triggeredAlerts?.length > 0) {
        for (const ta of data.triggeredAlerts) {
          toast.success(`🔔 ${ta.pair} ${ta.condition.replace('_', ' ')} ${ta.targetPrice}`);
        }
      }
      const sim = !!data.simulated;
      setIsSimulated(sim);
      setConnected(!sim || isMt5Live);
    } catch {
      setConnected(false);
    }
  }, [setQuote, isMt5Live]);

  useEffect(() => {
    fetchPrices();
    if (!isVisible) return;
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, [fetchPrices, isVisible]);

  // WebSocket auto-reconnect for real-time prices
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;
    const MAX_BACKOFF = 30000;
    let mounted = true;
    let intentionalClose = false;

    const connect = () => {
      if (!mounted || intentionalClose) return;

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/?XTransformPort=3005`;
        ws = new WebSocket(wsUrl);

        const connectionTimeout = setTimeout(() => {
          if (ws && ws.readyState === WebSocket.CONNECTING) {
            ws.close();
            fallbackToPolling();
          }
        }, 3000);

        ws.onopen = () => {
          clearTimeout(connectionTimeout);
          if (!mounted) return;
          backoffMs = 1000; // Reset backoff
          setConnected(true);
          setIsSimulated(false);
          safeLog({ level: 'info', route: 'WS', message: 'WebSocket connected to price service' });
        };

        ws.onmessage = (event) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'price' && data.pair && data.bid && data.ask) {
              const pair = data.pair as ForexPair;
              if (!FOREX_PAIRS.includes(pair)) return;
              const mid = (data.bid + data.ask) / 2;
              const spread = data.ask - data.bid;
              const pipSize = pair === 'USDJPY' || pair === 'XAUUSD' ? 0.01 : 0.0001;
              const spreadPips = spread / pipSize;
              const prev = useTradingStore.getState().quotes[pair];
              const change = prev ? mid - prev.mid : 0;
              const changePercent = prev?.mid ? (change / prev.mid) * 100 : 0;
              setQuote(pair, {
                pair, bid: data.bid, ask: data.ask, mid, spread: spreadPips,
                change, changePercent,
                high: Math.max(prev?.high ?? mid, mid),
                low: Math.min(prev?.low ?? mid, mid),
                timestamp: data.timestamp || Date.now(),
              });
            }
          } catch { /* ignore parse errors */ }
        };

        ws.onclose = () => {
          clearTimeout(connectionTimeout);
          if (!mounted || intentionalClose) return;
          safeLog({ level: 'info', route: 'WS', message: `WebSocket disconnected, reconnecting in ${backoffMs}ms` });
          scheduleReconnect();
        };

        ws.onerror = () => {
          clearTimeout(connectionTimeout);
          if (!mounted || intentionalClose) return;
        };
      } catch {
        if (!mounted) return;
        fallbackToPolling();
      }
    };

    const fallbackToPolling = () => {
      safeLog({ level: 'info', route: 'WS', message: 'WebSocket unavailable, using HTTP polling fallback' });
    };

    const scheduleReconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (!mounted) return;
        connect();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF);
    };

    connect();

    return () => {
      mounted = false;
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [setQuote]);

  // Fetch news every 120 seconds
  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news');
      if (res.ok) {
        const data = await res.json();
        if (data.news) {
          setNews(data.news);
          setNewsSimulated(!!data.simulated);
        }
      }
    } catch {
      // silent
    }
  }, [setNews]);

  useEffect(() => {
    fetchNews();
    if (!isVisible) return;
    const interval = setInterval(fetchNews, 120000);
    return () => clearInterval(interval);
  }, [fetchNews, isVisible]);

  // Panel router — 16 panels
  const renderPanel = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardPanel />;
      case 'chart': return <ChartPanel />;
      case 'ai-analysis': return <AiAnalysisPanel />;
      case 'trading-signals': return <TradingSignalsPanel />;
      case 'live-trading': return <LiveTradingPanel />;
      case 'pending-orders': return <PendingOrdersPanel />;
      case 'risk-management': return <RiskManagementPanel />;
      case 'price-alerts': return <PriceAlertsPanel />;
      case 'economic-calendar': return <EconomicCalendarPanel />;
      case 'trade-analytics': return <TradeAnalyticsPanel />;
      case 'backtesting': return <BacktestingPanel />;
      case 'correlation': return <CorrelationMatrixPanel />;
      case 'watchlist': return <WatchlistPanel />;
      case 'signal-sharing': return <SignalSharingPanel />;
      case 'activity-log': return <ActivityLogPanel />;
      case 'settings': return <SettingsPanel />;
      default: return <DashboardPanel />;
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
        {/* Status bar */}
        <div className="h-8 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-3 text-[11px] text-zinc-400 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              {connected ? (
                <Wifi className="w-3 h-3 text-emerald-400" />
              ) : (
                <WifiOff className="w-3 h-3 text-rose-400" />
              )}
              <span className={connected ? 'text-emerald-400' : 'text-rose-400'}>
                {connected ? t('status.connected') : t('status.disconnected')}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <CircleDot className={`w-3 h-3 ${isAutoTrading ? 'text-emerald-400' : 'text-zinc-500'}`} />
              <span className={isAutoTrading ? 'text-emerald-400' : 'text-zinc-500'}>
                {t(isAutoTrading ? 'status.autoOn' : 'status.autoOff')}
              </span>
            </div>
            {tradingMode === 'mt5_live' && (
              <div className="flex items-center gap-1.5">
                <Cable className={`w-3 h-3 ${mt5ConnectionStatus === 'connected' ? 'text-amber-400' : 'text-amber-400/50'}`} />
                <span className={mt5ConnectionStatus === 'connected' ? 'text-amber-400' : 'text-amber-400/70'}>
                  {mt5ConnectionStatus === 'connected' ? t('status.mt5Live') : t('status.mt5Standby')}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <div className="flex items-center gap-1.5">
              <Globe className="w-3 h-3" />
              <span>WIB {jakartaTime}</span>
            </div>
            <span className="text-zinc-500">FINEX Indonesia v2.0</span>
          </div>
        </div>

        {/* Risk Disclosure Banner (REG-003) */}
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 text-[10px] text-amber-400/80 text-center">
          {t('risk.banner')}
        </div>

        {/* Simulation Mode Banner (FNH-005) */}
        {isSimulated && !isMt5Live && (
          <div className="bg-rose-500/10 border-b border-rose-500/20 px-3 py-1.5 text-[10px] text-rose-400/90 text-center flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            {t('risk.simulation')}
          </div>
        )}

        {/* MT5 Price Fallback Warning (P-03) */}
        {priceSourceWarning && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 text-[10px] text-amber-400/80 text-center">
            {t('risk.mt5Fallback')}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Desktop sidebar */}
          <aside className="hidden lg:flex w-56 flex-col bg-zinc-900 border-r border-zinc-800 shrink-0">
            <SidebarContent />
          </aside>

          {/* Mobile sidebar sheet */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-64 bg-zinc-900 border-zinc-800 p-0">
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
              </SheetHeader>
              <SidebarContent onNavigate={() => setSidebarOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Main content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Timeframe & Session bar */}
            <TimeframeSessionBar />

            {/* Mobile header */}
            <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                  onClick={() => setSidebarOpen(true)}>
                  <Menu className="w-5 h-5" />
                </Button>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-sm font-semibold text-white">FINEX Indonesia</span>
                </div>
              </div>
              <NotificationBell />
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-4 lg:p-6">
              <div className="max-w-7xl mx-auto">
                {renderPanel()}
              </div>
            </div>

            {/* Footer (REG-002, REG-008, REG-011) */}
            <footer className="border-t border-zinc-800 bg-zinc-900/50 px-4 py-2 shrink-0">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <div className="flex items-center gap-2">
                  <span className="font-medium">FINEX Indonesia</span>
                  <Separator orientation="vertical" className="h-3 bg-zinc-700" />
                  <span>{t('footer.regulated')}</span>
                  <Separator orientation="vertical" className="h-3 bg-zinc-700" />
                  <span>{t('footer.segregated')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span>{connected ? t('status.connected') : t('status.disconnected')}</span>
                  {tradingMode === 'mt5_live' && (
                    <>
                      <Separator orientation="vertical" className="h-3 bg-zinc-700" />
                      <div className={`w-1.5 h-1.5 rounded-full ${mt5ConnectionStatus === 'connected' ? 'bg-amber-400' : 'bg-amber-400/40'}`} />
                      <span>MT5 {mt5ConnectionStatus === 'connected' ? 'Live' : 'Standby'}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-[9px] text-zinc-600 mt-0.5">
                {t('footer.disclaimer')} · © {new Date().getFullYear()} FINEX Indonesia
              </div>
            </footer>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
