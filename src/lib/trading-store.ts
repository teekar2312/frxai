import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ForexPair, QuoteData, NewsArticle, AiAnalysisResult, TradingSignal, MarketCondition,
  Mt5ConnectionStatus, TradingMode, Mt5AccountInfo, Mt5Position,
} from './trading-types';

export type TimeframeId = 'M1' | 'M2' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1';
export type TradingSessionId = 'Sydney' | 'Tokyo' | 'London' | 'New York' | 'all';

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
  setAutoTrading: (enabled: boolean) => void;
  toggleAutoTrading: () => void;

  // Server-side trading config (synced from /api/config)
  serverConfig: {
    autoTrading: boolean;
    avoidNewsTrading: boolean;
    maxOpenPositions: number;
    dailyTargetMax: number;
    accountBalance: number;
    leverage: number;
    trailingStopPips: number;
    autoTrailingStop: boolean;
    // AUDIT-AI-19: Include AI provider/model for UI display
    aiProvider: string;
    aiModel: string;
  } | null;
  setServerConfig: (config: { autoTrading: boolean; avoidNewsTrading: boolean; maxOpenPositions: number; dailyTargetMax: number; accountBalance: number; leverage: number; trailingStopPips: number; autoTrailingStop: boolean; aiProvider: string; aiModel: string }) => void;

  // Account balance
  accountBalance: number;
  setAccountBalance: (balance: number) => void;

  // Activity logs
  logs: { id: string; level: string; category: string; message: string; timestamp: string }[];
  addLog: (log: { id: string; level: string; category: string; message: string; timestamp: string }) => void;
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

  // MT5 Integration
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
  mt5ConnectionStatus: Mt5ConnectionStatus;
  setMt5ConnectionStatus: (status: Mt5ConnectionStatus) => void;
  mt5AccountInfo: Mt5AccountInfo | null;
  setMt5AccountInfo: (info: Mt5AccountInfo | null) => void;
  mt5Positions: Mt5Position[];
  setMt5Positions: (positions: Mt5Position[]) => void;

  // Timeframe & Session selection
  selectedTimeframe: TimeframeId;
  setSelectedTimeframe: (tf: TimeframeId) => void;
  selectedSession: TradingSessionId;
  setSelectedSession: (session: TradingSessionId) => void;
}

export const useTradingStore = create<TradingStore>()(
  persist(
    (set) => ({
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
      setAutoTrading: (enabled) => set({ isAutoTrading: enabled }),
      toggleAutoTrading: () => set((state) => ({ isAutoTrading: !state.isAutoTrading })),

      // Server-side trading config (AUDIT-TRADE-01: synced from /api/config)
      serverConfig: null,
      setServerConfig: (config) => set({
        serverConfig: config,
        // AUDIT-TRADE-01: Sync isAutoTrading and accountBalance from server config
        isAutoTrading: config.autoTrading,
        accountBalance: config.accountBalance,
      }),

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

      // MT5 Integration — tradingMode is persisted (H3)
      tradingMode: 'simulation' as TradingMode,
      setTradingMode: (mode) => set({ tradingMode: mode }),
      mt5ConnectionStatus: 'disconnected' as Mt5ConnectionStatus,
      setMt5ConnectionStatus: (status) => set({ mt5ConnectionStatus: status }),
      mt5AccountInfo: null,
      setMt5AccountInfo: (info) => set({ mt5AccountInfo: info }),
      mt5Positions: [],
      setMt5Positions: (positions) => set({ mt5Positions: positions }),

      // Timeframe & Session
      selectedTimeframe: 'H1' as TimeframeId,
      setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),
      selectedSession: 'all' as TradingSessionId,
      setSelectedSession: (session) => set({ selectedSession: session }),
    }),
    {
      name: 'frxai-trading-store',
      // Persist tradingMode, timeframe, and session preferences
      partialize: (state) => ({
        tradingMode: state.tradingMode,
        selectedTimeframe: state.selectedTimeframe,
        selectedSession: state.selectedSession,
      }),
    }
  )
);
