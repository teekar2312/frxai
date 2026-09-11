// Shared domain types for the AI Forex Trading Dashboard

export type Pair = "EURUSD" | "USDJPY" | "GBPUSD" | "XAUUSD";

export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";

export type Session =
  | "Sydney"
  | "Tokyo"
  | "London"
  | "NewYork"
  | "LondonNewYork"
  | "NewYorkTokyo";

export type Side = "BUY" | "SELL";

export type SignalDirection = "BUY" | "SELL" | "NEUTRAL";

export interface Quote {
  symbol: Pair;
  bid: number;
  ask: number;
  spreadPips: number;
  changePct: number;
  last: number;
  high: number;
  low: number;
  ts: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AccountState {
  broker: string;
  login: string | null;
  server: string | null;
  leverage: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  mt5Connected: boolean;
  dailyLossUsed: number;
  dailyLossLimit: number;
}

export interface TradeRow {
  id: string;
  ticket: string;
  symbol: Pair;
  side: Side;
  lotSize: number;
  openPrice: number;
  closePrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStop: boolean;
  trailingPips: number | null;
  slPips: number | null;
  tpPips: number | null;
  pnl: number;
  pips: number;
  status: "OPEN" | "CLOSED";
  source: "MANUAL" | "AI";
  strategy: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface LogRow {
  id: string;
  level: "INFO" | "WARN" | "ERROR" | "TRADE" | "AI";
  source: string;
  message: string;
  meta?: string;
  createdAt: string;
}

export interface AlertRow {
  id: string;
  type: "PRICE" | "EMAIL" | "NEWS";
  symbol: string | null;
  condition: "ABOVE" | "BELOW" | null;
  price: number | null;
  message: string | null;
  email: string | null;
  active: boolean;
  triggered: boolean;
  createdAt: string;
}

export interface BacktestRow {
  id: string;
  symbol: Pair;
  timeframe: Timeframe;
  strategy: string;
  fromDate: string;
  toDate: string;
  initialCapital: number;
  finalCapital: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  netProfit: number;
  createdAt: string;
}

export interface AiAnalysisRow {
  id: string;
  symbol: Pair;
  factors: string;
  summary: string;
  signal: SignalDirection;
  confidence: number;
  provider: string;
  createdAt: string;
}

export interface FactorScore {
  factor: string;
  direction: SignalDirection;
  score: number; // -100..100
  detail: string;
}

export interface AiAnalysisResult {
  symbol: Pair;
  signal: SignalDirection;
  confidence: number;
  summary: string;
  factors: FactorScore[];
  suggestedEntry?: number;
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
}

export interface IndicatorDef {
  name: string;
  category:
    | "trend"
    | "momentum"
    | "volatility"
    | "volume"
    | "channel";
  defaultParams: Record<string, number>;
  scalpingHint: string;
}

export interface IndicatorState {
  name: string;
  enabled: boolean;
  autoMode: boolean;
  params: Record<string, number>;
  category: "trend" | "momentum" | "volatility" | "volume" | "channel";
}

export interface RiskConfig {
  riskPerTrade: number; // %
  riskPerTradeBaseline?: number; // H3: user's original setting, auto-adjust never exceeds this
  stopLossPipsMin: number;
  stopLossPipsMax: number;
  rrRatio: number;
  maxOpenPositions: number;
  dailyLossLimit: number; // %
  avoidHighImpactNews: boolean;
  dailyTarget: number; // %
  autoMode: boolean;
}

export interface TradingConfig {
  pairs: Pair[];
  timeframes: Timeframe[];
  sessions: Session[];
  avoidWeekends: boolean;
  autoMode: boolean;
  trailingAuto: boolean;
  indicatorAuto: boolean;
  riskAuto: boolean;
}

export interface ApiKeys {
  groq: string;
  openai: string;
  together: string;
  tinyfish: string;
  finnhub: string;
  marketaux: string;
  activeProvider: "groq" | "openai" | "together" | "tinyfish" | "zai";
}
