export type ForexPair = 'EURUSD' | 'USDJPY' | 'GBPUSD' | 'XAUUSD';

export interface QuoteData {
  pair: ForexPair;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  timestamp: number;
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type MarketCondition = 'trending' | 'range_bound' | 'high_volatility' | 'low_volatility';

export type TradingDirection = 'BUY' | 'SELL';

export type StrategyName =
  | 'MA_RIBBON'
  | 'MOMENTUM_SCALPING'
  | 'PIVOT_POINT'
  | 'EMA_CROSSOVER'
  | 'RMI_TREND_SYNC'
  | 'LINEAR_REGRESSION'
  | 'EMA_RSI_FILTER';

export interface TradingSignal {
  id: string;
  pair: ForexPair;
  direction: TradingDirection;
  strategy: StrategyName;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  confidence: number;
  marketCondition: MarketCondition;
  indicators: string[];
  reasoning: string;
  timestamp: number;
}

export interface IndicatorValue {
  name: string;
  value: number;
  signal: 'bullish' | 'bearish' | 'neutral';
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  category: string;
  impact: 'high' | 'medium' | 'low';
  sentiment: 'positive' | 'negative' | 'neutral';
  pair?: ForexPair;
}

export interface AiAnalysisResult {
  pair: ForexPair;
  marketCondition: MarketCondition;
  confidence: number;
  recommendation: 'BUY' | 'SELL' | 'HOLD' | 'AVOID';
  reasoning: string;
  newsImpact: string;
  riskLevel: 'low' | 'medium' | 'high';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  lotSize?: number;
  bestStrategy: StrategyName;
  indicators: IndicatorValue[];
}

export interface RiskCalculation {
  accountBalance: number;
  riskPerTrade: number;
  riskAmount: number;
  stopLossPips: number;
  lotSize: number;
  pipValue: number;
  potentialLoss: number;
  potentialProfit: number;
  riskRewardRatio: number;
  dailyRiskLimit: number;
  remainingDailyRisk: number;
  maxPositions: number;
  currentPositions: number;
}

export interface TrailingStopConfig {
  pair: ForexPair;
  type: 'manual' | 'automatic';
  activationPips: number;
  trailingPips: number;
  stepPips: number;
}

export interface TradingSession {
  name: string;
  startHour: number;
  endHour: number;
  isActive: boolean;
  overlaps: string[];
}

export interface BacktestConfig {
  pair: ForexPair;
  strategy: StrategyName;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  riskPerTrade: number;
  stopLossPips: number;
  takeProfitPips: number;
  maxPositions: number;
}

export interface BacktestResult {
  id: string;
  name: string;
  pair: ForexPair;
  strategy: StrategyName;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  finalBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxConsecutiveWins: number | null;
  maxConsecutiveLosses: number | null;
}

export const FOREX_PAIRS: ForexPair[] = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];

export const PAIR_DISPLAY: Record<ForexPair, string> = {
  EURUSD: 'EUR/USD',
  USDJPY: 'USD/JPY',
  GBPUSD: 'GBP/USD',
  XAUUSD: 'XAU/USD',
};

export const PAIR_PIP_VALUES: Record<ForexPair, { standard: number; pipSize: number }> = {
  EURUSD: { standard: 10, pipSize: 0.0001 },
  USDJPY: { standard: 6.5, pipSize: 0.01 },
  GBPUSD: { standard: 10, pipSize: 0.0001 },
  XAUUSD: { standard: 1, pipSize: 0.01 },
};

export const STRATEGY_LABELS: Record<StrategyName, string> = {
  MA_RIBBON: 'Moving Average Ribbon',
  MOMENTUM_SCALPING: 'Momentum Scalping',
  PIVOT_POINT: 'Pivot Point',
  EMA_CROSSOVER: 'EMA Crossover',
  RMI_TREND_SYNC: 'RMI Trend Sync',
  LINEAR_REGRESSION: 'Linear Regression',
  EMA_RSI_FILTER: 'EMA/RSI Filter',
};

export const MARKET_CONDITION_LABELS: Record<MarketCondition, string> = {
  trending: 'Trending Market',
  range_bound: 'Range-Bound Market',
  high_volatility: 'High-Volatility Market',
  low_volatility: 'Low-Volatility Market',
};

export const TIMEFRAMES = ['M1', 'M2', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;

export const FINEX_CONFIG = {
  leverage: 500,
  spreadPip: 0.5,
  commissionPerLot: 1,
  minLot: 0.01,
  maxLotPerOrder: 50,
  maxOpenPositions: 200,
  marginCallLevel: 50,
  stopOutLevel: 20,
};

// ============================================================
// MT5 Integration Types
// ============================================================

export type Mt5ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type TradingMode = 'simulation' | 'mt5_live';

export interface Mt5AccountInfo {
  login: number;
  name: string;
  server: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  currency: string;
  profit: number;
  openPositions: number;
}

export interface Mt5Position {
  ticket: number;
  pair: string;
  direction: 'BUY' | 'SELL';
  lotSize: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number;
  pnlPips: number;
  commission: number;
  swap: number;
  comment: string;
  openTime: string;
}

export interface Mt5OrderResult {
  success: boolean;
  ticket?: number;
  error?: string;
  errorCode?: number;
}

// M2: Removed unused Mt5ConnectionConfig and MT5_DEFAULT_CONFIG (dead code)
// Bridge URL is now configured via src/lib/mt5-config.ts using environment variables
export const MT5_BRIDGE_PORT = 3004;

export const TRADING_SESSIONS: TradingSession[] = [
  {
    name: 'Sydney',
    startHour: 22,
    endHour: 7,
    isActive: false,
    overlaps: ['Tokyo'],
  },
  {
    name: 'Tokyo',
    startHour: 0,
    endHour: 9,
    isActive: false,
    overlaps: ['Sydney', 'London'],
  },
  {
    name: 'London',
    startHour: 8,
    endHour: 17,
    isActive: false,
    overlaps: ['Tokyo', 'New York'],
  },
  {
    name: 'New York',
    startHour: 13,
    endHour: 22,
    isActive: false,
    overlaps: ['London'],
  },
];

export const OVERLAP_SESSIONS = [
  { name: 'Tokyo - London', startHour: 8, endHour: 9 },
  { name: 'London - New York', startHour: 13, endHour: 17 },
];

export const INDICATOR_POOL = [
  'EMA', 'SMA', 'VWAP', 'Supertrend', 'Parabolic SAR', 'RSI', 'Stochastic Oscillator',
  'MACD', 'Bollinger Bands', 'ATR', 'OBV', 'MFI', 'Tick Volume',
  'Ichimoku Cloud', 'HMA', 'Keltner Channel', 'Donchian Channel',
  'Linear Regression Channel', 'CCI', 'Momentum', 'Williams %R',
  'TSI', 'ROC', 'Schaff Trend Cycle', 'Ultimate Oscillator',
  'Standard Deviation', 'Chaikin Volatility', 'Volatility Ratio',
  'Volume Profile', 'Accumulation Distribution',
] as const;
