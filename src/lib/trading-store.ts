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
  setActiveTab: (_tab: string) => void;

  // Selected pair
  selectedPair: ForexPair;
  setSelectedPair: (_pair: ForexPair) => void;

  // Live quotes
  quotes: Record<ForexPair, QuoteData | null>;
  setQuote: (_pair: ForexPair, _quote: QuoteData) => void;

  // News
  news: NewsArticle[];
  setNews: (_news: NewsArticle[]) => void;

  // AI Analysis
  aiAnalysis: Record<ForexPair, AiAnalysisResult | null>;
  setAiAnalysis: (_pair: ForexPair, _analysis: AiAnalysisResult) => void;

  // Trading signals
  signals: TradingSignal[];
  setSignals: (_signals: TradingSignal[]) => void;

  // Market condition
  marketConditions: Record<ForexPair, MarketCondition>;
  setMarketCondition: (_pair: ForexPair, _condition: MarketCondition) => void;

  // Auto trading
  isAutoTrading: boolean;
  setAutoTrading: (_enabled: boolean) => void;
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
  setServerConfig: (_config: { autoTrading: boolean; avoidNewsTrading: boolean; maxOpenPositions: number; dailyTargetMax: number; accountBalance: number; leverage: number; trailingStopPips: number; autoTrailingStop: boolean; aiProvider: string; aiModel: string }) => void;

  // Account balance
  accountBalance: number;
  setAccountBalance: (_balance: number) => void;

  // Activity logs
  logs: { id: string; level: string; category: string; message: string; timestamp: string }[];
  addLog: (_log: { id: string; level: string; category: string; message: string; timestamp: string }) => void;
  clearLogs: () => void;

  // Loading states
  isLoading: Record<string, boolean>;
  setLoading: (_key: string, _loading: boolean) => void;

  // Open positions count
  openPositionsCount: number;
  setOpenPositionsCount: (_count: number) => void;

  // Daily PnL
  dailyPnl: number;
  setDailyPnl: (_pnl: number) => void;

  // Today's risk used
  todayRiskUsed: number;
  setTodayRiskUsed: (_risk: number) => void;

  // MT5 Integration
  tradingMode: TradingMode;
  setTradingMode: (_mode: TradingMode) => void;
  mt5ConnectionStatus: Mt5ConnectionStatus;
  setMt5ConnectionStatus: (_status: Mt5ConnectionStatus) => void;
  mt5AccountInfo: Mt5AccountInfo | null;
  setMt5AccountInfo: (_info: Mt5AccountInfo | null) => void;
  mt5Positions: Mt5Position[];
  setMt5Positions: (_positions: Mt5Position[]) => void;

  // Timeframe & Session selection
  selectedTimeframe: TimeframeId;
  setSelectedTimeframe: (_tf: TimeframeId) => void;
  selectedSession: TradingSessionId;
  setSelectedSession: (_session: TradingSessionId) => void;

  // Display currency
  displayCurrency: 'USD' | 'IDR';
  setDisplayCurrency: (_currency: 'USD' | 'IDR') => void;

  // User role (NOT persisted — comes from server auth)
  userRole: 'admin' | 'user';
  setUserRole: (_role: 'admin' | 'user') => void;
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

      // Display currency (persisted)
      displayCurrency: 'USD' as const,
      setDisplayCurrency: (currency) => set({ displayCurrency: currency }),

      // User role (NOT persisted — comes from server auth)
      userRole: 'user' as const,
      setUserRole: (role) => set({ userRole: role }),
    }),
    {
      name: 'frxai-trading-store',
      // Persist tradingMode, timeframe, session, and currency preferences
      partialize: (state) => ({
        tradingMode: state.tradingMode,
        selectedTimeframe: state.selectedTimeframe,
        selectedSession: state.selectedSession,
        displayCurrency: state.displayCurrency,
      }),
    }
  )
);
