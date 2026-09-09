import type { IndicatorDef, Pair, Session, Timeframe } from "./types";

export const PAIRS: { symbol: Pair; label: string; pipSize: number; digits: number; basePrice: number }[] = [
  { symbol: "EURUSD", label: "Euro / US Dollar", pipSize: 0.0001, digits: 5, basePrice: 1.0855 },
  { symbol: "USDJPY", label: "US Dollar / Japanese Yen", pipSize: 0.01, digits: 3, basePrice: 157.42 },
  { symbol: "GBPUSD", label: "Pound / US Dollar", pipSize: 0.0001, digits: 5, basePrice: 1.2715 },
  { symbol: "XAUUSD", label: "Gold / US Dollar", pipSize: 0.1, digits: 2, basePrice: 2338.5 },
];

export const TIMEFRAMES: { value: Timeframe; label: string; minutes: number }[] = [
  { value: "M1", label: "1 Minute", minutes: 1 },
  { value: "M5", label: "5 Minutes", minutes: 5 },
  { value: "M15", label: "15 Minutes", minutes: 15 },
  { value: "M30", label: "30 Minutes", minutes: 30 },
  { value: "H1", label: "1 Hour", minutes: 60 },
  { value: "H4", label: "4 Hours", minutes: 240 },
  { value: "D1", label: "1 Day", minutes: 1440 },
];

export const SESSIONS: { value: Session; label: string; utcStart: number; utcEnd: number; color: string }[] = [
  { value: "Sydney", label: "Sydney", utcStart: 21, utcEnd: 6, color: "emerald" },
  { value: "Tokyo", label: "Tokyo", utcStart: 0, utcEnd: 9, color: "rose" },
  { value: "London", label: "London", utcStart: 7, utcEnd: 16, color: "amber" },
  { value: "NewYork", label: "New York", utcStart: 12, utcEnd: 21, color: "sky" },
  { value: "LondonNewYork", label: "London + New York Overlap", utcStart: 12, utcEnd: 16, color: "violet" },
  { value: "NewYorkTokyo", label: "New York + Tokyo Overlap", utcStart: 21, utcEnd: 0, color: "teal" },
];

export const BROKER_SPEC = {
  name: "FINEX Indonesia",
  leverageForexMetals: "1:500",
  spreadFrom: "0.5 pip",
  commission: "$1 per lot",
  minVolume: 0.01,
  maxVolumePerOrder: 50,
  maxOpenPositions: 200,
  marginCall: 50,
  stopOut: 20,
};

