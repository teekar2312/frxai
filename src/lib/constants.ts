import type { AiProviderId, Pair, SessionId, Timeframe } from './types'

// ============================================================
// FINEX AI TRADING SYSTEM — CONSTANTS
// ============================================================

export interface PairConfig {
  id: Pair
  name: string
  digits: number
  pipSize: number
  pipValuePerLot: number // USD per pip per 1.0 lot
  contractSize: number
  basePrice: number
  volPipsPerMin: number
  spreadMin: number // pips
  spreadMax: number
  commodity: boolean
}

// Urutan: 7 majors → 9 crosses → 2 metals. Semua pair dapat dipilih
// di seluruh selector (settings, trading, analysis, alerts, backtest).
export const PAIRS: PairConfig[] = [
  // Majors (USD di salah satu sisi)
  { id: 'EURUSD', name: 'EUR/USD', digits: 5, pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, basePrice: 1.0842, volPipsPerMin: 1.5, spreadMin: 0.5, spreadMax: 1.4, commodity: false },
  { id: 'USDJPY', name: 'USD/JPY', digits: 3, pipSize: 0.01, pipValuePerLot: 6.5, contractSize: 100000, basePrice: 154.38, volPipsPerMin: 1.7, spreadMin: 0.6, spreadMax: 1.6, commodity: false },
  { id: 'GBPUSD', name: 'GBP/USD', digits: 5, pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, basePrice: 1.2653, volPipsPerMin: 2.0, spreadMin: 0.9, spreadMax: 2.2, commodity: false },
  { id: 'USDCHF', name: 'USD/CHF', digits: 5, pipSize: 0.0001, pipValuePerLot: 11.2, contractSize: 100000, basePrice: 0.8895, volPipsPerMin: 1.4, spreadMin: 0.8, spreadMax: 1.8, commodity: false },
  { id: 'USDCAD', name: 'USD/CAD', digits: 5, pipSize: 0.0001, pipValuePerLot: 7.3, contractSize: 100000, basePrice: 1.372, volPipsPerMin: 1.4, spreadMin: 0.9, spreadMax: 2.0, commodity: false },
  { id: 'AUDUSD', name: 'AUD/USD', digits: 5, pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, basePrice: 0.6528, volPipsPerMin: 1.4, spreadMin: 0.8, spreadMax: 1.8, commodity: false },
  { id: 'NZDUSD', name: 'NZD/USD', digits: 5, pipSize: 0.0001, pipValuePerLot: 10, contractSize: 100000, basePrice: 0.5963, volPipsPerMin: 1.5, spreadMin: 1.0, spreadMax: 2.2, commodity: false },
  // Crosses (tanpa USD)
  { id: 'EURJPY', name: 'EUR/JPY', digits: 3, pipSize: 0.01, pipValuePerLot: 6.5, contractSize: 100000, basePrice: 167.42, volPipsPerMin: 1.8, spreadMin: 1.0, spreadMax: 2.2, commodity: false },
  { id: 'EURGBP', name: 'EUR/GBP', digits: 5, pipSize: 0.0001, pipValuePerLot: 12.7, contractSize: 100000, basePrice: 0.857, volPipsPerMin: 1.0, spreadMin: 0.9, spreadMax: 2.0, commodity: false },
  { id: 'EURCHF', name: 'EUR/CHF', digits: 5, pipSize: 0.0001, pipValuePerLot: 11.2, contractSize: 100000, basePrice: 0.9644, volPipsPerMin: 0.9, spreadMin: 1.0, spreadMax: 2.2, commodity: false },
  { id: 'EURAUD', name: 'EUR/AUD', digits: 5, pipSize: 0.0001, pipValuePerLot: 6.5, contractSize: 100000, basePrice: 1.6614, volPipsPerMin: 1.7, spreadMin: 1.2, spreadMax: 2.6, commodity: false },
  { id: 'GBPJPY', name: 'GBP/JPY', digits: 3, pipSize: 0.01, pipValuePerLot: 6.5, contractSize: 100000, basePrice: 195.34, volPipsPerMin: 2.6, spreadMin: 1.4, spreadMax: 3.0, commodity: false },
  { id: 'GBPCHF', name: 'GBP/CHF', digits: 5, pipSize: 0.0001, pipValuePerLot: 11.2, contractSize: 100000, basePrice: 1.1255, volPipsPerMin: 1.6, spreadMin: 1.2, spreadMax: 2.6, commodity: false },
  { id: 'AUDJPY', name: 'AUD/JPY', digits: 3, pipSize: 0.01, pipValuePerLot: 6.5, contractSize: 100000, basePrice: 100.78, volPipsPerMin: 1.8, spreadMin: 1.0, spreadMax: 2.2, commodity: false },
  { id: 'CADJPY', name: 'CAD/JPY', digits: 3, pipSize: 0.01, pipValuePerLot: 6.5, contractSize: 100000, basePrice: 112.52, volPipsPerMin: 1.8, spreadMin: 1.2, spreadMax: 2.6, commodity: false },
  { id: 'CHFJPY', name: 'CHF/JPY', digits: 3, pipSize: 0.01, pipValuePerLot: 6.5, contractSize: 100000, basePrice: 173.55, volPipsPerMin: 1.7, spreadMin: 1.2, spreadMax: 2.6, commodity: false },
  // Metals
  { id: 'XAUUSD', name: 'XAU/USD', digits: 2, pipSize: 0.1, pipValuePerLot: 10, contractSize: 100, basePrice: 2648.5, volPipsPerMin: 3.2, spreadMin: 1.6, spreadMax: 3.6, commodity: true },
  { id: 'XAGUSD', name: 'XAG/USD', digits: 3, pipSize: 0.01, pipValuePerLot: 50, contractSize: 5000, basePrice: 30.85, volPipsPerMin: 2.5, spreadMin: 2.0, spreadMax: 4.0, commodity: true },
]

