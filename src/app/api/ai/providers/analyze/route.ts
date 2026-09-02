import { NextRequest, NextResponse } from 'next/server'
import { chat, buildMarketAnalysisPrompt, buildSentimentAnalysisPrompt, buildNewsSummaryPrompt, buildPortfolioAnalysisPrompt } from '@/lib/ai-providers'
import type { AiAnalysisResult, AiSentimentResult, AiNewsSummary } from '@/lib/ai-providers'

/**
 * POST /api/ai/providers/analyze — Run AI analysis using configured providers
 * Body: { task: 'market_analysis' | 'sentiment' | 'news_summary' | 'portfolio', ...params }
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { task, provider: preferProvider } = body

    let messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
    let taskType: 'market_analysis' | 'sentiment_analysis' | 'news_summary' | 'strategy_suggestion' | 'risk_assessment' = 'market_analysis'
    let jsonMode = true

    switch (task) {
      case 'market_analysis': {
        const { symbol, price, change, technicalSummary, recentNews, sentimentSummary, sector } = body
        if (!symbol || price === undefined) {
          return NextResponse.json({ success: false, error: 'symbol and price required' }, { status: 400 })
        }
        messages = buildMarketAnalysisPrompt({ symbol, price, change: change || 0, technicalSummary: technicalSummary || '', recentNews: recentNews || '', sentimentSummary: sentimentSummary || '', sector })
        taskType = 'market_analysis'
        break
      }

      case 'sentiment': {
        const { text, symbol, context } = body
        if (!text) {
          return NextResponse.json({ success: false, error: 'text required' }, { status: 400 })
        }
        messages = buildSentimentAnalysisPrompt({ text, symbol, context })
        taskType = 'sentiment_analysis'
        break
      }

      case 'news_summary': {
        const { title, content, source } = body
        if (!title || !content) {
          return NextResponse.json({ success: false, error: 'title and content required' }, { status: 400 })
        }
        messages = buildNewsSummaryPrompt({ title, content, source })
        taskType = 'news_summary'
        break
      }

      case 'portfolio': {
        const { symbols, marketOverview, riskAlerts } = body
        if (!symbols || !Array.isArray(symbols)) {
          return NextResponse.json({ success: false, error: 'symbols array required' }, { status: 400 })
        }
        messages = buildPortfolioAnalysisPrompt({ symbols, marketOverview: marketOverview || '', riskAlerts: riskAlerts || '' })
        taskType = 'market_analysis'
        break
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown task: ${task}` }, { status: 400 })
    }

    const response = await chat(
      { messages, jsonMode },
      { taskType, provider: preferProvider },
    )

    // Try to parse the JSON response
    let parsed: Record<string, unknown> | null = null
    try {
      const content = response.content.trim()
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content
      parsed = JSON.parse(jsonStr)
    } catch {
      // Not valid JSON, return raw text
    }

    return NextResponse.json({
      success: true,
      data: {
        task,
        parsed,
        raw: response.content,
        provider: response.provider,
        model: response.model,
        usage: response.usage,
        latencyMs: response.latencyMs,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
