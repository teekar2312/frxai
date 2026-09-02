// ============================================
// LLM Analysis Bridge
// Connects the multi-provider AI system with the
// AI Decision Engine for LLM-enhanced analysis.
// ============================================

import { chat, buildMarketAnalysisPrompt, buildSentimentAnalysisPrompt, buildNewsSummaryPrompt, resolveProvider, type AiAnalysisResult, type AiSentimentResult, type AiNewsSummary, type AiProviderId, type AnalysisTaskType } from './index'
import type { TechnicalFactors, NewsFactors, SentimentFactors, RiskFactors } from '../ai-decision-engine'
import logger from '../trading-logger'

// ---- Types ----

export interface LlmAnalysisResult {
  /** Whether LLM analysis was performed */
  used: boolean
  /** Which provider was used */
  provider: AiProviderId | null
  /** Model used */
  model: string | null
  /** Latency in ms */
  latencyMs: number | null
  /** Parsed market analysis from LLM */
  marketAnalysis: AiAnalysisResult | null
  /** Parsed sentiment from LLM */
  sentimentAnalysis: AiSentimentResult | null
  /** Parsed news summary from LLM */
  newsSummary: AiNewsSummary | null
  /** Raw LLM response text */
  rawResponse: string | null
  /** Error if LLM call failed */
  error: string | null
  /** Token usage */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  } | null
}

/**
 * Check if any AI provider is configured and enabled for a given task.
 */
export async function isLlmAvailable(taskType: AnalysisTaskType = 'market_analysis'): Promise<boolean> {
  try {
    const provider = await resolveProvider(taskType)
    return provider !== null
  } catch {
    return false
  }
}

/**
 * Get the list of enabled providers with their status.
 */
export async function getLlmStatus(): Promise<{
  available: boolean
  activeProviders: string[]
  taskCoverage: Record<string, boolean>
}> {
  const tasks: AnalysisTaskType[] = ['market_analysis', 'sentiment_analysis', 'news_summary', 'strategy_suggestion', 'risk_assessment']
  const taskCoverage: Record<string, boolean> = {}

  for (const task of tasks) {
    taskCoverage[task] = await isLlmAvailable(task)
  }

  const activeProviders = new Set<string>()
  for (const task of tasks) {
    if (taskCoverage[task]) {
      const provider = await resolveProvider(task)
      if (provider) activeProviders.add(provider.provider)
    }
  }

  return {
    available: Object.values(taskCoverage).some(v => v),
    activeProviders: Array.from(activeProviders),
    taskCoverage,
  }
}

// ---- Technical Summary Builder ----

/**
 * Build a human-readable technical summary from TechnicalFactors.
 */
export function buildTechnicalSummary(tech: TechnicalFactors): string {
  const lines: string[] = []

  // Trend
  lines.push(`Trend: ${tech.trendDirection} (strength: ${tech.trendStrength}%)`)

  // RSI
  lines.push(`RSI(14): ${tech.rsiValue.toFixed(1)} [${tech.rsiSignal}]`)

  // MACD
  lines.push(`MACD: ${tech.macdSignal} (histogram: ${tech.macdHistogram})`)

  // Bollinger
  lines.push(`Bollinger Bands: ${tech.bollingerPosition}`)

  // ADX
  lines.push(`ADX: ${tech.adxValue.toFixed(1)}`)

  // Stochastic
  lines.push(`Stochastic: ${tech.stochasticSignal}`)

  // ATR
  if (tech.atrValue !== null) {
    lines.push(`ATR: ${tech.atrValue.toFixed(4)}`)
  }

  // Volume
  lines.push(`Volume: ${tech.volumeTrend}`)

  // Support/Resistance
  if (tech.supportLevel > 0) lines.push(`Support: ${tech.supportLevel.toFixed(2)}`)
  if (tech.resistanceLevel > 0) lines.push(`Resistance: ${tech.resistanceLevel.toFixed(2)}`)

  // Individual signals
  if (tech.signals.length > 0) {
    lines.push(`\nSignal Breakdown:`)
    for (const sig of tech.signals) {
      lines.push(`  - ${sig.name}: ${sig.signal} (score: ${sig.score}, weight: ${sig.weight})`)
    }
  }

  // Overall score
  lines.push(`\nOverall Technical Score: ${tech.overallScore}/100`)

  return lines.join('\n')
}

/**
 * Build a human-readable news summary from NewsFactors.
 */