export const PAIR_IDS = PAIRS.map((p) => p.id)

export function getPairConfig(pair: string): PairConfig {
  return PAIRS.find((p) => p.id === pair) ?? PAIRS[0]
}

// ------------------------------------------------------------
// Trading sessions (UTC hours, approximate; handles wrap-around)
// ------------------------------------------------------------
export interface SessionConfig {
  id: SessionId
  name: string
  city: string
  tz: string // IANA tz for clock display
  openUtc: number // hour (can be fractional)
  closeUtc: number
  color: string // tailwind text color class
}

export const SESSIONS: SessionConfig[] = [
  { id: 'sydney', name: 'Sydney', city: 'Australia', tz: 'Australia/Sydney', openUtc: 21, closeUtc: 6, color: 'text-violet-400' },
  { id: 'tokyo', name: 'Tokyo', city: 'Japan', tz: 'Asia/Tokyo', openUtc: 0, closeUtc: 9, color: 'text-rose-400' },
  { id: 'london', name: 'London', city: 'UK', tz: 'Europe/London', openUtc: 8, closeUtc: 17, color: 'text-emerald-400' },
  { id: 'newyork', name: 'New York', city: 'USA', tz: 'America/New_York', openUtc: 13, closeUtc: 22, color: 'text-amber-400' },
]

export const SESSION_IDS = SESSIONS.map((s) => s.id)

export function isSessionActive(sessionId: SessionId, date = new Date()): boolean {
  const s = SESSIONS.find((x) => x.id === sessionId)
  if (!s) return false
  const h = date.getUTCHours() + date.getUTCMinutes() / 60
  if (s.openUtc < s.closeUtc) return h >= s.openUtc && h < s.closeUtc
  return h >= s.openUtc || h < s.closeUtc // wraps midnight
}

export function sessionProgress(sessionId: SessionId, date = new Date()): number {
  const s = SESSIONS.find((x) => x.id === sessionId)
  if (!s) return 0
  const h = date.getUTCHours() + date.getUTCMinutes() / 60
  const len = s.openUtc < s.closeUtc ? s.closeUtc - s.openUtc : 24 - s.openUtc + s.closeUtc
  const elapsed = h >= s.openUtc ? h - s.openUtc : h + 24 - s.openUtc
  return Math.min(1, Math.max(0, elapsed / len))
}

// ------------------------------------------------------------
// Timeframes
// ------------------------------------------------------------
export interface TimeframeConfig {
  id: Timeframe
  minutes: number
  label: string
}

