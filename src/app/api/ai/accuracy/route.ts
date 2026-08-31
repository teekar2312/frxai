import { NextResponse } from 'next/server'
import { getDecisionAccuracy, getDecisionConfig, updateDecisionConfig, seedDecisionConfig } from '@/lib/ai-decision-engine'
import logger from '@/lib/trading-logger'

/**
 * GET /api/ai/accuracy — Get decision accuracy stats
 * Query: ?days=N
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const days = parseInt(url.searchParams.get('days') ?? '7', 10)
    const includeConfig = url.searchParams.get('config') === 'true'

    const [accuracy, config] = await Promise.all([
      getDecisionAccuracy(days),
      includeConfig ? getDecisionConfig() : null,
    ])

    return NextResponse.json({ success: true, data: { accuracy, config } })
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