export function buildNewsSummaryText(news: NewsFactors): string {
  const lines: string[] = []
  lines.push(`Berita terkait: ${news.recentNewsCount} artikel`)
  lines.push(`Positif: ${news.positiveNews}, Negatif: ${news.negativeNews}`)
  if (news.breakingNewsCount > 0) {
    lines.push(`BREAKING NEWS: ${news.breakingNewsCount} berita penting!`)
  }
  lines.push(`News Impact Score: ${news.newsImpactScore}/100`)
  if (news.topHeadlines.length > 0) {
    lines.push(`\nHeadline Teratas:`)
    for (const h of news.topHeadlines.slice(0, 5)) {
      lines.push(`  - ${h}`)
    }
  }
  return lines.join('\n')
}

/**
 * Build a human-readable sentiment summary from SentimentFactors.
 */
export function buildSentimentSummaryText(sent: SentimentFactors): string {
  const lines: string[] = []
  lines.push(`Sentimen Saham: ${sent.symbolScore}/100 [${sent.regime}]`)
  lines.push(`Sentimen Pasar: ${sent.marketScore}/100`)
  lines.push(`Tren Sentimen: ${sent.trend}`)
  lines.push(`Confidence: ${sent.confidence}%`)
  if (sent.isBlocked) {
    lines.push(`STATUS: DIBLOKIR (extreme sentiment)`)
  }
  return lines.join('\n')
}

// ---- LLM-Enhanced Analysis Functions ----

/**
 * Run LLM-enhanced market analysis using the multi-provider system.
 * Returns structured analysis from the LLM, or a fallback result if no provider is available.
 */
export async function runLlmMarketAnalysis(params: {
  symbol: string
  price: number
  change: number
  technicalFactors: TechnicalFactors
  newsFactors: NewsFactors
  sentimentFactors: SentimentFactors
  sector?: string
  preferProvider?: AiProviderId
}): Promise<LlmAnalysisResult> {
  const { symbol, price, change, technicalFactors, newsFactors, sentimentFactors, sector, preferProvider } = params

  // Build technical, news, and sentiment summaries for the prompt
  const technicalSummary = buildTechnicalSummary(technicalFactors)
  const recentNews = buildNewsSummaryText(newsFactors)
  const sentimentSummary = buildSentimentSummaryText(sentimentFactors)

  try {
    const messages = buildMarketAnalysisPrompt({
      symbol,
      price,
      change,
      technicalSummary,
      recentNews,
      sentimentSummary,
      sector,
    })

    const response = await chat(
      { messages, jsonMode: true },
      { taskType: 'market_analysis', provider: preferProvider },
    )

    // Parse the JSON response
    let marketAnalysis: AiAnalysisResult | null = null
    const content = response.content.trim()
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content
      marketAnalysis = JSON.parse(jsonStr) as AiAnalysisResult
    } catch {
      logger.warn('LLM_BRIDGE', `Failed to parse LLM JSON response for ${symbol}`, { symbol })
    }

    return {
      used: true,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      marketAnalysis,
      sentimentAnalysis: null,
      newsSummary: null,
      rawResponse: content,
      error: null,
      usage: response.usage,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.warn('LLM_BRIDGE', `LLM market analysis failed for ${symbol}: ${errorMsg}`, { symbol })

    return {
      used: false,
      provider: null,
      model: null,
      latencyMs: null,
      marketAnalysis: null,
      sentimentAnalysis: null,
      newsSummary: null,
      rawResponse: null,
      error: errorMsg,
      usage: null,
    }
  }
}

/**
 * Run LLM-enhanced sentiment analysis on a text.
 */
export async function runLlmSentimentAnalysis(params: {
  text: string
  symbol?: string
  context?: string
  preferProvider?: AiProviderId
}): Promise<LlmAnalysisResult> {
  const { text, symbol, context, preferProvider } = params

  try {
    const messages = buildSentimentAnalysisPrompt({ text, symbol, context })

    const response = await chat(
      { messages, jsonMode: true },
      { taskType: 'sentiment_analysis', provider: preferProvider },
    )

    let sentimentAnalysis: AiSentimentResult | null = null
    const content = response.content.trim()
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content
      sentimentAnalysis = JSON.parse(jsonStr) as AiSentimentResult
    } catch {
      logger.warn('LLM_BRIDGE', 'Failed to parse LLM sentiment JSON')
    }

    return {
      used: true,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      marketAnalysis: null,
      sentimentAnalysis,
      newsSummary: null,
      rawResponse: content,
      error: null,
      usage: response.usage,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.warn('LLM_BRIDGE', `LLM sentiment analysis failed: ${errorMsg}`)

    return {
      used: false,
      provider: null,
      model: null,
      latencyMs: null,
      marketAnalysis: null,
      sentimentAnalysis: null,
      newsSummary: null,
      rawResponse: null,
      error: errorMsg,
      usage: null,
    }
  }
}