export const TIMEFRAMES: TimeframeConfig[] = [
  { id: 'M1', minutes: 1, label: 'M1' },
  { id: 'M5', minutes: 5, label: 'M5' },
  { id: 'M15', minutes: 15, label: 'M15' },
  { id: 'M30', minutes: 30, label: 'M30' },
  { id: 'H1', minutes: 60, label: 'H1' },
  { id: 'H4', minutes: 240, label: 'H4' },
  { id: 'D1', minutes: 1440, label: 'D1' },
  { id: 'W1', minutes: 10080, label: 'W1' },
  { id: 'MN', minutes: 43200, label: 'MN' },
]

export const TIMEFRAME_IDS = TIMEFRAMES.map((t) => t.id)

export function getTimeframeMinutes(tf: string): number {
  return TIMEFRAMES.find((t) => t.id === tf)?.minutes ?? 15
}

// ------------------------------------------------------------
// AI Providers (selection is manual)
// ------------------------------------------------------------
export interface AiProviderConfig {
  id: AiProviderId
  name: string
  model: string
  description: string
  demoLive: boolean // true = benar-benar memanggil LLM di mode demo (via z-ai-web-dev-sdk)
}

export const AI_PROVIDERS: AiProviderConfig[] = [
  { id: 'zai', name: 'Z.AI', model: 'GLM-4.6', description: 'Z.AI GLM — aktif langsung di dashboard (via SDK)', demoLive: true },
  { id: 'groq', name: 'Groq AI', model: 'llama-3.3-70b', description: 'Groq LPU ultra-fast inference', demoLive: false },
  { id: 'tinyfish', name: 'Tinyfish AI', model: 'tinyfish-1', description: 'Tinyfish edge AI provider', demoLive: false },
  { id: 'openai', name: 'OpenAI', model: 'gpt-4o', description: 'OpenAI GPT-4o', demoLive: false },
  { id: 'google', name: 'Google AI Studio', model: 'gemini-2.0-flash', description: 'Google Gemini via AI Studio', demoLive: false },
  { id: 'openrouter', name: 'OpenRouter AI', model: 'multi-model', description: 'OpenRouter aggregator (100+ model)', demoLive: false },
  { id: 'tokenplus', name: 'Tokenplus AI', model: 'tokenplus-pro', description: 'Tokenplus AI API', demoLive: false },
  { id: 'local', name: 'Local AI', model: 'ollama / llama.cpp', description: 'AI lokal (Ollama, tanpa biaya API)', demoLive: false },
]

export const AI_PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id)

export function getProviderConfig(id: string): AiProviderConfig {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]
}

// ------------------------------------------------------------
// Technical indicators (30)
// ------------------------------------------------------------
export interface IndicatorConfig {
  id: string
  name: string
  category: 'Trend' | 'Momentum' | 'Volatility' | 'Volume'
}

export const INDICATORS: IndicatorConfig[] = [
  // Trend (7)
  { id: 'ema', name: 'EMA', category: 'Trend' },
  { id: 'sma', name: 'SMA', category: 'Trend' },
  { id: 'hma', name: 'Hull MA', category: 'Trend' },
  { id: 'supertrend', name: 'Supertrend', category: 'Trend' },
  { id: 'psar', name: 'Parabolic SAR', category: 'Trend' },
  { id: 'ichimoku', name: 'Ichimoku Cloud', category: 'Trend' },
  { id: 'linreg', name: 'Linear Reg. Channel', category: 'Trend' },
  // Momentum (10)
  { id: 'macd', name: 'MACD', category: 'Momentum' },
  { id: 'rsi', name: 'RSI', category: 'Momentum' },
  { id: 'stoch', name: 'Stochastic', category: 'Momentum' },
  { id: 'cci', name: 'CCI', category: 'Momentum' },
  { id: 'momentum', name: 'Momentum', category: 'Momentum' },
  { id: 'williamsr', name: 'Williams %R', category: 'Momentum' },
  { id: 'tsi', name: 'True Strength Index', category: 'Momentum' },
  { id: 'roc', name: 'Rate of Change', category: 'Momentum' },
  { id: 'stc', name: 'Schaff Trend Cycle', category: 'Momentum' },
  { id: 'uo', name: 'Ultimate Oscillator', category: 'Momentum' },
  // Volatility (7)
  { id: 'bollinger', name: 'Bollinger Bands', category: 'Volatility' },
  { id: 'atr', name: 'ATR', category: 'Volatility' },
  { id: 'keltner', name: 'Keltner Channel', category: 'Volatility' },
  { id: 'donchian', name: 'Donchian Channel', category: 'Volatility' },
  { id: 'stddev', name: 'Standard Deviation', category: 'Volatility' },
  { id: 'chaikin', name: 'Chaikin Volatility', category: 'Volatility' },
  { id: 'volratio', name: 'Volatility Ratio', category: 'Volatility' },
  // Volume (6)
  { id: 'vwap', name: 'VWAP', category: 'Volume' },
  { id: 'obv', name: 'On Balance Volume', category: 'Volume' },
  { id: 'mfi', name: 'Money Flow Index', category: 'Volume' },
  { id: 'tickvol', name: 'Tick Volume', category: 'Volume' },
  { id: 'volumeprofile', name: 'Volume Profile', category: 'Volume' },
  { id: 'ad', name: 'Accumulation/Dist', category: 'Volume' },
]

