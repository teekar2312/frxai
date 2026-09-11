"use client";

import { create } from "zustand";
import type {
  AccountState,
  AlertRow,
  ApiKeys,
  BacktestRow,
  IndicatorState,
  LogRow,
  Pair,
  Quote,
  RiskConfig,
  Session,
  Timeframe,
  TradeRow,
  TradingConfig,
} from "@/lib/types";

export type SectionKey =
  | "overview"
  | "ai"
  | "trading"
  | "indicators"
  | "risk"
  | "backtest"
  | "alerts"
  | "logs"
  | "settings";

interface AppState {
  // navigation
  section: SectionKey;
  setSection: (s: SectionKey) => void;

  // live data
  quotes: Record<Pair, Quote>;
  setQuote: (q: Quote) => void;
  account: AccountState;
  setAccount: (a: Partial<AccountState>) => void;

  // trades
  trades: TradeRow[];
  setTrades: (t: TradeRow[]) => void;
  upsertTrade: (t: TradeRow) => void;
  removeTrade: (id: string) => void;

  // logs
  logs: LogRow[];
  setLogs: (l: LogRow[]) => void;
  addLog: (l: LogRow) => void;

  // alerts
  alerts: AlertRow[];
  setAlerts: (a: AlertRow[]) => void;

  // backtests
  backtests: BacktestRow[];
  setBacktests: (b: BacktestRow[]) => void;

  // indicators
  indicators: IndicatorState[];
  setIndicators: (i: IndicatorState[]) => void;

  // config
  tradingCfg: TradingConfig;
  setTradingCfg: (c: Partial<TradingConfig>) => void;
  riskCfg: RiskConfig;
  setRiskCfg: (c: Partial<RiskConfig>) => void;
  apiKeys: ApiKeys;
  setApiKeys: (a: Partial<ApiKeys>) => void;

  // ui
  toasts: { id: string; title: string; description?: string; variant?: "default" | "destructive" }[];
  pushToast: (t: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
  dismissToast: (id: string) => void;
}

const defaultAccount: AccountState = {
  broker: "FINEX Indonesia",
  login: null,
  server: null,
  leverage: "1:500",
  currency: "USD",
  balance: 10000,
  equity: 10000,
  margin: 0,
  freeMargin: 10000,
  marginLevel: 0,
  mt5Connected: false,
  dailyLossUsed: 0,
  dailyLossLimit: 3,
};

const defaultTradingCfg: TradingConfig = {
  pairs: ["EURUSD", "GBPUSD"],
  timeframes: ["M5", "M15"],
  sessions: ["London", "LondonNewYork"],
  avoidWeekends: true,
  autoMode: false,
  trailingAuto: false,
  indicatorAuto: false,
  riskAuto: false,
};

const defaultRiskCfg: RiskConfig = {
  riskPerTrade: 1,
  stopLossPipsMin: 5,
  stopLossPipsMax: 15,
  rrRatio: 1.5,
  maxOpenPositions: 3,
  dailyLossLimit: 3,
  avoidHighImpactNews: true,
  dailyTarget: 2,
  autoMode: false,
};

const defaultApiKeys: ApiKeys = {
  groq: "",
  openai: "",
  together: "",
  tinyfish: "",
  finnhub: "",
  marketaux: "",
  activeProvider: "zai",
  customModel: "",
};

export const useStore = create<AppState>((set) => ({
  section: "overview",
  setSection: (section) => set({ section }),

  quotes: {} as Record<Pair, Quote>,
  setQuote: (q) =>
    set((s) => ({ quotes: { ...s.quotes, [q.symbol]: q } })),
  account: defaultAccount,
  setAccount: (a) => set((s) => ({ account: { ...s.account, ...a } })),

  trades: [],
  setTrades: (trades) => set({ trades }),
  upsertTrade: (t) =>
    set((s) => {
      const idx = s.trades.findIndex((x) => x.id === t.id);
      if (idx >= 0) {
        const copy = [...s.trades];
        copy[idx] = t;
        return { trades: copy };
      }
      return { trades: [t, ...s.trades] };
    }),
  removeTrade: (id) =>
    set((s) => ({ trades: s.trades.filter((t) => t.id !== id) })),

  logs: [],
  setLogs: (logs) => set({ logs }),
  addLog: (l) => set((s) => ({ logs: [l, ...s.logs].slice(0, 500) })),

  alerts: [],
  setAlerts: (alerts) => set({ alerts }),

  backtests: [],
  setBacktests: (backtests) => set({ backtests }),

  indicators: [],
  setIndicators: (indicators) => set({ indicators }),

  tradingCfg: defaultTradingCfg,
  setTradingCfg: (c) => set((s) => ({ tradingCfg: { ...s.tradingCfg, ...c } })),
  riskCfg: defaultRiskCfg,
  setRiskCfg: (c) => set((s) => ({ riskCfg: { ...s.riskCfg, ...c } })),
  apiKeys: defaultApiKeys,
  setApiKeys: (a) => set((s) => ({ apiKeys: { ...s.apiKeys, ...a } })),

  toasts: [],
  pushToast: (t) =>
    set((s) => ({
      toasts: [...s.toasts, { ...t, id: Math.random().toString(36).slice(2) }],
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
