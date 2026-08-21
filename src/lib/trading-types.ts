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
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: 'BUY' | 'SELL' | 'HOLD' | 'AVOID';
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
  id?: string;
  createdAt?: string;
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
  pips: number;
  type: 'manual' | 'automatic';
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

export const TIMEFRAMES = ['M1', 'M2', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'] as const;

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

// Realistic default spreads per pair (in pips)
export const DEFAULT_SPREADS: Record<ForexPair, number> = {
  EURUSD: 0.8,   // ~0.8 pips typical
  GBPUSD: 1.2,   // ~1.2 pips typical
  USDJPY: 1.0,   // ~1.0 pips typical
  XAUUSD: 30,    // ~30 pips typical for gold
};

/**
 * FALLBACK configuration constants.
 * In production, these values are overridden by TradingConfig from the database.
 * These defaults are only used when the DB has no config record.
 */
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

// ============================================================
// Extended pair list for custom watchlist
// ============================================================
export const EXTENDED_PAIRS: string[] = [
  'EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD',
  'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY',
];

export const EXTENDED_PAIR_DISPLAY: Record<string, string> = {
  EURUSD: 'EUR/USD', USDJPY: 'USD/JPY', GBPUSD: 'GBP/USD', XAUUSD: 'XAU/USD',
  USDCHF: 'USD/CHF', AUDUSD: 'AUD/USD', NZDUSD: 'NZD/USD', USDCAD: 'USD/CAD',
  EURGBP: 'EUR/GBP', EURJPY: 'EUR/JPY', GBPJPY: 'GBP/JPY', AUDJPY: 'AUD/JPY',
};

export const EXTENDED_PAIR_PIP_VALUES: Record<string, { standard: number; pipSize: number }> = {
  EURUSD: { standard: 10, pipSize: 0.0001 },
  USDJPY: { standard: 6.5, pipSize: 0.01 },
  GBPUSD: { standard: 10, pipSize: 0.0001 },
  XAUUSD: { standard: 1, pipSize: 0.01 },
  USDCHF: { standard: 11.5, pipSize: 0.0001 },
  AUDUSD: { standard: 6.5, pipSize: 0.0001 },
  NZDUSD: { standard: 6.5, pipSize: 0.0001 },
  USDCAD: { standard: 7.5, pipSize: 0.0001 },
  EURGBP: { standard: 13, pipSize: 0.0001 },
  EURJPY: { standard: 6.8, pipSize: 0.01 },
  GBPJPY: { standard: 7.3, pipSize: 0.01 },
  AUDJPY: { standard: 6.5, pipSize: 0.01 },
};

export const EXTENDED_PAIR_FINNHUB: Record<string, string> = {
  EURUSD: 'OANDA:EUR_USD', USDJPY: 'OANDA:USD_JPY', GBPUSD: 'OANDA:GBP_USD', XAUUSD: 'OANDA:XAU_USD',
  USDCHF: 'OANDA:USD_CHF', AUDUSD: 'OANDA:AUD_USD', NZDUSD: 'OANDA:NZD_USD', USDCAD: 'OANDA:USD_CAD',
  EURGBP: 'OANDA:EUR_GBP', EURJPY: 'OANDA:EUR_JPY', GBPJPY: 'OANDA:GBP_JPY', AUDJPY: 'OANDA:AUD_JPY',
};

export type PendingOrderType = 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop';

export interface PendingOrder {
  id: string;
  pair: string;
  direction: 'BUY' | 'SELL';
  orderType: PendingOrderType;
  lotSize: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: 'pending' | 'executed' | 'cancelled' | 'expired';
  strategy: string | null;
  aiConfidence: number | null;
  riskLevel: string | null;
  aiRecommendation: string | null;
  triggeredAt: string | null;
  createdAt: string;
}

export interface InAppNotification {
  id: string;
  type: 'signal' | 'alert' | 'position_open' | 'position_close' | 'system' | 'auto_trade';
  title: string;
  message: string;
  pair?: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface EconomicEvent {
  id: string;
  date: string;
  time: string;
  currency: string;
  impact: 'high' | 'medium' | 'low';
  title: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  category: string | null;
}

export interface TradeAnalytics {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  bestPair: string;
  worstPair: string;
  pnlByPair: Record<string, number>;
  pnlByDay: { date: string; pnl: number }[];
  pnlByHour: { hour: number; pnl: number }[];
  winRateByPair: Record<string, number>;
  equityCurve: { date: string; equity: number }[];
}
