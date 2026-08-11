import { create } from 'zustand';
import type { ForexPair, QuoteData, NewsArticle, AiAnalysisResult, TradingSignal, MarketCondition, ActivityLogEntry } from './trading-types';

interface TradingStore {
  // Active tab
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // Selected pair
  selectedPair: ForexPair;
  setSelectedPair: (pair: ForexPair) => void;

  // Live quotes
  quotes: Record<ForexPair, QuoteData | null>;
  setQuote: (pair: ForexPair, quote: QuoteData) => void;

  // News
  news: NewsArticle[];
  setNews: (news: NewsArticle[]) => void;

  // AI Analysis
  aiAnalysis: Record<ForexPair, AiAnalysisResult | null>;
  setAiAnalysis: (pair: ForexPair, analysis: AiAnalysisResult) => void;

  // Trading signals
  signals: TradingSignal[];
  setSignals: (signals: TradingSignal[]) => void;

  // Market condition
  marketConditions: Record<ForexPair, MarketCondition>;
  setMarketCondition: (pair: ForexPair, condition: MarketCondition) => void;

  // Auto trading
  isAutoTrading: boolean;
  toggleAutoTrading: () => void;

  // Account balance
  accountBalance: number;
  setAccountBalance: (balance: number) => void;

  // Activity logs
  logs: ActivityLogEntry[];
  addLog: (log: ActivityLogEntry) => void;
  clearLogs: () => void;

  // Loading states
  isLoading: Record<string, boolean>;
  setLoading: (key: string, loading: boolean) => void;

  // Open positions count
  openPositionsCount: number;
  setOpenPositionsCount: (count: number) => void;

  // Daily PnL
  dailyPnl: number;
  setDailyPnl: (pnl: number) => void;

  // Today's risk used
  todayRiskUsed: number;
  setTodayRiskUsed: (risk: number) => void;
}

export const useTradingStore = create<TradingStore>((set) => ({
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  selectedPair: 'EURUSD',
  setSelectedPair: (pair) => set({ selectedPair: pair }),

  quotes: {
    EURUSD: null,
    USDJPY: null,
    GBPUSD: null,
    XAUUSD: null,
  },
  setQuote: (pair, quote) =>
    set((state) => ({
      quotes: { ...state.quotes, [pair]: quote },
    })),

  news: [],
  setNews: (news) => set({ news }),

  aiAnalysis: {
    EURUSD: null,
    USDJPY: null,
    GBPUSD: null,
    XAUUSD: null,
  },
  setAiAnalysis: (pair, analysis) =>
    set((state) => ({
      aiAnalysis: { ...state.aiAnalysis, [pair]: analysis },
    })),

  signals: [],
  setSignals: (signals) => set({ signals }),

  marketConditions: {
    EURUSD: 'range_bound',
    USDJPY: 'range_bound',
    GBPUSD: 'range_bound',
    XAUUSD: 'range_bound',
  },
  setMarketCondition: (pair, condition) =>
    set((state) => ({
      marketConditions: { ...state.marketConditions, [pair]: condition },
    })),

  isAutoTrading: false,
  toggleAutoTrading: () => set((state) => ({ isAutoTrading: !state.isAutoTrading })),

  accountBalance: 10000,
  setAccountBalance: (balance) => set({ accountBalance: balance }),

  logs: [],
  addLog: (log) => set((state) => ({ logs: [log, ...state.logs].slice(0, 500) })),
  clearLogs: () => set({ logs: [] }),

  isLoading: {},
  setLoading: (key, loading) =>
    set((state) => ({
      isLoading: { ...state.isLoading, [key]: loading },
    })),

  openPositionsCount: 0,
  setOpenPositionsCount: (count) => set({ openPositionsCount: count }),

  dailyPnl: 0,
  setDailyPnl: (pnl) => set({ dailyPnl: pnl }),

  todayRiskUsed: 0,
  setTodayRiskUsed: (risk) => set({ todayRiskUsed: risk }),
}));
