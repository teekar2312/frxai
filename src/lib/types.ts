// ============================================================
// FINEX AI TRADING SYSTEM — SHARED TYPES
// ============================================================

export type Pair =
  | 'EURUSD'
  | 'USDJPY'
  | 'GBPUSD'
  | 'USDCHF'
  | 'USDCAD'
  | 'AUDUSD'
  | 'NZDUSD'
  | 'EURJPY'
  | 'EURGBP'
  | 'EURCHF'
  | 'EURAUD'
  | 'GBPJPY'
  | 'GBPCHF'
  | 'AUDJPY'
  | 'CADJPY'
  | 'CHFJPY'
  | 'XAUUSD'
  | 'XAGUSD'
export type Side = 'BUY' | 'SELL'
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN'
export type SessionId = 'sydney' | 'tokyo' | 'london' | 'newyork'
export type AiProviderId = 'zai' | 'groq' | 'tinyfish' | 'openai' | 'google' | 'openrouter' | 'tokenplus' | 'local'
export type SelectionMode = 'manual' | 'ai'
export type SignalDirection = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL'
export type IndicatorSignal = 'BUY' | 'SELL' | 'NEUTRAL'
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW'
export type EngineMode = 'demo' | 'live'

export interface PriceTick {
  pair: Pair
  bid: number
  ask: number
  spread: number // in pips
  changePct: number
  changePips: number
  dayHigh: number
  dayLow: number
  digits: number
  updatedAt: string
}

export interface Candle {
  time: number // epoch ms
  open: number
  high: number
  low: number
  close: number
  volume: number // tick volume
}

export interface AccountInfo {
  balance: number
  equity: number
  margin: number
  freeMargin: number
  marginLevel: number
  floatingPnl: number
  dailyPnl: number
  dailyPnlPct: number
  dailyStartBalance: number
  dailyTargetPct: number
  dailyLimitPct: number
  currency: string
  leverage: number
  server: string
  login: string
  mode: 'DEMO' | 'LIVE'
  currencySymbol?: string
}

export interface PositionView {
  id: string
  ticket: string
  pair: Pair
  side: Side
  volume: number
  openPrice: number
  currentPrice: number
  stopLoss: number | null
  takeProfit: number | null
  trailing: boolean
  trailingPips: number
  profit: number
  pips: number
  commission: number
  source: 'MANUAL' | 'AI' | 'ANALYSIS'
  openedAt: string
  comment: string | null
  magic?: string
}

export interface ClosedTrade {
  id: string
  ticket: string
  pair: Pair
  side: Side
  volume: number
  openPrice: number
  closePrice: number
  profit: number
  pips: number
  commission: number
  reason: string
  source: string
  openedAt: string
  closedAt: string
  durationSec: number
}

export interface IndicatorReading {
  id: string
  name: string
  category: string
  value: string
  signal: IndicatorSignal
  weight: number
  detail?: string
}

export interface FundamentalBlock {
  title: string
  content: string
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
}

export interface MlPrediction {
  probability: number
  label: string
  samples: number
  accuracy: number
  modelVersion: number
}

export interface AnalysisResult {
  pair: Pair
  timeframe: Timeframe
  provider: AiProviderId
  providerLabel: string
  live: boolean // true = LLM asli (Z.AI via SDK), false = local ML fallback
  signal: SignalDirection
  confidence: number // 0..100
  score: number // -100..100
  entry: number
  stopLoss: number
  takeProfit: number
  stopLossPips: number
  takeProfitPips: number
  reasoning: string
  fundamentals: FundamentalBlock[]
  indicators: IndicatorReading[]
  newsSentiment: number // -1..1
  mlPrediction: MlPrediction
  createdAt: string
}

export interface SettingsData {
  tradingMode: SelectionMode
  pairMode: SelectionMode
  pairs: Pair[]
  sessionMode: SelectionMode
  sessions: SessionId[]
  timeframeMode: SelectionMode
  timeframes: Timeframe[]
  aiProvider: AiProviderId
  indicatorMode: SelectionMode
  indicators: string[]
  riskMode: SelectionMode
  riskPerTrade: number
  stopLossPips: number
  takeProfitRatio: number
  maxPositions: number
  dailyRiskLimit: number
  dailyTarget: number
  avoidNews: boolean
  trailingMode: SelectionMode
  trailingStopPips: number
  engineMode: EngineMode
  engineUrl: string
  emailEnabled: boolean
  emailTo: string
  emailEvents: string[]
}

export interface EngineStatus {
  mode: 'DEMO' | 'LIVE'
  connected: boolean
  aiTrading: boolean
  autoTradeCount: number
  manualTradeCount: number
  lastTickAt: string
  marketOpen: boolean
  activeSessions: SessionId[]
  latencyMs: number
  version: string
  lastAiDecision: string | null
  dailyBlocked: 'NONE' | 'LIMIT' | 'TARGET'
}

export interface NewsItemView {
  id: string
  source: string
  headline: string
  summary: string | null
  url: string | null
  sentiment: number
  impact: NewsImpact
  category: string | null
  pairs: string[]
  publishedAt: string
}

export interface CalendarEvent {
  id: string
  title: string
  currency: string
  impact: NewsImpact
  time: string // ISO
  minutesUntil: number
  actual: string | null
  forecast: string | null
  previous: string | null
}

export interface BacktestSummary {
  id: string
  pair: Pair
  timeframe: Timeframe
  indicators: string[]
  bars: number
  netProfit: number
  netProfitPct: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number
  maxDrawdownPct: number
  createdAt: string
}

export interface BacktestTrade {
  n: number
  side: Side
  entryTime: number
  exitTime: number
  entry: number
  exit: number
  pips: number
  profit: number
  reason: string
  balance: number
}

export interface BacktestDetail extends BacktestSummary {
  initialBalance: number
  finalBalance: number
  maxDrawdown: number
  avgTrade: number
  bestTrade: number
  worstTrade: number
  expectancy: number
  sharpe: number
  riskPerTrade: number
  stopLossPips: number
  takeProfitRatio: number
  equityCurve: { time: number; equity: number; drawdown: number }[]
  trades: BacktestTrade[]
}

export interface AlertView {
  id: string
  pair: Pair
  condition: 'ABOVE' | 'BELOW'
  price: number
  status: 'ACTIVE' | 'TRIGGERED' | 'CANCELLED'
  note: string | null
  createdAt: string
  triggeredAt: string | null
}

export interface LogEntryView {
  id: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
  category: string
  message: string
  details: string | null
  createdAt: string
}

export interface ModelStatView {
  indicator: string
  name: string
  category: string
  weight: number
  wins: number
  losses: number
  samples: number
  winRate: number
}

export interface EnginePollResponse {
  status: EngineStatus
  account: AccountInfo
  prices: PriceTick[]
  openPositions: number
  dailyPnlPct: number
}

export interface OrderRequest {
  action: 'open' | 'close' | 'closeAll' | 'modify'
  pair?: Pair
  side?: Side
  volume?: number
  stopLossPips?: number
  takeProfitPips?: number
  riskBased?: boolean
  positionId?: string
  stopLoss?: number | null
  takeProfit?: number | null
  trailing?: boolean
  source?: 'MANUAL' | 'AI' | 'ANALYSIS'
  /** Indicator ids that agreed with the signal at open (feeds the self-learning loop). */
  signalIndicators?: string[]
  comment?: string
}
