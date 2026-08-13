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

// ============================================================
// FNH-002: Single source of truth for Finnhub OANDA symbol mapping
// ============================================================
export const PAIR_TO_FINNHUB_SYMBOL: Record<ForexPair, string> = {
  EURUSD: 'OANDA:EUR_USD',
  USDJPY: 'OANDA:USD_JPY',
  GBPUSD: 'OANDA:GBP_USD',
  XAUUSD: 'OANDA:XAU_USD',
};

// ============================================================
// FNH-003: Single source of truth for simulated base prices
// ============================================================
export const SIMULATED_BASES: Record<ForexPair, { price: number; pipSize: number; volatility: number }> = {
  EURUSD: { price: 1.0872, pipSize: 0.0001, volatility: 0.0003 },
  USDJPY: { price: 154.32, pipSize: 0.01, volatility: 0.15 },
  GBPUSD: { price: 1.2715, pipSize: 0.0001, volatility: 0.0004 },
  XAUUSD: { price: 2658.50, pipSize: 0.01, volatility: 3.5 },
};

// ============================================================
// FNH-019: Single source of truth for resolution → seconds mapping
// ============================================================
export const RESOLUTION_TO_SECONDS: Record<string, number> = {
  '1': 60, '5': 300, M1: 60, M2: 120, M5: 300, M15: 900,
  M30: 1800, '60': 3600, H1: 3600, H4: 14400, D1: 86400, W1: 604800,
};

/** Convert resolution alias (M1, H1, etc.) to Finnhub numeric format (1, 60, etc.) */
export function toFinnhubResolution(resolution: string): string {
  const map: Record<string, string> = { M1: '1', M2: '2', M5: '5', M15: '15', M30: '30', H1: '60', H4: '240', D1: 'D', W1: 'W' };
  return map[resolution] || resolution;
}

/** Get valid Finnhub resolutions for validation */
export const VALID_FINNHUB_RESOLUTIONS = ['1', '2', '5', '15', '30', '60', '240', 'D', 'W', 'M', 'M1', 'M2', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

export const FINEX_CONFIG = {
  leverage: 100,
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

// M2: Dead code removed — bridge config now in src/lib/mt5-config.ts

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

// ============================================================
// AI-006: Multi-Provider AI Architecture
// ============================================================

export type AiProviderId = 'zai' | 'groq' | 'openai' | 'tinyfish' | 'together' | 'lokal_ai';

export interface AiModel {
  id: string;
  name: string;
}

export interface AiProviderConfig {
  id: AiProviderId;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: AiModel[];
}

/** Result from AI completion call */
export interface AiCompletionResult {
  content: string;
  provider: AiProviderId;
  model: string;
}

/** Finnhub free tier: 60 calls/min. With 4 pairs polled every 5s = 48/min. */
export const FINNHUB_RATE_LIMIT_PER_MIN = 60;
/** MARKETAUX free tier: 100 requests/day */
export const MARKETAUX_RATE_LIMIT_PER_DAY = 100;

export const INDICATOR_POOL = [
  'EMA', 'SMA', 'VWAP', 'Supertrend', 'Parabolic SAR', 'RSI', 'Stochastic Oscillator',
  'MACD', 'Bollinger Bands', 'ATR', 'OBV', 'MFI', 'Tick Volume',
  'Ichimoku Cloud', 'HMA', 'Keltner Channel', 'Donchian Channel',
  'Linear Regression Channel', 'CCI', 'Momentum', 'Williams %R',
  'TSI', 'ROC', 'Schaff Trend Cycle', 'Ultimate Oscillator',
  'Standard Deviation', 'Chaikin Volatility', 'Volatility Ratio',
  'Volume Profile', 'Accumulation Distribution',
] as const;
