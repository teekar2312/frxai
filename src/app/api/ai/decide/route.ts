import { NextResponse } from 'next/server'
import { makeDecision, makeBatchDecision, getDecisionHistory, seedDecisionConfig, enableAdaptiveLearning, disableAdaptiveLearning } from '@/lib/ai-decision-engine'
import logger from '@/lib/trading-logger'

/**
 * POST /api/ai/decide — Make an AI trading decision
 * Body: { symbol: string, timeframe?: string, symbols?: string[] (for batch) }
 * Query: ?useLearning=true — enable adaptive weights + confidence calibration
 */
export async function POST(request: Request) {
  const url = new URL(request.url)
  const useLearning = url.searchParams.get('useLearning') === 'true'

  try {
    await seedDecisionConfig()

    // Enable/disable adaptive learning based on query param
    if (useLearning) {
      enableAdaptiveLearning()
    } else {
      disableAdaptiveLearning()
    }

    const body = await request.json().catch(() => ({}))
    const { symbol, timeframe, symbols } = body

    try {
      if (symbols && Array.isArray(symbols) && symbols.length > 0) {
        // Batch decision
        const decisions = await makeBatchDecision(symbols, timeframe)
        logger.info('AI_ENGINE', `Batch decision: ${decisions.length} symbols analyzed`, {
          metadata: {
            symbols: decisions.map(d => `${d.symbol}=${d.decision}(${d.confidence})`).join(', '),
            adaptiveLearning: useLearning,
          },
        })
        return NextResponse.json({ success: true, data: decisions, meta: { adaptiveLearning: useLearning } })
      }

      if (!symbol) {
        return NextResponse.json({ success: false, error: 'symbol is required' }, { status: 400 })
      }

      const decision = await makeDecision(symbol, timeframe)
      logger.info('AI_ENGINE', `Decision for ${symbol}: ${decision.decision} (confidence: ${decision.confidence})`, {
        symbol,
        metadata: {
          decision: decision.decision,
          confidence: decision.confidence,
          sentimentBlocked: decision.sentimentFactors.isBlocked,
          riskScore: decision.riskFactors.riskScore,
          adaptiveLearning: useLearning,
        },
      })

      return NextResponse.json({ success: true, data: decision, meta: { adaptiveLearning: useLearning } })
    } finally {
      // Always reset the flag after the request to avoid leaking state
      disableAdaptiveLearning()
    }
  } catch (error) {
    disableAdaptiveLearning()
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('AI_ENGINE', `AI decision failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/**
 * GET /api/ai/decide — Get decision history
 * Query: ?symbol=XXX&limit=N
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const symbol = url.searchParams.get('symbol') ?? undefined
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10)

    const history = await getDecisionHistory(symbol, limit)
    return NextResponse.json({ success: true, data: history })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('AI_ENGINE', `Decision history fetch failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
