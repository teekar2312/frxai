'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Menu, TrendingUp, Wifi, WifiOff, Globe, CircleDot, Cable } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { FOREX_PAIRS, type QuoteData } from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';
import { SidebarContent } from '@/components/trading/Sidebar';
import { DashboardPanel } from '@/components/trading/DashboardPanel';
import { AiAnalysisPanel } from '@/components/trading/AiAnalysisPanel';
import { TradingSignalsPanel } from '@/components/trading/TradingSignalsPanel';
import { LiveTradingPanel } from '@/components/trading/LiveTradingPanel';
import { RiskManagementPanel } from '@/components/trading/RiskManagementPanel';
import { PriceAlertsPanel } from '@/components/trading/PriceAlertsPanel';
import { BacktestingPanel } from '@/components/trading/BacktestingPanel';
import { ActivityLogPanel } from '@/components/trading/ActivityLogPanel';
import { SettingsPanel } from '@/components/trading/SettingsPanel';

export default function TradingDashboard() {
  const { activeTab, setQuote, setNews, isAutoTrading, tradingMode, mt5ConnectionStatus } = useTradingStore();
  const [connected, setConnected] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [jakartaTime, setJakartaTime] = useState('');
  const isMt5Live = tradingMode === 'mt5_live' && mt5ConnectionStatus === 'connected';

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

  // Fetch prices every 5 seconds — uses MT5 prices when in MT5 live mode (#4)
  const fetchPrices = useCallback(async () => {
    try {
      if (isMt5Live) {
        // Use MT5 live prices from bridge
        const res = await fetch('/api/mt5/prices');
        if (res.ok) {
          const mt5Prices = await res.json() as Record<string, { bid: number; ask: number; timestamp: number }>;
          FOREX_PAIRS.forEach((pair) => {
            const p = mt5Prices[pair];
            if (p && p.bid > 0 && p.ask > 0) {
              const mid = (p.bid + p.ask) / 2;
              const spread = p.ask - p.bid;
              // Convert spread to pips based on pair
              const pipSize = pair === 'USDJPY' || pair === 'XAUUSD' ? 0.01 : 0.0001;
              const spreadPips = spread / pipSize;
              // Get previous quote for change calculation
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
        // If MT5 prices fail, fall back to Finnhub
      }
      const res = await fetch('/api/finnhub');
      if (!res.ok) throw new Error('Failed to fetch prices');
      const data = await res.json();
      if (data.quotes) {
        FOREX_PAIRS.forEach((pair) => {
          if (data.quotes[pair]) setQuote(pair, data.quotes[pair] as QuoteData);
        });
      }
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [setQuote, isMt5Live]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  // Fetch news every 60 seconds
  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news');
      if (res.ok) {
        const data = await res.json();
        if (data.news) setNews(data.news);
      }
    } catch {
      // silent
    }
  }, [setNews]);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 60000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  // Panel router
  const renderPanel = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardPanel />;
      case 'ai-analysis': return <AiAnalysisPanel />;
      case 'trading-signals': return <TradingSignalsPanel />;
      case 'live-trading': return <LiveTradingPanel />;
      case 'risk-management': return <RiskManagementPanel />;
      case 'price-alerts': return <PriceAlertsPanel />;
      case 'backtesting': return <BacktestingPanel />;
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
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <CircleDot className={`w-3 h-3 ${isAutoTrading ? 'text-emerald-400' : 'text-zinc-500'}`} />
              <span className={isAutoTrading ? 'text-emerald-400' : 'text-zinc-500'}>
                Auto: {isAutoTrading ? 'ON' : 'OFF'}
              </span>
            </div>
            {tradingMode === 'mt5_live' && (
              <div className="flex items-center gap-1.5">
                <Cable className={`w-3 h-3 ${mt5ConnectionStatus === 'connected' ? 'text-amber-400' : 'text-amber-400/50'}`} />
                <span className={mt5ConnectionStatus === 'connected' ? 'text-amber-400' : 'text-amber-400/70'}>
                  MT5 {mt5ConnectionStatus === 'connected' ? 'LIVE' : '...'}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Globe className="w-3 h-3" />
              <span>WIB {jakartaTime}</span>
            </div>
            <span className="text-zinc-500">FX Pro Trading v1.0</span>
          </div>
        </div>

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
            {/* Mobile header */}
            <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
              <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white hover:bg-zinc-800"
                onClick={() => setSidebarOpen(true)}>
                <Menu className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                  <TrendingUp className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold text-white">FX Pro Trading</span>
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-4 lg:p-6">
              <div className="max-w-7xl mx-auto">
                {renderPanel()}
              </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-zinc-800 bg-zinc-900/50 px-4 py-2 flex items-center justify-between text-[10px] text-zinc-500 shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">FINEX Indonesia</span>
                <Separator orientation="vertical" className="h-3 bg-zinc-700" />
                <span>© 2024 All Rights Reserved</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span>{connected ? 'Connected' : 'Disconnected'}</span>
                {tradingMode === 'mt5_live' && (
                  <>
                    <Separator orientation="vertical" className="h-3 bg-zinc-700" />
                    <div className={`w-1.5 h-1.5 rounded-full ${mt5ConnectionStatus === 'connected' ? 'bg-amber-400' : 'bg-amber-400/40'}`} />
                    <span>MT5 {mt5ConnectionStatus === 'connected' ? 'Live' : 'Standby'}</span>
                  </>
                )}
              </div>
            </footer>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
