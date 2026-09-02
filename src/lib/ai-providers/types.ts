// ============================================
// Multi-Provider AI System — Types & Interfaces
// ============================================

/** Supported AI provider identifiers */
export type AiProviderId = 'groq' | 'openai' | 'together' | 'tinyfish' | 'local'

/** Provider display metadata (no secrets) */
export interface AiProviderMeta {
  id: AiProviderId
  name: string
  description: string
  website: string
  models: AiModelInfo[]
  defaultModel: string
  defaultBaseUrl: string
  supportsStreaming: boolean
  supportsVision: boolean
  maxContextTokens: number
  iconColor: string
}

export interface AiModelInfo {
  id: string
  name: string
  maxTokens: number
  supportsVision: boolean
  contextWindow: number
}

/** Per-provider configuration stored in DB */
export interface AiProviderConfigData {
  id: string
  provider: AiProviderId
  name: string
  enabled: boolean
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
  systemPrompt: string
  /** Role this provider plays: 'primary' | 'sentiment' | 'news_summary' | 'analysis' */
  roles: string[]
 /** Priority for fallback routing (lower = higher priority) */
  priority: number
  /** Timeout in ms */
  timeoutMs: number
  /** Last successful test timestamp */
  lastTestedAt: string | null
  /** Last test result */
  lastTestResult: 'success' | 'failure' | null
  /** Latency in ms from last test */
  lastLatencyMs: number | null
  createdAt: string
  updatedAt: string
}

/** Unified request to any provider */
export interface AiChatRequest {
  messages: AiMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  jsonMode?: boolean
  /** If true, return structured analysis instead of raw text */
 analysisMode?: boolean
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Optional base64 image for vision models */
 images?: string[]
}

/** Unified response from any provider */
export interface AiChatResponse {
  content: string
  model: string
  provider: AiProviderId
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  latencyMs: number
  finishReason: string
}

/** Structured analysis response (parsed from LLM JSON output) */
export interface AiAnalysisResult {
  marketCondition: 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGE_BOUND' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY'
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  confidence: number
  action: 'BUY' | 'SELL' | 'HOLD' | 'SKIP'
  reasoning: string
  keyFactors: AnalysisFactor[]
  riskAssessment: string
  sentimentBias: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  suggestedStopLoss?: number
  suggestedTakeProfit?: number
  suggestedLotSize?: number
}

export interface AnalysisFactor {
  name: string
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  score: number
  detail: string
}

/** Sentiment analysis result from LLM */
export interface AiSentimentResult {
  score: number // -100 to +100
  label: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL'
  confidence: number // 0-100
  keyPhrases: string[]
  summary: string
}

/** News summarization result from LLM */
export interface AiNewsSummary {
  summary: string
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
  impact: 'HIGH' | 'MEDIUM' | 'LOW'
  keyEntities: string[]
  symbols: string[]
}

/** Test connection result */
export interface AiProviderTestResult {
  success: boolean
  latencyMs: number
  model: string
  response: string
  error?: string
}

/** Analysis task types */
export type AnalysisTaskType =
  | 'market_analysis'
  | 'sentiment_analysis'
  | 'news_summary'
  | 'strategy_suggestion'
  | 'risk_assessment'

/** Provider capability flags */
export interface ProviderCapabilities {
  chat: boolean
  streaming: boolean
  vision: boolean
  jsonMode: boolean
  functionCalling: boolean
}
