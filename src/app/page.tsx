'use client';

// ============================================================
// FX Pro Trading - AI-Powered Forex Dashboard
// Complete single-page trading terminal application
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  LayoutDashboard, Brain, Zap, Activity, Shield, Bell,
  History, FileText, Settings, Menu, TrendingUp, TrendingDown,
  DollarSign, Clock, Wifi, WifiOff, ChevronRight, RefreshCw,
  Play, Square, Trash2, Plus, X, ArrowUpCircle, ArrowDownCircle,
  AlertTriangle, CheckCircle2, Info, BarChart3, LineChart,
  Target, Crosshair, Eye, EyeOff, Send, Globe, CircleDot,
} from 'lucide-react';
import {
  LineChart as RLineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, AreaChart, Area,
  BarChart, Bar, ReferenceLine,
} from 'recharts';

// shadcn/ui components
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Types & store
import {
  type ForexPair, type QuoteData, type NewsArticle, type AiAnalysisResult,
  type TradingSignal, type MarketCondition, type TradingDirection,
  type StrategyName, type BacktestResult, type RiskCalculation,
  FOREX_PAIRS, PAIR_DISPLAY, PAIR_PIP_VALUES, STRATEGY_LABELS,
  MARKET_CONDITION_LABELS, TIMEFRAMES, FINEX_CONFIG, TRADING_SESSIONS,
  OVERLAP_SESSIONS,
} from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';

// ============================================================
// Local type definitions for API responses
// ============================================================

interface ActivityLogEntry {
  id: string;
  level: string;
  category: string;
  message: string;
  pair: string | null;
  details: string | null;
  metadata: string | null;
  createdAt: string;
}

interface Position {
  id: string;
  pair: ForexPair;
  direction: TradingDirection;
  lotSize: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  currentPrice: number;
  pnl: number;
  pips: number;
  strategy: StrategyName | null;
  trailingStop: boolean;
  trailingPips: number;
  isOpen: boolean;
  openedAt: string;
  closedAt: string | null;
}

interface PriceAlert {
  id: string;
  pair: ForexPair;
  condition: 'above' | 'below' | 'crosses_above' | 'crosses_below';
  targetPrice: number;
  isActive: boolean;
  isTriggered: boolean;
  triggeredAt: string | null;
  emailNotify: boolean;
  createdAt: string;
}

interface TradingConfig {
  id: string;
  riskPerTrade: number;
  slMinPips: number;
  slMaxPips: number;
  riskRewardRatio: number;
  maxPositions: number;
  dailyRiskLimit: number;
  dailyTarget: number;
  leverage: number;
  spreadPip: number;
  commissionPerLot: number;
  marginCallLevel: number;
  stopOutLevel: number;
  autoTrading: boolean;
  autoTrailingStop: boolean;
  trailingStopPips: number;
  avoidNewsTrading: boolean;
}

interface EquityPoint {
  time: string;
  equity: number;
  balance: number;
}

// ============================================================
// Navigation items for sidebar
// ============================================================

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, emoji: '📊' },
  { id: 'ai-analysis', label: 'AI Analysis', icon: Brain, emoji: '🤖' },
  { id: 'trading-signals', label: 'Trading Signals', icon: Zap, emoji: '📈' },
  { id: 'live-trading', label: 'Live Trading', icon: Activity, emoji: '💹' },
  { id: 'risk-management', label: 'Risk Management', icon: Shield, emoji: '🛡️' },
  { id: 'price-alerts', label: 'Price Alerts', icon: Bell, emoji: '🔔' },
  { id: 'backtesting', label: 'Backtesting', icon: History, emoji: '⏪' },
  { id: 'activity-log', label: 'Activity Log', icon: FileText, emoji: '📋' },
  { id: 'settings', label: 'Settings', icon: Settings, emoji: '⚙️' },
] as const;

// Strategy descriptions for reference
const STRATEGY_DESCS: Record<StrategyName, string> = {
  MA_RIBBON: 'Uses multiple moving averages (5/10/20/50 EMA) to identify trend direction and momentum. Best in trending markets.',
  MOMENTUM_SCALPING: 'Combines RSI, Stochastic, and MACD for quick scalping entries. Best during high-volume sessions.',
  PIVOT_POINT: 'Uses daily pivot points with support/resistance levels. Works well in range-bound markets.',
  EMA_CROSSOVER: 'Fast EMA (9) / Slow EMA (21) crossover with RSI confirmation. Good for swing trading.',
  RMI_TREND_SYNC: 'Relative Momentum Index synced with Supertrend and EMA. Filters noise in volatile markets.',
  LINEAR_REGRESSION: 'Linear regression channel with Bollinger Bands for mean reversion. Best in ranging markets.',
  EMA_RSI_FILTER: 'EMA trend detection filtered by RSI overbought/oversold zones. Reduces false signals.',
};

// ============================================================
// Main Page Component
// ============================================================