export const INDICATOR_IDS = INDICATORS.map((i) => i.id)
export const INDICATOR_CATEGORIES = ['Trend', 'Momentum', 'Volatility', 'Volume'] as const

export function getIndicatorConfig(id: string): IndicatorConfig {
  return INDICATORS.find((i) => i.id === id) ?? INDICATORS[0]
}

// ------------------------------------------------------------
// Risk management limits (FINEX money management)
// ------------------------------------------------------------
export const RISK_LIMITS = {
  riskPerTrade: { min: 0.5, max: 1.0, step: 0.05, default: 0.75 },
  stopLossPips: { min: 5, max: 15, step: 1, default: 10 },
  takeProfitRatio: { min: 1.0, max: 3.0, step: 0.1, default: 1.5 },
  maxPositions: { min: 1, max: 3, step: 1, default: 2 },
  dailyRiskLimit: { min: 2.0, max: 3.0, step: 0.1, default: 2.5 },
  dailyTarget: { min: 1.0, max: 3.0, step: 0.1, default: 2.0 },
  trailingStopPips: { min: 3, max: 30, step: 1, default: 6 },
  volume: { min: 0.01, max: 50, step: 0.01 },
}

// ------------------------------------------------------------
// Broker profile — FINEX Indonesia
// ------------------------------------------------------------
export const BROKER_PROFILE = {
  name: 'FINEX Indonesia',
  leverageForex: '1:500',
  leverageMetals: '1:500',
  spread: 'Floating dari 0.5 pip',
  commission: '$1 per lot',
  minVolume: 0.01,
  maxVolumePerOrder: 50,
  maxOpenPositions: 200,
  marginCall: 50,
  stopOut: 20,
}

// ------------------------------------------------------------
// Notification events
// ------------------------------------------------------------
export const EVENTS_NOTIF = [
  { id: 'trade_open', label: 'Posisi dibuka' },
  { id: 'trade_close', label: 'Posisi ditutup' },
  { id: 'alert', label: 'Alert harga terpicu' },
  { id: 'error', label: 'Error engine' },
  { id: 'daily_report', label: 'Laporan harian' },
  { id: 'daily_limit', label: 'Daily limit / target tercapai' },
]

// ------------------------------------------------------------
// Default settings
// ------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  tradingMode: 'manual' as const,
  pairMode: 'manual' as const,
  pairs: ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'],
  sessionMode: 'manual' as const,
  sessions: ['sydney', 'tokyo', 'london', 'newyork'],
  timeframeMode: 'manual' as const,
  timeframes: ['M15', 'M30', 'H1'],
  aiProvider: 'zai' as const,
  indicatorMode: 'manual' as const,
  indicators: ['ema', 'rsi', 'macd', 'atr', 'bollinger', 'supertrend', 'stoch', 'vwap', 'obv', 'cci', 'williamsr', 'momentum', 'psar', 'sma', 'donchian', 'mfi', 'roc', 'stddev', 'ad', 'tickvol'],
  riskMode: 'manual' as const,
  riskPerTrade: 0.75,
  stopLossPips: 10,
  takeProfitRatio: 1.5,
  maxPositions: 2,
  dailyRiskLimit: 2.5,
  dailyTarget: 2.0,
  avoidNews: true,
  trailingMode: 'manual' as const,
  trailingStopPips: 6,
  engineMode: 'demo' as const,
  engineUrl: 'http://localhost:8000',
  emailEnabled: false,
  emailTo: '',
  emailEvents: ['trade_open', 'trade_close', 'alert', 'error', 'daily_report'],
}

export const APP_VERSION = '1.0.0'