// 30-indicator pool tuned for scalping
export const INDICATOR_POOL: IndicatorDef[] = [
  // Trend
  { name: "EMA", category: "trend", defaultParams: { fast: 9, slow: 21 }, scalpingHint: "Fast/slow crossover on M1-M5 for scalping bias." },
  { name: "SMA", category: "trend", defaultParams: { fast: 10, slow: 20 }, scalpingHint: "Smoothed trend filter; pair with momentum." },
  { name: "VWAP", category: "trend", defaultParams: { band: 1.5 }, scalpingHint: "Intraday fair value; revert from bands." },
  { name: "Supertrend", category: "trend", defaultParams: { atr: 10, multiplier: 3 }, scalpingHint: "Trailing trend flip; tight ATR for scalps." },
  { name: "Parabolic SAR", category: "trend", defaultParams: { step: 0.02, max: 0.2 }, scalpingHint: "Trailing stop dots; exit on flip." },
  { name: "Ichimoku Cloud", category: "trend", defaultParams: { conversion: 9, base: 26, span: 52 }, scalpingHint: "Cloud bias + Tenkan/Kijun cross." },
  { name: "Hull Moving Average", category: "trend", defaultParams: { period: 16 }, scalpingHint: "Low-lag MA; color flips for scalps." },
  { name: "Linear Regression Channel", category: "trend", defaultParams: { period: 50, dev: 2 }, scalpingHint: "Mean-revert at channel edges." },

  // Momentum
  { name: "RSI", category: "momentum", defaultParams: { period: 14, ob: 70, os: 30 }, scalpingHint: "OB/OS on M1-M5; divergence for reversals." },
  { name: "Stochastic Oscillator", category: "momentum", defaultParams: { k: 14, d: 3, smooth: 3 }, scalpingHint: "%K/%D cross in OB/OS zones." },
  { name: "MACD", category: "momentum", defaultParams: { fast: 12, slow: 26, signal: 9 }, scalpingHint: "Histogram momentum shifts." },
  { name: "CCI", category: "momentum", defaultParams: { period: 20 }, scalpingHint: "±100 extremes for scalping reversals." },
  { name: "Momentum Indicator", category: "momentum", defaultParams: { period: 10 }, scalpingHint: "Rate of price change confirmation." },
  { name: "Williams %R", category: "momentum", defaultParams: { period: 14 }, scalpingHint: "-20/-80 extremes for scalp fades." },
  { name: "TSI", category: "momentum", defaultParams: { r: 25, s: 13 }, scalpingHint: "Smoothed momentum; divergence trades." },
  { name: "ROC", category: "momentum", defaultParams: { period: 9 }, scalpingHint: "Quick momentum bursts for entries." },
  { name: "Schaff Trend Cycle", category: "momentum", defaultParams: { cycle: 10, fast: 23, slow: 50 }, scalpingHint: "Cycle turns at 25/75 for scalps." },
  { name: "Ultimate Oscillator", category: "momentum", defaultParams: { c1: 7, c2: 14, c3: 28 }, scalpingHint: "Multi-period OB/OS divergence." },

  // Volatility
  { name: "Bollinger Bands", category: "volatility", defaultParams: { period: 20, dev: 2 }, scalpingHint: "Squeeze breakouts; band fades." },
  { name: "ATR", category: "volatility", defaultParams: { period: 14 }, scalpingHint: "Dynamic SL sizing for scalps." },
  { name: "Standard Deviation", category: "volatility", defaultParams: { period: 20 }, scalpingHint: "Volatility regime filter." },
  { name: "Chaikin Volatility", category: "volatility", defaultParams: { period: 10, roc: 10 }, scalpingHint: "Volatility expansion alerts." },
  { name: "Volatility Ratio", category: "volatility", defaultParams: { period: 14 }, scalpingHint: "Breakout probability gauge." },

  // Channel
  { name: "Keltner Channel", category: "channel", defaultParams: { period: 20, multiplier: 1.5 }, scalpingHint: "ATR channel; trend ride inside." },
  { name: "Donchian Channel", category: "channel", defaultParams: { period: 20 }, scalpingHint: "Breakout highs/lows for scalps." },

  // Volume
  { name: "OBV", category: "volume", defaultParams: {}, scalpingHint: "Volume confirms trend; divergence warns." },
  { name: "Money Flow Index", category: "volume", defaultParams: { period: 14 }, scalpingHint: "Volume-weighted OB/OS." },
  { name: "Tick Volume", category: "volume", defaultParams: {}, scalpingHint: "Proxy tick activity for entries." },
  { name: "Volume Profile", category: "volume", defaultParams: { bins: 24 }, scalpingHint: "POC / value-area scalping." },
  { name: "Accumulation Distribution", category: "volume", defaultParams: {}, scalpingHint: "Flow pressure; divergence trades." },
];

export const INDICATOR_CATEGORIES = [
  { key: "trend", label: "Trend", color: "emerald" },
  { key: "momentum", label: "Momentum", color: "amber" },
  { key: "volatility", label: "Volatility", color: "rose" },
  { key: "channel", label: "Channel", color: "sky" },
  { key: "volume", label: "Volume", color: "violet" },
] as const;

export const FACTOR_LIST = [
  "Kebijakan Bank Sentral",
  "Data Ekonomi Utama (NFP, CPI, PPI, GDP, Unemployment, Retail Sales, PMI)",
  "Kondisi Politik & Geopolitik",
  "Kebijakan Fiskal & Ekonomi",
  "Harga Komoditas",
  "Sentimen Pasar",
  "Berita Dadakan / Breaking News",
];

export const AI_PROVIDERS = [
  { key: "zai", label: "Z.ai (default)", note: "Built-in — always available" },
  { key: "groq", label: "Groq AI", note: "Ultra-low latency inference" },
  { key: "openai", label: "OpenAI", note: "GPT-4 class reasoning" },
  { key: "together", label: "Together.ai", note: "Open-source models" },
  { key: "tinyfish", label: "Tinyfish.ai", note: "Edge AI" },
] as const;
