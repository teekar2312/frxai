import { NextResponse } from 'next/server'
import { getDecisionAccuracy, getDecisionConfig, updateDecisionConfig, seedDecisionConfig, runFeedbackLoop, getStrategyPerformance, loadSelfLearningState } from '@/lib/ai-decision-engine'
import logger from '@/lib/trading-logger'

/**
 * GET /api/ai/accuracy — Get decision accuracy stats
 * Query: ?days=N&config=true&learning=true&strategies=true
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const days = parseInt(url.searchParams.get('days') ?? '7', 10)
    const includeConfig = url.searchParams.get('config') === 'true'
    const includeLearning = url.searchParams.get('learning') === 'true'
    const includeStrategies = url.searchParams.get('strategies') === 'true'

    const promises: Promise<unknown>[] = [
      getDecisionAccuracy(days),
      includeConfig ? getDecisionConfig() : Promise.resolve(null),
      includeLearning ? loadSelfLearningState() : Promise.resolve(null),
      includeStrategies ? getStrategyPerformance(days) : Promise.resolve(null),
    ]

    const [accuracy, config, learningState, strategies] = await Promise.all(promises)

    return NextResponse.json({
      success: true,
      data: {
        accuracy,
        ...(includeConfig ? { config } : {}),
        ...(includeLearning ? { learningState } : {}),
        ...(includeStrategies ? { strategies } : {}),
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('AI_ENGINE', `Accuracy fetch failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/**
 * PUT /api/ai/accuracy — Update AI decision config
 * Body: Partial<AiDecisionConfig>
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    await seedDecisionConfig()
    const updated = await updateDecisionConfig(body)
    logger.info('AI_ENGINE', 'AI decision config updated', { metadata: body })
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('AI_ENGINE', `Config update failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/**
 * POST /api/ai/accuracy — Trigger self-learning feedback loop
 * Query: ?days=N (default 30)
 * Body: optional { days?: number }
 *
 * Runs the full feedback loop: analyzes recent decisions and trade outcomes,
 * updates adaptive weights, confidence calibration, and strategy performance.
 * Returns the updated SelfLearningState.
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const queryDays = parseInt(url.searchParams.get('days') ?? '30', 10)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const days = typeof body.days === 'number' ? body.days : queryDays

    const state = await runFeedbackLoop(days)

    return NextResponse.json({
      success: true,
      data: {
        message: `Feedback loop completed. Analyzed ${state.totalAnalyzed} decisions.`,
        state,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('AI_ENGINE', `Feedback loop trigger failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