export default function TradingDashboard() {
  // Store state
  const {
    activeTab, setActiveTab,
    selectedPair, setSelectedPair,
    quotes, setQuote,
    news, setNews,
    aiAnalysis, setAiAnalysis,
    signals, setSignals,
    marketConditions, setMarketCondition,
    isAutoTrading, toggleAutoTrading,
    accountBalance, setAccountBalance,
    openPositionsCount, setOpenPositionsCount,
    dailyPnl, setDailyPnl,
    todayRiskUsed, setTodayRiskUsed,
    isLoading, setLoading,
  } = useTradingStore();

  // Local state
  const [currentTime, setCurrentTime] = useState('');
  const [connected, setConnected] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [jakartaTime, setJakartaTime] = useState('');

  // --- Dashboard state ---
  const [positions, setPositions] = useState<Position[]>([]);
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);

  // --- AI Analysis state ---
  const [analysisHistory, setAnalysisHistory] = useState<AiAnalysisResult[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // --- Signals state ---
  const [signalFilter, setSignalFilter] = useState<{ pair: string; strategy: string; direction: string }>({ pair: 'all', strategy: 'all', direction: 'all' });
  const [signalsLoading, setSignalsLoading] = useState(false);

  // --- Live Trading state ---
  const [newTradeDialog, setNewTradeDialog] = useState(false);
  const [newTrade, setNewTrade] = useState({ pair: 'EURUSD' as ForexPair, direction: 'BUY' as TradingDirection, lotSize: 0.01, stopLoss: 0, takeProfit: 0, strategy: 'EMA_CROSSOVER' as StrategyName });
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(false);

  // --- Risk Management state ---
  const [riskCalc, setRiskCalc] = useState<RiskCalculation | null>(null);
  const [riskForm, setRiskForm] = useState({ balance: 10000, riskPct: 1, slPips: 10 });

  // --- Alerts state ---
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<PriceAlert[]>([]);
  const [newAlert, setNewAlert] = useState({ pair: 'EURUSD' as ForexPair, condition: 'above' as PriceAlert['condition'], targetPrice: 1.1000, emailNotify: false });
  const [createAlertDialog, setCreateAlertDialog] = useState(false);

  // --- Backtest state ---
  const [backtestConfig, setBacktestConfig] = useState({
    pair: 'EURUSD' as ForexPair,
    strategy: 'EMA_CROSSOVER' as StrategyName,
    timeframe: 'H1',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    initialBalance: 10000,
    riskPerTrade: 1,
    stopLossPips: 10,
    takeProfitPips: 15,
    maxPositions: 3,
  });
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestHistory, setBacktestHistory] = useState<BacktestResult[]>([]);
  const [backtestEquity, setBacktestEquity] = useState<{ time: string; equity: number }[]>([]);

  // --- Activity Log state ---
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [logFilter, setLogFilter] = useState<{ level: string; category: string }>({ level: 'all', category: 'all' });

  // --- Settings state ---
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // ============================================================
  // Jakarta timezone clock
  // ============================================================
  useEffect(() => {
    const update = () => {
      const now = new Date();
      // Jakarta is UTC+7
      const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      setJakartaTime(format(jakarta, 'HH:mm:ss'));
      setCurrentTime(format(now, 'HH:mm:ss'));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  // ============================================================
  // Fetch prices every 5 seconds
  // ============================================================
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/finnhub');
      if (!res.ok) throw new Error('Failed to fetch prices');
      const data = await res.json();
      if (data.quotes) {
        FOREX_PAIRS.forEach((pair) => {
          if (data.quotes[pair]) {
            setQuote(pair, data.quotes[pair] as QuoteData);
          }
        });
      }
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [setQuote]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  // ============================================================
  // Fetch news
  // ============================================================
  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news');
      if (res.ok) {
        const data = await res.json();
        if (data.articles) setNews(data.articles as NewsArticle[]);
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

  // ============================================================
  // Fetch positions
  // ============================================================
  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/positions?status=open');
      if (res.ok) {
        const data = await res.json();
        const pos = (data.positions || []) as Position[];
        setPositions(pos);
        setOpenPositionsCount(pos.length);
        // Calculate daily PnL
        const totalPnl = pos.reduce((sum, p) => sum + (p.pnl || 0), 0);
        setDailyPnl(totalPnl);
      }
    } catch {
      // silent
    }
  }, [setOpenPositionsCount, setDailyPnl]);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  // ============================================================
  // Fetch alerts
  // ============================================================
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const data = await res.json();
        const all = (data.alerts || []) as PriceAlert[];
        setAlerts(all.filter(a => !a.isTriggered));
        setTriggeredAlerts(all.filter(a => a.isTriggered));
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'price-alerts') {
      fetchAlerts();
      const interval = setInterval(fetchAlerts, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchAlerts]);

  // ============================================================
  // Fetch logs
  // ============================================================
  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(logPage), limit: '30' });
      if (logFilter.level !== 'all') params.set('level', logFilter.level);
      if (logFilter.category !== 'all') params.set('category', logFilter.category);
      const res = await fetch(`/api/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setLogTotalPages(data.pagination?.totalPages || 1);
      }
    } catch {
      // silent
    }
  }, [logPage, logFilter]);

  useEffect(() => {
    if (activeTab === 'activity-log') {
      fetchLogs();
      const interval = setInterval(fetchLogs, 15000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchLogs]);

  // ============================================================
  // Fetch config on mount and when settings tab is active
  // ============================================================
  const fetchConfig = useCallback(async () => {
    try {
      setConfigLoading(true);
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (data.config) setConfig(data.config as TradingConfig);
      }
    } catch {
      // silent
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'settings' && !config) {
      fetchConfig();
    }
  }, [activeTab, config, fetchConfig]);

  // ============================================================
  // Fetch backtest history
  // ============================================================
  const fetchBacktestHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/backtest?history=true');
      if (res.ok) {
        const data = await res.json();
        setBacktestHistory(data.results || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'backtesting') {
      fetchBacktestHistory();
    }
  }, [activeTab, fetchBacktestHistory]);

  // ============================================================
  // Fetch analysis history
  // ============================================================
  const fetchAnalysisHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/analysis?history=true');
      if (res.ok) {
        const data = await res.json();
        setAnalysisHistory(data.analyses || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'ai-analysis') {
      fetchAnalysisHistory();
    }
  }, [activeTab, fetchAnalysisHistory]);

  // ============================================================
  // Trading session status
  // ============================================================
  const sessionStatus = useMemo(() => {
    const jakartaHour = parseInt(jakartaTime.split(':')[0] || '0', 10);
    const jakartaMin = parseInt(jakartaTime.split(':')[1] || '0', 10);
    const currentHour = jakartaHour + jakartaMin / 60;

    return TRADING_SESSIONS.map((s) => {
      let isActive = false;
      if (s.startHour <= s.endHour) {
        isActive = currentHour >= s.startHour && currentHour < s.endHour;
      } else {
        isActive = currentHour >= s.startHour || currentHour < s.endHour;
      }
      return { ...s, isActive };
    });
  }, [jakartaTime]);

  const overlapStatus = useMemo(() => {
    const jakartaHour = parseInt(jakartaTime.split(':')[0] || '0', 10);
    const jakartaMin = parseInt(jakartaTime.split(':')[1] || '0', 10);
    const currentHour = jakartaHour + jakartaMin / 60;
    return OVERLAP_SESSIONS.map((o) => ({
      ...o,
      isActive: currentHour >= o.startHour && currentHour < o.endHour,
    }));
  }, [jakartaTime]);

  // ============================================================
  // Action handlers
  // ============================================================

  // Run AI Analysis
  const handleRunAnalysis = async () => {
    setAnalysisLoading(true);
    try {
      const quote = quotes[selectedPair];
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: selectedPair, currentPrice: quote?.mid || 0, quote }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.analysis) {
          setAiAnalysis(selectedPair, data.analysis as AiAnalysisResult);
          toast.success(`AI Analysis complete for ${PAIR_DISPLAY[selectedPair]}`);
        }
      } else {
        toast.error('Failed to run AI analysis');
      }
    } catch {
      toast.error('Network error running analysis');
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Generate signals for all pairs
  const handleGenerateSignals = async () => {
    setSignalsLoading(true);
    try {
      const allSignals: TradingSignal[] = [];
      for (const pair of FOREX_PAIRS) {
        const res = await fetch('/api/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pair, currentPrice: quotes[pair]?.mid || 0, quote: quotes[pair], generateSignals: true }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.analysis) {
            setAiAnalysis(pair, data.analysis as AiAnalysisResult);
          }
          if (data.signals) {
            allSignals.push(...(data.signals as TradingSignal[]));
          }
        }
      }
      setSignals(allSignals);
      toast.success(`Generated ${allSignals.length} signals across all pairs`);
    } catch {
      toast.error('Failed to generate signals');
    } finally {
      setSignalsLoading(false);
    }
  };

  // Open new trade
  const handleOpenTrade = async () => {
    try {
      const res = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: newTrade.pair,
          direction: newTrade.direction,
          lotSize: newTrade.lotSize,
          stopLoss: newTrade.stopLoss || null,
          takeProfit: newTrade.takeProfit || null,
          strategy: newTrade.strategy,
          trailingStop: trailingStopEnabled,
        }),
      });
      if (res.ok) {
        toast.success(`${newTrade.direction} ${PAIR_DISPLAY[newTrade.pair]} @ ${newTrade.lotSize} lots`);
        setNewTradeDialog(false);
        fetchPositions();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to open trade');
      }
    } catch {
      toast.error('Network error opening trade');
    }
  };

  // Close position
  const handleClosePosition = async (id: string) => {
    try {
      const res = await fetch('/api/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'close' }),
      });
      if (res.ok) {
        toast.success('Position closed');
        fetchPositions();
      }
    } catch {
      toast.error('Failed to close position');
    }
  };

  // Modify SL/TP
  const handleModifyPosition = async (id: string, sl: number | null, tp: number | null) => {
    try {
      const res = await fetch('/api/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'modify', stopLoss: sl, takeProfit: tp }),
      });
      if (res.ok) {
        toast.success('Position modified');
        fetchPositions();
      }
    } catch {
      toast.error('Failed to modify position');
    }
  };

  // Calculate risk
  const handleCalculateRisk = async () => {
    try {
      const res = await fetch('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(riskForm),
      });
      if (res.ok) {
        const data = await res.json();
        setRiskCalc(data as RiskCalculation);
      }
    } catch {
      toast.error('Risk calculation failed');
    }
  };

  // Create alert
  const handleCreateAlert = async () => {
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAlert),
      });
      if (res.ok) {
        toast.success('Alert created');
        setCreateAlertDialog(false);
        fetchAlerts();
      }
    } catch {
      toast.error('Failed to create alert');
    }
  };

  // Delete alert
  const handleDeleteAlert = async (id: string) => {
    try {
      await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
      toast.success('Alert deleted');
      fetchAlerts();
    } catch {
      toast.error('Failed to delete alert');
    }
  };

  // Toggle alert
  const handleToggleAlert = async (id: string, isActive: boolean) => {
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive }),
      });
      fetchAlerts();
    } catch {
      toast.error('Failed to toggle alert');
    }
  };

  // Run backtest
  const handleRunBacktest = async () => {
    setBacktestLoading(true);
    setBacktestResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backtestConfig),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.result) {
          setBacktestResult(data.result as BacktestResult);
          setBacktestEquity(data.equityCurve || []);
          toast.success(`Backtest complete: ${data.result.totalTrades} trades, ${data.result.winRate}% win rate`);
          fetchBacktestHistory();
        }
      } else {
        const data = await res.json();
        toast.error(data.error || 'Backtest failed');
      }
    } catch {
      toast.error('Network error running backtest');
    } finally {
      setBacktestLoading(false);
    }
  };

  // Delete backtest
  const handleDeleteBacktest = async (id: string) => {
    try {
      await fetch(`/api/backtest?id=${id}`, { method: 'DELETE' });
      toast.success('Backtest deleted');
      fetchBacktestHistory();
    } catch {
      toast.error('Failed to delete backtest');
    }
  };

  // Clear logs
  const handleClearLogs = async () => {
    try {
      await fetch('/api/logs?all=true', { method: 'DELETE' });
      toast.success('Logs cleared');
      fetchLogs();
    } catch {
      toast.error('Failed to clear logs');
    }
  };

  // Save config
  const handleSaveConfig = async () => {
    if (!config) return;
    setConfigSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        toast.success('Configuration saved');
      } else {
        toast.error('Failed to save configuration');
      }
    } catch {
      toast.error('Network error saving config');
    } finally {
      setConfigSaving(false);
    }
  };

  // Reset config
  const handleResetConfig = async () => {
    setConfigLoading(true);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      toast.success('Configuration reset to defaults');
      fetchConfig();
    } catch {
      toast.error('Failed to reset configuration');
    } finally {
      setConfigLoading(false);
    }
  };

  // ============================================================
  // Format helpers
  // ============================================================
  const fmtPrice = (pair: ForexPair, price: number) => {
    const decimals = pair === 'XAUUSD' || pair === 'USDJPY' ? 3 : 5;
    return price.toFixed(decimals);
  };

  const fmtChange = (change: number) => {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  };

  // ============================================================
  // Sidebar content component (shared between desktop & mobile)
// ============================================================
  const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-zinc-700/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-white">FX Pro Trading</h1>
            <p className="text-[10px] text-zinc-400">AI-Powered Dashboard</p>
          </div>
        </div>
      </div>

      {/* Account summary in sidebar */}
      <div className="p-3 border-b border-zinc-700/50">
        <div className="bg-zinc-800/80 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Balance</span>
            <span className="text-white font-mono font-medium">${accountBalance.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Daily P&L</span>
            <span className={`font-mono font-medium ${dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {dailyPnl >= 0 ? '+' : ''}{dailyPnl.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Open Positions</span>
            <span className="text-white font-mono font-medium">{openPositionsCount}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-2">
        <nav className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  onNavigate?.();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {isActive && <ChevronRight className="w-3 h-3 ml-auto shrink-0" />}
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer in sidebar */}
      <div className="p-3 border-t border-zinc-700/50">
        <div className="text-[10px] text-zinc-500 text-center">
          © 2024 FINEX Indonesia
        </div>
      </div>
    </div>
  );

  // ============================================================
  // Status bar (top)
  // ============================================================
  const StatusBar = () => (
    <div className="h-8 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-3 text-[11px] text-zinc-400 shrink-0">
      <div className="flex items-center gap-4">
        {/* Connection status */}
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
        {/* Auto trading status */}
        <div className="flex items-center gap-1.5">
          <CircleDot className={`w-3 h-3 ${isAutoTrading ? 'text-emerald-400' : 'text-zinc-500'}`} />
          <span className={isAutoTrading ? 'text-emerald-400' : 'text-zinc-500'}>
            Auto: {isAutoTrading ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          <span>WIB {jakartaTime}</span>
        </div>
        <span className="text-zinc-500">FX Pro Trading v1.0</span>
      </div>
    </div>
  );

  // ============================================================
  // PANEL 1: DASHBOARD
  // ============================================================
  const DashboardPanel = () => {
    const currentAnalysis = aiAnalysis[selectedPair];
    return (
      <div className="space-y-4">
        {/* Price cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {FOREX_PAIRS.map((pair) => {
            const q = quotes[pair];
            const isUp = q && q.change >= 0;
            const mc = marketConditions[pair];
            if (!q) {
              return (
                <Card key={pair} className="bg-zinc-900 border-zinc-800 p-4 gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-3 w-24" />
                </Card>
              );
            }
            return (
              <Card
                key={pair}
                className={`bg-zinc-900 border-zinc-800 p-4 cursor-pointer transition-all hover:border-zinc-600 ${selectedPair === pair ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : ''}`}
                onClick={() => setSelectedPair(pair)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-white">{PAIR_DISPLAY[pair]}</span>
                  <Badge variant={isUp ? 'default' : 'destructive'} className={`text-[10px] ${isUp ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'}`}>
                    {isUp ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                    {fmtChange(q.change)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-zinc-500">Bid</span>
                    <p className={`font-mono font-medium ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {fmtPrice(pair, q.bid)}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Ask</span>
                    <p className={`font-mono font-medium ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {fmtPrice(pair, q.ask)}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Spread</span>
                    <p className="font-mono text-zinc-300">{q.spread.toFixed(1)} pip</p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Market</span>
                    <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                      {mc === 'trending' ? '📈 Trending' : mc === 'range_bound' ? '↔️ Range' : mc === 'high_volatility' ? '⚡ Hi-Vol' : '😴 Low-Vol'}
                    </Badge>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Sessions & Quick AI Analysis row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Trading sessions */}
          <Card className="bg-zinc-900 border-zinc-800 p-4 lg:col-span-2">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Clock className="w-4 h-4" /> Trading Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {sessionStatus.map((s) => (
                  <div key={s.name} className={`rounded-lg p-2.5 text-center border ${s.isActive ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-800/50 border-zinc-700/50'}`}>
                    <div className={`text-xs font-medium ${s.isActive ? 'text-emerald-400' : 'text-zinc-500'}`}>{s.name}</div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">{String(s.startHour).padStart(2, '0')}:00-{String(s.endHour).padStart(2, '0')}:00 WIB</div>
                    <div className={`mt-1 inline-block w-2 h-2 rounded-full ${s.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                  </div>
                ))}
              </div>
              {/* Overlap sessions */}
              <div className="flex gap-2 flex-wrap">
                {overlapStatus.map((o) => (
                  <Badge key={o.name} variant={o.isActive ? 'default' : 'outline'} className={`text-[10px] ${o.isActive ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'border-zinc-700 text-zinc-500'}`}>
                    {o.isActive && '🔥 '}{o.name} {o.isActive ? 'ACTIVE' : ''}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick AI Analysis */}
          <Card className="bg-zinc-900 border-zinc-800 p-4">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Brain className="w-4 h-4" /> Quick AI Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {currentAnalysis ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${currentAnalysis.recommendation === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : currentAnalysis.recommendation === 'SELL' ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-700 text-zinc-300'}`}>
                      {currentAnalysis.recommendation}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                      {STRATEGY_LABELS[currentAnalysis.bestStrategy]}
                    </Badge>
                  </div>
                  <div className="text-xs text-zinc-400">
                    <div className="flex justify-between mb-1">
                      <span>Confidence</span>
                      <span className="text-white font-mono">{currentAnalysis.confidence.toFixed(0)}%</span>
                    </div>
                    <Progress value={currentAnalysis.confidence} className="h-1.5 bg-zinc-800 [&>div]:bg-emerald-500" />
                  </div>
                  <p className="text-[11px] text-zinc-500 line-clamp-3">{currentAnalysis.reasoning}</p>
                </div>
              ) : (
                <div className="text-center py-4">
                  <Brain className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500">No analysis yet. Go to AI Analysis tab to run.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* News & Positions row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* News feed */}
          <Card className="bg-zinc-900 border-zinc-800 p-4">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Recent News
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-72">
                <div className="space-y-2">
                  {news.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center py-4">No news available</p>
                  ) : (
                    news.slice(0, 10).map((article) => (
                      <div key={article.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-zinc-800/50 transition-colors">
                        <Badge variant="outline" className={`text-[9px] shrink-0 mt-0.5 border-zinc-700 ${article.impact === 'high' ? 'text-rose-400' : article.impact === 'medium' ? 'text-amber-400' : 'text-zinc-500'}`}>
                          {article.impact}
                        </Badge>
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-200 line-clamp-2 font-medium">{article.title}</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">{article.source} · {format(new Date(article.publishedAt), 'HH:mm')}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Open positions summary */}
          <Card className="bg-zinc-900 border-zinc-800 p-4">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Activity className="w-4 h-4" /> Open Positions
                <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-300 ml-auto">{positions.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-72">
                {positions.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-4">No open positions</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                        <TableHead className="text-[10px] text-zinc-500">Dir</TableHead>
                        <TableHead className="text-[10px] text-zinc-500">Lots</TableHead>
                        <TableHead className="text-[10px] text-zinc-500 text-right">P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positions.slice(0, 5).map((pos) => (
                        <TableRow key={pos.id} className="border-zinc-800/50">
                          <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[pos.pair]}</TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] ${pos.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                              {pos.direction}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-zinc-300 font-mono">{pos.lotSize}</TableCell>
                          <TableCell className={`text-xs font-mono text-right ${(pos.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {(pos.pnl || 0) >= 0 ? '+' : ''}{(pos.pnl || 0).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Daily performance summary */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Daily Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Total P&L</p>
                <p className={`text-lg font-mono font-bold ${dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {dailyPnl >= 0 ? '+' : ''}{dailyPnl.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Balance</p>
                <p className="text-lg font-mono font-bold text-white">${accountBalance.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Open Trades</p>
                <p className="text-lg font-mono font-bold text-white">{openPositionsCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">Daily Risk Used</p>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-mono font-bold text-amber-400">{todayRiskUsed.toFixed(1)}%</p>
                  <Progress value={Math.min(todayRiskUsed / 3 * 100, 100)} className="flex-1 h-1.5 bg-zinc-800 [&>div]:bg-amber-500" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ============================================================
  // PANEL 2: AI ANALYSIS
  // ============================================================
  const AiAnalysisPanel = () => {
    const currentAnalysis = aiAnalysis[selectedPair];
    return (
      <div className="space-y-4">
        {/* Pair selector & run button */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Select value={selectedPair} onValueChange={(v) => setSelectedPair(v as ForexPair)}>
            <SelectTrigger className="w-full sm:w-48 bg-zinc-800 border-zinc-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              {FOREX_PAIRS.map((p) => (
                <SelectItem key={p} value={p} className="text-zinc-200 focus:bg-zinc-700 focus:text-white">{PAIR_DISPLAY[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleRunAnalysis}
            disabled={analysisLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {analysisLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            Run AI Analysis
          </Button>
        </div>

        {/* Analysis result */}
        {currentAnalysis ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Main analysis card */}
            <Card className="bg-zinc-900 border-zinc-800 p-4 lg:col-span-2">
              <CardHeader className="p-0 pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-white">Analysis: {PAIR_DISPLAY[currentAnalysis.pair]}</CardTitle>
                  <Badge className={`text-xs ${
                    currentAnalysis.recommendation === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' :
                    currentAnalysis.recommendation === 'SELL' ? 'bg-rose-500/20 text-rose-400' :
                    currentAnalysis.recommendation === 'HOLD' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-zinc-700 text-zinc-400'
                  }`}>
                    {currentAnalysis.recommendation === 'BUY' && <ArrowUpCircle className="w-3 h-3 mr-1" />}
                    {currentAnalysis.recommendation === 'SELL' && <ArrowDownCircle className="w-3 h-3 mr-1" />}
                    {currentAnalysis.recommendation}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0 space-y-4">
                {/* Confidence gauge */}
                <div className="flex items-center gap-4">
                  <div className="relative w-24 h-24">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="#27272a" strokeWidth="8" />
                      <circle
                        cx="50" cy="50" r="40" fill="none"
                        stroke={currentAnalysis.confidence > 70 ? '#10b981' : currentAnalysis.confidence > 40 ? '#f59e0b' : '#ef4444'}
                        strokeWidth="8"
                        strokeDasharray={`${currentAnalysis.confidence * 2.51} 251`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-bold text-white font-mono">{currentAnalysis.confidence.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="space-y-2 flex-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Market Condition</span>
                      <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-[10px]">{MARKET_CONDITION_LABELS[currentAnalysis.marketCondition]}</Badge>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Risk Level</span>
                      <Badge className={`text-[10px] ${currentAnalysis.riskLevel === 'low' ? 'bg-emerald-500/20 text-emerald-400' : currentAnalysis.riskLevel === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'}`}>
                        {currentAnalysis.riskLevel}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">Best Strategy</span>
                      <span className="text-zinc-200">{STRATEGY_LABELS[currentAnalysis.bestStrategy]}</span>
                    </div>
                  </div>
                </div>

                <Separator className="bg-zinc-800" />

                {/* Suggested levels */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {currentAnalysis.entryPrice && (
                    <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-zinc-500">Entry</p>
                      <p className="text-sm font-mono text-white font-medium">{fmtPrice(currentAnalysis.pair, currentAnalysis.entryPrice)}</p>
                    </div>
                  )}
                  {currentAnalysis.stopLoss && (
                    <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-zinc-500">Stop Loss</p>
                      <p className="text-sm font-mono text-rose-400 font-medium">{fmtPrice(currentAnalysis.pair, currentAnalysis.stopLoss)}</p>
                    </div>
                  )}
                  {currentAnalysis.takeProfit && (
                    <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-zinc-500">Take Profit</p>
                      <p className="text-sm font-mono text-emerald-400 font-medium">{fmtPrice(currentAnalysis.pair, currentAnalysis.takeProfit)}</p>
                    </div>
                  )}
                  {currentAnalysis.lotSize && (
                    <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-zinc-500">Lot Size</p>
                      <p className="text-sm font-mono text-white font-medium">{currentAnalysis.lotSize}</p>
                    </div>
                  )}
                </div>

                {/* Reasoning */}
                <div>
                  <p className="text-xs text-zinc-400 mb-1 font-medium">AI Reasoning</p>
                  <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/30 rounded-lg p-3">{currentAnalysis.reasoning}</p>
                </div>

                {/* News impact */}
                {currentAnalysis.newsImpact && (
                  <div>
                    <p className="text-xs text-zinc-400 mb-1 font-medium">News Impact</p>
                    <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/30 rounded-lg p-3">{currentAnalysis.newsImpact}</p>
                  </div>
                )}

                {/* Indicators */}
                {currentAnalysis.indicators && currentAnalysis.indicators.length > 0 && (
                  <div>
                    <p className="text-xs text-zinc-400 mb-2 font-medium">Recommended Indicators</p>
                    <div className="flex flex-wrap gap-1.5">
                      {currentAnalysis.indicators.map((ind) => (
                        <Badge key={ind.name} variant="outline" className={`text-[10px] border-zinc-700 ${ind.signal === 'bullish' ? 'text-emerald-400' : ind.signal === 'bearish' ? 'text-rose-400' : 'text-zinc-400'}`}>
                          {ind.name}: {ind.signal} ({ind.value.toFixed(2)})
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Analysis history */}
            <Card className="bg-zinc-900 border-zinc-800 p-4">
              <CardHeader className="p-0 pb-3">
                <CardTitle className="text-sm text-white">Analysis History</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-96">
                  {analysisHistory.length === 0 ? (
                    <p className="text-xs text-zinc-500 text-center py-4">No analysis history</p>
                  ) : (
                    <div className="space-y-2">
                      {analysisHistory.slice(0, 20).map((a, i) => (
                        <div key={i} className="bg-zinc-800/50 rounded-lg p-2.5 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-zinc-200">{PAIR_DISPLAY[a.pair]}</span>
                            <Badge className={`text-[10px] ${a.recommendation === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : a.recommendation === 'SELL' ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-700 text-zinc-400'}`}>
                              {a.recommendation}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-zinc-500">
                            <span>{STRATEGY_LABELS[a.bestStrategy]}</span>
                            <span>{a.confidence.toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="bg-zinc-900 border-zinc-800 p-8">
            <div className="text-center">
              <Brain className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-sm text-zinc-400 mb-1">No Analysis Available</h3>
              <p className="text-xs text-zinc-500">Select a pair and run AI analysis to get trading recommendations.</p>
            </div>
          </Card>
        )}
      </div>
    );
  };

  // ============================================================
  // PANEL 3: TRADING SIGNALS
  // ============================================================
  const TradingSignalsPanel = () => {
    const filteredSignals = useMemo(() => {
      return signals.filter((s) => {
        if (signalFilter.pair !== 'all' && s.pair !== signalFilter.pair) return false;
        if (signalFilter.strategy !== 'all' && s.strategy !== signalFilter.strategy) return false;
        if (signalFilter.direction !== 'all' && s.direction !== signalFilter.direction) return false;
        return true;
      });
    }, [signals, signalFilter]);

    return (
      <div className="space-y-4">
        {/* Header with generate button and filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Button
            onClick={handleGenerateSignals}
            disabled={signalsLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {signalsLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Generate Signals
          </Button>
          <div className="flex gap-2 flex-wrap">
            <Select value={signalFilter.pair} onValueChange={(v) => setSignalFilter(f => ({ ...f, pair: v }))}>
              <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
                <SelectValue placeholder="All Pairs" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="all" className="text-zinc-200">All Pairs</SelectItem>
                {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={signalFilter.direction} onValueChange={(v) => setSignalFilter(f => ({ ...f, direction: v }))}>
              <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="all" className="text-zinc-200">All</SelectItem>
                <SelectItem value="BUY" className="text-emerald-400">BUY</SelectItem>
                <SelectItem value="SELL" className="text-rose-400">SELL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Signal cards */}
        {filteredSignals.length === 0 ? (
          <Card className="bg-zinc-900 border-zinc-800 p-8">
            <div className="text-center">
              <Zap className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-sm text-zinc-400 mb-1">No Active Signals</h3>
              <p className="text-xs text-zinc-500">Click &quot;Generate Signals&quot; to analyze all pairs and generate trading signals.</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredSignals.map((signal, i) => (
              <Card key={i} className="bg-zinc-900 border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{PAIR_DISPLAY[signal.pair]}</span>
                    <Badge className={`text-[10px] ${signal.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {signal.direction === 'BUY' ? <ArrowUpCircle className="w-3 h-3 mr-0.5" /> : <ArrowDownCircle className="w-3 h-3 mr-0.5" />}
                      {signal.direction}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                    {signal.confidence.toFixed(0)}%
                  </Badge>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Strategy</span>
                    <span className="text-zinc-300">{STRATEGY_LABELS[signal.strategy]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Entry</span>
                    <span className="text-white font-mono">{fmtPrice(signal.pair, signal.entryPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">SL</span>
                    <span className="text-rose-400 font-mono">{fmtPrice(signal.pair, signal.stopLoss)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">TP</span>
                    <span className="text-emerald-400 font-mono">{fmtPrice(signal.pair, signal.takeProfit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Lot Size</span>
                    <span className="text-zinc-300 font-mono">{signal.lotSize}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Strategy reference */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white">Strategy Reference</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(Object.entries(STRATEGY_DESCS) as [StrategyName, string][]).map(([key, desc]) => (
                <div key={key} className="bg-zinc-800/50 rounded-lg p-3">
                  <p className="text-xs font-medium text-zinc-200 mb-1">{STRATEGY_LABELS[key]}</p>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ============================================================
  // PANEL 4: LIVE TRADING
  // ============================================================
  const LiveTradingPanel = () => {
    const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const marginUsed = positions.reduce((sum, p) => sum + (p.lotSize * 200), 0); // rough margin estimate
    const equity = accountBalance + totalPnl;
    const freeMargin = equity - marginUsed;

    return (
      <div className="space-y-4">
        {/* Account summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Balance', value: `$${accountBalance.toLocaleString()}`, color: 'text-white' },
            { label: 'Equity', value: `$${equity.toFixed(2)}`, color: 'text-white' },
            { label: 'Margin Used', value: `$${marginUsed.toFixed(2)}`, color: 'text-amber-400' },
            { label: 'Free Margin', value: `$${freeMargin.toFixed(2)}`, color: 'text-emerald-400' },
            { label: 'Daily P&L', value: `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400' },
            { label: 'Open Trades', value: String(positions.length), color: 'text-white' },
          ].map((item) => (
            <Card key={item.label} className="bg-zinc-900 border-zinc-800 p-3">
              <p className="text-[10px] text-zinc-500 mb-1">{item.label}</p>
              <p className={`text-sm font-mono font-bold ${item.color}`}>{item.value}</p>
            </Card>
          ))}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-center">
          <Dialog open={newTradeDialog} onOpenChange={setNewTradeDialog}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="w-4 h-4" /> New Trade
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-white">New Trade</DialogTitle>
                <DialogDescription className="text-zinc-400">Open a new trading position</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-zinc-300">Pair</Label>
                    <Select value={newTrade.pair} onValueChange={(v) => setNewTrade(t => ({ ...t, pair: v as ForexPair }))}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-zinc-300">Direction</Label>
                    <Select value={newTrade.direction} onValueChange={(v) => setNewTrade(t => ({ ...t, direction: v as TradingDirection }))}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="BUY" className="text-emerald-400">BUY</SelectItem>
                        <SelectItem value="SELL" className="text-rose-400">SELL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-zinc-300">Lot Size</Label>
                    <Input type="number" step="0.01" min="0.01" value={newTrade.lotSize}
                      onChange={(e) => setNewTrade(t => ({ ...t, lotSize: parseFloat(e.target.value) || 0.01 }))}
                      className="bg-zinc-800 border-zinc-700 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-zinc-300">Strategy</Label>
                    <Select value={newTrade.strategy} onValueChange={(v) => setNewTrade(t => ({ ...t, strategy: v as StrategyName }))}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        {(Object.entries(STRATEGY_LABELS) as [StrategyName, string][]).map(([k, v]) => (
                          <SelectItem key={k} value={k} className="text-zinc-200">{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-zinc-300">Stop Loss (price)</Label>
                    <Input type="number" step="0.00001" value={newTrade.stopLoss || ''}
                      onChange={(e) => setNewTrade(t => ({ ...t, stopLoss: parseFloat(e.target.value) || 0 }))}
                      placeholder="Optional" className="bg-zinc-800 border-zinc-700 text-white" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-zinc-300">Take Profit (price)</Label>
                    <Input type="number" step="0.00001" value={newTrade.takeProfit || ''}
                      onChange={(e) => setNewTrade(t => ({ ...t, takeProfit: parseFloat(e.target.value) || 0 }))}
                      placeholder="Optional" className="bg-zinc-800 border-zinc-700 text-white" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={trailingStopEnabled} onCheckedChange={setTrailingStopEnabled} />
                  <Label className="text-zinc-300 text-sm">Enable Trailing Stop</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewTradeDialog(false)} className="border-zinc-700 text-zinc-300">Cancel</Button>
                <Button onClick={handleOpenTrade} className={newTrade.direction === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}>
                  Open {newTrade.direction}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="flex items-center gap-2">
            <Label className="text-zinc-400 text-xs">Auto Trading</Label>
            <Switch checked={isAutoTrading} onCheckedChange={toggleAutoTrading} />
          </div>
        </div>

        {/* Open positions table */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white">Open Positions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {positions.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">No open positions</p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Direction</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Lots</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Entry</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">SL</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">TP</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Trailing</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">P&L</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((pos) => (
                      <TableRow key={pos.id} className="border-zinc-800/50">
                        <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[pos.pair]}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${pos.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {pos.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-300 font-mono">{pos.lotSize}</TableCell>
                        <TableCell className="text-xs text-zinc-300 font-mono">{fmtPrice(pos.pair, pos.entryPrice)}</TableCell>
                        <TableCell className="text-xs text-rose-400 font-mono">{pos.stopLoss ? fmtPrice(pos.pair, pos.stopLoss) : '-'}</TableCell>
                        <TableCell className="text-xs text-emerald-400 font-mono">{pos.takeProfit ? fmtPrice(pos.pair, pos.takeProfit) : '-'}</TableCell>
                        <TableCell>
                          {pos.trailingStop ? <Badge className="text-[10px] bg-amber-500/20 text-amber-400">ON</Badge> : <span className="text-xs text-zinc-500">-</span>}
                        </TableCell>
                        <TableCell className={`text-xs font-mono text-right ${(pos.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(pos.pnl || 0) >= 0 ? '+' : ''}{(pos.pnl || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                            onClick={() => handleClosePosition(pos.id)}>
                            <Square className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Equity chart placeholder */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white">Equity Chart</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-48 bg-zinc-800/30 rounded-lg flex items-center justify-center">
              {equityHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                    <RTooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', fontSize: 11 }} />
                    <Area type="monotone" dataKey="equity" stroke="#10b981" fill="#10b98120" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center">
                  <LineChart className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <p className="text-xs text-zinc-500">Equity data will appear here as trades are executed</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ============================================================
  // PANEL 5: RISK MANAGEMENT
  // ============================================================
  const RiskManagementPanel = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risk calculator */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> Risk Calculator
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">Balance ($)</Label>
                <Input type="number" value={riskForm.balance}
                  onChange={(e) => setRiskForm(f => ({ ...f, balance: parseFloat(e.target.value) || 0 }))}
                  className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">Risk %</Label>
                <Input type="number" step="0.1" value={riskForm.riskPct}
                  onChange={(e) => setRiskForm(f => ({ ...f, riskPct: parseFloat(e.target.value) || 0 }))}
                  className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">SL (pips)</Label>
                <Input type="number" value={riskForm.slPips}
                  onChange={(e) => setRiskForm(f => ({ ...f, slPips: parseInt(e.target.value) || 0 }))}
                  className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
            </div>
            <Button onClick={handleCalculateRisk} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
              <Crosshair className="w-4 h-4" /> Calculate
            </Button>

            {riskCalc && (
              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
                <h4 className="text-xs font-medium text-white mb-2">Results</h4>
                {[
                  { label: 'Recommended Lot Size', value: String(riskCalc.lotSize), color: 'text-emerald-400' },
                  { label: 'Pip Value', value: `$${riskCalc.pipValue.toFixed(2)}`, color: 'text-white' },
                  { label: 'Risk Amount', value: `$${riskCalc.riskAmount.toFixed(2)}`, color: 'text-amber-400' },
                  { label: 'Potential Loss', value: `$${riskCalc.potentialLoss.toFixed(2)}`, color: 'text-rose-400' },
                  { label: 'Potential Profit', value: `$${riskCalc.potentialProfit.toFixed(2)}`, color: 'text-emerald-400' },
                  { label: 'R:R Ratio', value: `1:${riskCalc.riskRewardRatio.toFixed(1)}`, color: 'text-white' },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between text-xs">
                    <span className="text-zinc-400">{item.label}</span>
                    <span className={`font-mono font-medium ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* FINEX Indonesia specs */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white">FINEX Indonesia Specifications</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
              {[
                { label: 'Leverage', value: `1:${FINEX_CONFIG.leverage}` },
                { label: 'Spread', value: `${FINEX_CONFIG.spreadPip} pip` },
                { label: 'Commission', value: `$${FINEX_CONFIG.commissionPerLot}/lot` },
                { label: 'Min Lot', value: String(FINEX_CONFIG.minLot) },
                { label: 'Max Lot/Order', value: String(FINEX_CONFIG.maxLotPerOrder) },
                { label: 'Max Open Positions', value: String(FINEX_CONFIG.maxOpenPositions) },
                { label: 'Margin Call Level', value: `${FINEX_CONFIG.marginCallLevel}%` },
                { label: 'Stop Out Level', value: `${FINEX_CONFIG.stopOutLevel}%` },
              ].map((item) => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-zinc-400">{item.label}</span>
                  <span className="text-zinc-200 font-mono">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Money management rules */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Shield className="w-4 h-4" /> Money Management Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Risk/Trade', value: '0.5-1%' },
              { label: 'SL Range', value: '5-15 pips' },
              { label: 'R:R Ratio', value: '1:1.5' },
              { label: 'Max Positions', value: '3' },
              { label: 'Daily Risk Limit', value: '2-3%' },
              { label: 'Daily Target', value: '1.5-2%' },
            ].map((rule) => (
              <div key={rule.label} className="bg-zinc-800/50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-zinc-500 mb-1">{rule.label}</p>
                <p className="text-sm font-mono font-bold text-emerald-400">{rule.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Daily risk usage */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Daily Risk Usage</CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-400">Risk Used Today</span>
            <span className={`font-mono font-medium ${todayRiskUsed > 2 ? 'text-rose-400' : todayRiskUsed > 1 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {todayRiskUsed.toFixed(2)}% / 3.00%
            </span>
          </div>
          <Progress value={Math.min(todayRiskUsed / 3 * 100, 100)} className="h-3 bg-zinc-800" />
          <Alert className={`${todayRiskUsed > 2 ? 'border-rose-500/30 bg-rose-500/5' : 'border-zinc-700 bg-zinc-800/30'}`}>
            {todayRiskUsed > 2 ? <AlertTriangle className="w-4 h-4 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <AlertTitle className={`text-xs ${todayRiskUsed > 2 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {todayRiskUsed > 2 ? 'Daily Risk Limit Approaching' : 'Risk Level Healthy'}
            </AlertTitle>
            <AlertDescription className="text-xs text-zinc-400">
              {todayRiskUsed > 2
                ? 'You are approaching your daily risk limit. Consider closing some positions or waiting.'
                : 'Your current risk usage is within safe limits.'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Risk per pair breakdown */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Risk per Pair</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                <TableHead className="text-[10px] text-zinc-500">Positions</TableHead>
                <TableHead className="text-[10px] text-zinc-500 text-right">Total Lots</TableHead>
                <TableHead className="text-[10px] text-zinc-500 text-right">Total P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FOREX_PAIRS.map((pair) => {
                const pairPos = positions.filter(p => p.pair === pair);
                const pairPnl = pairPos.reduce((s, p) => s + (p.pnl || 0), 0);
                const pairLots = pairPos.reduce((s, p) => s + p.lotSize, 0);
                return (
                  <TableRow key={pair} className="border-zinc-800/50">
                    <TableCell className="text-xs text-zinc-200 font-mono font-medium">{PAIR_DISPLAY[pair]}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{pairPos.length}</TableCell>
                    <TableCell className="text-xs text-zinc-300 font-mono text-right">{pairLots.toFixed(2)}</TableCell>
                    <TableCell className={`text-xs font-mono text-right ${pairPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {pairPnl >= 0 ? '+' : ''}{pairPnl.toFixed(2)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  // ============================================================
  // PANEL 6: PRICE ALERTS
  // ============================================================
  const PriceAlertsPanel = () => (
    <div className="space-y-4">
      {/* Create alert button */}
      <Dialog open={createAlertDialog} onOpenChange={setCreateAlertDialog}>
        <DialogTrigger asChild>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="w-4 h-4" /> Create Alert
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Create Price Alert</DialogTitle>
            <DialogDescription className="text-zinc-400">Set a price alert for a currency pair</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300">Pair</Label>
                <Select value={newAlert.pair} onValueChange={(v) => setNewAlert(a => ({ ...a, pair: v as ForexPair }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">Condition</Label>
                <Select value={newAlert.condition} onValueChange={(v) => setNewAlert(a => ({ ...a, condition: v as PriceAlert['condition'] }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="above" className="text-emerald-400">Above</SelectItem>
                    <SelectItem value="below" className="text-rose-400">Below</SelectItem>
                    <SelectItem value="crosses_above" className="text-emerald-400">Crosses Above</SelectItem>
                    <SelectItem value="crosses_below" className="text-rose-400">Crosses Below</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Target Price</Label>
              <Input type="number" step="0.00001" value={newAlert.targetPrice}
                onChange={(e) => setNewAlert(a => ({ ...a, targetPrice: parseFloat(e.target.value) || 0 }))}
                className="bg-zinc-800 border-zinc-700 text-white" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={newAlert.emailNotify} onCheckedChange={(v) => setNewAlert(a => ({ ...a, emailNotify: v }))} />
              <Label className="text-zinc-300 text-sm">Email notification</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAlertDialog(false)} className="border-zinc-700 text-zinc-300">Cancel</Button>
            <Button onClick={handleCreateAlert} className="bg-emerald-600 hover:bg-emerald-700 text-white">Create Alert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Active alerts */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Bell className="w-4 h-4" /> Active Alerts
            <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-300 ml-auto">{alerts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-8">No active alerts. Create one above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Condition</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Target</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Email</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Status</TableHead>
                  <TableHead className="text-[10px] text-zinc-500 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.id} className="border-zinc-800/50">
                    <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[alert.pair]}</TableCell>
                    <TableCell className="text-xs text-zinc-300">{alert.condition.replace('_', ' ')}</TableCell>
                    <TableCell className="text-xs text-white font-mono">{fmtPrice(alert.pair, alert.targetPrice)}</TableCell>
                    <TableCell className="text-xs">{alert.emailNotify ? '✉️' : '-'}</TableCell>
                    <TableCell>
                      <Switch checked={alert.isActive} onCheckedChange={(v) => handleToggleAlert(alert.id, v)} className="scale-75" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                        onClick={() => handleDeleteAlert(alert.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Triggered alerts history */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Triggered Alerts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {triggeredAlerts.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">No triggered alerts yet</p>
          ) : (
            <ScrollArea className="max-h-48">
              <div className="space-y-1.5">
                {triggeredAlerts.slice(0, 20).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-xs text-zinc-300 font-mono">{PAIR_DISPLAY[alert.pair]}</span>
                      <span className="text-xs text-zinc-400">{alert.condition.replace('_', ' ')}</span>
                      <span className="text-xs text-white font-mono">{fmtPrice(alert.pair, alert.targetPrice)}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500">{alert.triggeredAt ? format(new Date(alert.triggeredAt), 'MM/dd HH:mm') : '-'}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // ============================================================
  // PANEL 7: BACKTESTING
  // ============================================================
  const BacktestingPanel = () => (
    <div className="space-y-4">
      {/* Configuration form */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Backtest Configuration</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Pair</Label>
              <Select value={backtestConfig.pair} onValueChange={(v) => setBacktestConfig(c => ({ ...c, pair: v as ForexPair }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Strategy</Label>
              <Select value={backtestConfig.strategy} onValueChange={(v) => setBacktestConfig(c => ({ ...c, strategy: v as StrategyName }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {(Object.entries(STRATEGY_LABELS) as [StrategyName, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-zinc-200">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Timeframe</Label>
              <Select value={backtestConfig.timeframe} onValueChange={(v) => setBacktestConfig(c => ({ ...c, timeframe: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {TIMEFRAMES.map(tf => <SelectItem key={tf} value={tf} className="text-zinc-200">{tf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Initial Balance</Label>
              <Input type="number" value={backtestConfig.initialBalance}
                onChange={(e) => setBacktestConfig(c => ({ ...c, initialBalance: parseFloat(e.target.value) || 10000 }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Start Date</Label>
              <Input type="date" value={backtestConfig.startDate}
                onChange={(e) => setBacktestConfig(c => ({ ...c, startDate: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">End Date</Label>
              <Input type="date" value={backtestConfig.endDate}
                onChange={(e) => setBacktestConfig(c => ({ ...c, endDate: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">SL (pips)</Label>
              <Input type="number" value={backtestConfig.stopLossPips}
                onChange={(e) => setBacktestConfig(c => ({ ...c, stopLossPips: parseInt(e.target.value) || 10 }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">TP (pips)</Label>
              <Input type="number" value={backtestConfig.takeProfitPips}
                onChange={(e) => setBacktestConfig(c => ({ ...c, takeProfitPips: parseInt(e.target.value) || 15 }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
          </div>
          <Button onClick={handleRunBacktest} disabled={backtestLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {backtestLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Backtest
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {backtestResult && (
        <>
          <Card className="bg-zinc-900 border-zinc-800 p-4">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Backtest Results — {PAIR_DISPLAY[backtestResult.pair]} / {STRATEGY_LABELS[backtestResult.strategy]}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
                {[
                  { label: 'Total Trades', value: String(backtestResult.totalTrades), color: 'text-white' },
                  { label: 'Win Rate', value: `${backtestResult.winRate.toFixed(1)}%`, color: backtestResult.winRate > 50 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Total P&L', value: `$${backtestResult.totalPnl.toFixed(2)}`, color: backtestResult.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Max Drawdown', value: `${backtestResult.maxDrawdown.toFixed(2)}%`, color: 'text-rose-400' },
                  { label: 'Sharpe Ratio', value: backtestResult.sharpeRatio?.toFixed(2) || 'N/A', color: 'text-white' },
                  { label: 'Profit Factor', value: backtestResult.profitFactor?.toFixed(2) || 'N/A', color: (backtestResult.profitFactor || 0) > 1 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Avg Win', value: backtestResult.avgWin ? `$${backtestResult.avgWin.toFixed(2)}` : 'N/A', color: 'text-emerald-400' },
                  { label: 'Avg Loss', value: backtestResult.avgLoss ? `$${backtestResult.avgLoss.toFixed(2)}` : 'N/A', color: 'text-rose-400' },
                ].map((item) => (
                  <div key={item.label} className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500 mb-0.5">{item.label}</p>
                    <p className={`text-xs font-mono font-bold ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              {backtestResult.maxConsecutiveWins != null && backtestResult.maxConsecutiveLosses != null && (
                <div className="flex gap-4 text-xs text-zinc-400">
                  <span>Max Consecutive Wins: <span className="text-emerald-400 font-mono font-medium">{backtestResult.maxConsecutiveWins}</span></span>
                  <span>Max Consecutive Losses: <span className="text-rose-400 font-mono font-medium">{backtestResult.maxConsecutiveLosses}</span></span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Equity curve */}
          {backtestEquity.length > 0 && (
            <Card className="bg-zinc-900 border-zinc-800 p-4">
              <CardHeader className="p-0 pb-3">
                <CardTitle className="text-sm text-white">Equity Curve</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={backtestEquity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#71717a' }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: '#71717a' }} domain={['auto', 'auto']} />
                      <RTooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', fontSize: 11 }} />
                      <ReferenceLine y={backtestConfig.initialBalance} stroke="#71717a" strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="equity" stroke="#10b981" fill="#10b98120" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Backtest history */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Past Backtest Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {backtestHistory.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">No past backtest results</p>
          ) : (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Strategy</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Trades</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Win Rate</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">P&L</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Drawdown</TableHead>
                    <TableHead className="text-[10px] text-zinc-500 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backtestHistory.map((bt) => (
                    <TableRow key={bt.id} className="border-zinc-800/50">
                      <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[bt.pair]}</TableCell>
                      <TableCell className="text-xs text-zinc-300">{STRATEGY_LABELS[bt.strategy]}</TableCell>
                      <TableCell className="text-xs text-zinc-400 font-mono">{bt.totalTrades}</TableCell>
                      <TableCell className={`text-xs font-mono ${bt.winRate > 50 ? 'text-emerald-400' : 'text-rose-400'}`}>{bt.winRate.toFixed(1)}%</TableCell>
                      <TableCell className={`text-xs font-mono ${bt.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${bt.totalPnl.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-rose-400 font-mono">{bt.maxDrawdown.toFixed(2)}%</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => handleDeleteBacktest(bt.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // ============================================================
  // PANEL 8: ACTIVITY LOG
  // ============================================================
  const ActivityLogPanel = () => {
    const levelColors: Record<string, string> = {
      error: 'text-rose-400 bg-rose-500/10',
      warn: 'text-amber-400 bg-amber-500/10',
      info: 'text-blue-400 bg-blue-500/10',
      debug: 'text-zinc-400 bg-zinc-700/30',
    };

    return (
      <div className="space-y-4">
        {/* Filters and controls */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={logFilter.level} onValueChange={(v) => { setLogFilter(f => ({ ...f, level: v })); setLogPage(1); }}>
            <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
              <SelectValue placeholder="All Levels" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="all" className="text-zinc-200">All Levels</SelectItem>
              <SelectItem value="error" className="text-rose-400">Error</SelectItem>
              <SelectItem value="warn" className="text-amber-400">Warning</SelectItem>
              <SelectItem value="info" className="text-blue-400">Info</SelectItem>
              <SelectItem value="debug" className="text-zinc-400">Debug</SelectItem>
            </SelectContent>
          </Select>
          <Select value={logFilter.category} onValueChange={(v) => { setLogFilter(f => ({ ...f, category: v })); setLogPage(1); }}>
            <SelectTrigger className="w-36 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="all" className="text-zinc-200">All Categories</SelectItem>
              <SelectItem value="trading" className="text-zinc-200">Trading</SelectItem>
              <SelectItem value="analysis" className="text-zinc-200">Analysis</SelectItem>
              <SelectItem value="alert" className="text-zinc-200">Alert</SelectItem>
              <SelectItem value="system" className="text-zinc-200">System</SelectItem>
              <SelectItem value="api" className="text-zinc-200">API</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchLogs} className="border-zinc-700 text-zinc-300 h-8">
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearLogs} className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 h-8">
            <Trash2 className="w-3 h-3" /> Clear Logs
          </Button>
        </div>

        {/* Log table */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-[10px] text-zinc-500 w-20">Level</TableHead>
                    <TableHead className="text-[10px] text-zinc-500 w-24">Category</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Message</TableHead>
                    <TableHead className="text-[10px] text-zinc-500 w-40">Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-xs text-zinc-500 text-center py-8">No logs found</TableCell></TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow key={log.id} className="border-zinc-800/50">
                        <TableCell>
                          <Badge className={`text-[10px] ${levelColors[log.level] || levelColors.debug}`}>{log.level}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-400">{log.category}</TableCell>
                        <TableCell className="text-xs text-zinc-300 max-w-md truncate">{log.message}</TableCell>
                        <TableCell className="text-[10px] text-zinc-500 font-mono">
                          {format(new Date(log.createdAt), 'MM/dd HH:mm:ss')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800">
              <span className="text-[10px] text-zinc-500">Page {logPage} of {logTotalPages}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)}
                  className="h-7 px-2 text-xs border-zinc-700 text-zinc-300">Prev</Button>
                <Button variant="outline" size="sm" disabled={logPage >= logTotalPages} onClick={() => setLogPage(p => p + 1)}
                  className="h-7 px-2 text-xs border-zinc-700 text-zinc-300">Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ============================================================
  // PANEL 9: SETTINGS
  // ============================================================
  const SettingsPanel = () => {
    if (configLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-8 w-48 bg-zinc-800" />
          <Skeleton className="h-64 w-full bg-zinc-800" />
        </div>
      );
    }

    if (!config) {
      return (
        <Card className="bg-zinc-900 border-zinc-800 p-8">
          <div className="text-center">
            <Settings className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">Unable to load configuration</p>
          </div>
        </Card>
      );
    }

    const updateConfig = (key: keyof TradingConfig, value: number | boolean | string) => {
      setConfig(prev => prev ? { ...prev, [key]: value } : prev);
    };

    return (
      <div className="space-y-4">
        {/* Trading config form */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-white">Trading Configuration</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleResetConfig} className="border-zinc-700 text-zinc-300 h-8 text-xs">
                  Reset Defaults
                </Button>
                <Button size="sm" onClick={handleSaveConfig} disabled={configSaving}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs">
                  {configSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                  Save Changes
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Risk settings */}
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Risk Management</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Risk per Trade (%)</Label>
                    <Input type="number" step="0.1" value={config.riskPerTrade}
                      onChange={(e) => updateConfig('riskPerTrade', parseFloat(e.target.value) || 1)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">SL Min (pips)</Label>
                    <Input type="number" value={config.slMinPips}
                      onChange={(e) => updateConfig('slMinPips', parseInt(e.target.value) || 5)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">SL Max (pips)</Label>
                    <Input type="number" value={config.slMaxPips}
                      onChange={(e) => updateConfig('slMaxPips', parseInt(e.target.value) || 15)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">R:R Ratio</Label>
                    <Input type="number" step="0.1" value={config.riskRewardRatio}
                      onChange={(e) => updateConfig('riskRewardRatio', parseFloat(e.target.value) || 1.5)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Max Positions</Label>
                    <Input type="number" value={config.maxPositions}
                      onChange={(e) => updateConfig('maxPositions', parseInt(e.target.value) || 3)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Daily Risk Limit (%)</Label>
                    <Input type="number" step="0.1" value={config.dailyRiskLimit}
                      onChange={(e) => updateConfig('dailyRiskLimit', parseFloat(e.target.value) || 3)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Daily Target (%)</Label>
                    <Input type="number" step="0.1" value={config.dailyTarget}
                      onChange={(e) => updateConfig('dailyTarget', parseFloat(e.target.value) || 2)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                </div>
              </div>

              {/* Broker settings */}
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Broker Settings</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Leverage</Label>
                    <Input type="number" value={config.leverage}
                      onChange={(e) => updateConfig('leverage', parseInt(e.target.value) || 500)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Spread (pip)</Label>
                    <Input type="number" step="0.1" value={config.spreadPip}
                      onChange={(e) => updateConfig('spreadPip', parseFloat(e.target.value) || 0.5)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Commission ($/lot)</Label>
                    <Input type="number" step="0.1" value={config.commissionPerLot}
                      onChange={(e) => updateConfig('commissionPerLot', parseFloat(e.target.value) || 1)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Margin Call (%)</Label>
                    <Input type="number" value={config.marginCallLevel}
                      onChange={(e) => updateConfig('marginCallLevel', parseInt(e.target.value) || 50)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Stop Out (%)</Label>
                    <Input type="number" value={config.stopOutLevel}
                      onChange={(e) => updateConfig('stopOutLevel', parseInt(e.target.value) || 20)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                </div>
              </div>

              {/* Auto trading settings */}
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Automation</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Auto Trading</Label>
                    <Switch checked={config.autoTrading} onCheckedChange={(v) => updateConfig('autoTrading', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Auto Trailing Stop</Label>
                    <Switch checked={config.autoTrailingStop} onCheckedChange={(v) => updateConfig('autoTrailingStop', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Trailing Stop (pips)</Label>
                    <Input type="number" value={config.trailingStopPips}
                      onChange={(e) => updateConfig('trailingStopPips', parseInt(e.target.value) || 10)}
                      className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-zinc-300 text-xs">Avoid News Trading</Label>
                    <Switch checked={config.avoidNewsTrading} onCheckedChange={(v) => updateConfig('avoidNewsTrading', v)} />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ============================================================
  // Panel router
  // ============================================================
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

  // ============================================================
  // Main layout render
  // ============================================================
  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
        {/* Status bar */}
        <StatusBar />

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
            {/* Mobile header with hamburger */}
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
              </div>
            </footer>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