/**
 * Run LLM-enhanced news summarization.
 */
export async function runLlmNewsSummary(params: {
  title: string
  content: string
  source?: string
  preferProvider?: AiProviderId
}): Promise<LlmAnalysisResult> {
  const { title, content, source, preferProvider } = params

  try {
    const messages = buildNewsSummaryPrompt({ title, content, source })

    const response = await chat(
      { messages, jsonMode: true },
      { taskType: 'news_summary', provider: preferProvider },
    )

    let newsSummary: AiNewsSummary | null = null
    const rawContent = response.content.trim()
    try {
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawContent
      newsSummary = JSON.parse(jsonStr) as AiNewsSummary
    } catch {
      logger.warn('LLM_BRIDGE', 'Failed to parse LLM news summary JSON')
    }

    return {
      used: true,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      marketAnalysis: null,
      sentimentAnalysis: null,
      newsSummary,
      rawResponse: rawContent,
      error: null,
      usage: response.usage,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.warn('LLM_BRIDGE', `LLM news summary failed: ${errorMsg}`)

    return {
      used: false,
      provider: null,
      model: null,
      latencyMs: null,
      marketAnalysis: null,
      sentimentAnalysis: null,
      newsSummary: null,
      rawResponse: null,
      error: errorMsg,
      usage: null,
    }
  }
}

/**
 * Generate LLM-powered reasoning for a decision.
 * Takes the deterministic factors and asks the LLM for a deeper analysis.
 */
export async function generateLlmReasoning(params: {
  symbol: string
  decision: string
  confidence: number
  compositeScore: number
  technicalFactors: TechnicalFactors
  newsFactors: NewsFactors
  sentimentFactors: SentimentFactors
  riskFactors: RiskFactors
  preferProvider?: AiProviderId
}): Promise<{ reasoning: string; provider: AiProviderId | null; model: string | null; latencyMs: number | null }> {
  const { symbol, decision, confidence, compositeScore, technicalFactors, newsFactors, sentimentFactors, riskFactors, preferProvider } = params

  const technicalSummary = buildTechnicalSummary(technicalFactors)
  const newsSummary = buildNewsSummaryText(newsFactors)
  const sentimentSummary = buildSentimentSummaryText(sentimentFactors)

  const userContent = `Berdasarkan analisis teknikal, berita, dan sentimen berikut untuk ${symbol}:

**Keputusan Sistem:** ${decision}
**Confidence:** ${confidence}%
**Composite Score:** ${compositeScore}/100

**Analisis Teknikal:**
${technicalSummary}

**Analisis Berita:**
${newsSummary}

**Analisis Sentimen:**
${sentimentSummary}

**Konteks Risiko:**
- Risk Score: ${riskFactors.riskScore}/10
- Volatility Regime: ${riskFactors.volatilityRegime}
- Open Positions: ${riskFactors.openPositions}
- Consecutive Losses: ${riskFactors.consecutiveLosses}

Berikan penilaianmu dalam 2-4 kalimat Bahasa Indonesia:
1. Apakah kamu setuju dengan keputusan sistem? Mengapa?
2. Faktor apa yang paling berpengaruh?
3. Apakah ada risiko tersembunyi yang perlu diperhatikan?

Respons hanya teks biasa, tanpa JSON.`

  try {
    const response = await chat(
      {
        messages: [
          {
            role: 'system',
            content: 'Kamu adalah AI co-analis untuk sistem trading otomatis FINEX Indonesia. Evaluasi keputusan trading dan berikan perspektif tambahan. Gunakan Bahasa Indonesia.',
          },
          { role: 'user', content: userContent },
        ],
      },
      { taskType: 'market_analysis', provider: preferProvider },
    )

    return {
      reasoning: response.content.trim(),
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.warn('LLM_BRIDGE', `LLM reasoning generation failed: ${errorMsg}`)
    return {
      reasoning: '',
      provider: null,
      model: null,
      latencyMs: null,
    }
  }
}
