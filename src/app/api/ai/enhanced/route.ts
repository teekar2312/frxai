import { NextRequest, NextResponse } from 'next/server'
import { makeDecision, seedDecisionConfig } from '@/lib/ai-decision-engine'
import { getLlmStatus } from '@/lib/ai-providers'
import logger from '@/lib/trading-logger'

/**
 * POST /api/ai/enhanced — Get LLM-enhanced AI decision
 *
 * Same as /api/ai/decide but ensures LLM providers are checked first.
 * Body: { symbol: string, timeframe?: string, useLearning?: boolean }
 *
 * Also returns LLM status information so the frontend can show
 * whether LLM analysis was used and which provider handled it.
 */
export async function POST(request: NextRequest) {
  try {
    await seedDecisionConfig()

    const body = await request.json().catch(() => ({}))
    const { symbol, timeframe, useLearning } = body

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'symbol is required' },
        { status: 400 },
      )
    }

    // Get LLM status in parallel with the decision
    const [decision, llmStatus] = await Promise.all([
      makeDecision(
        symbol,
        timeframe,
        undefined,
        useLearning === true,
      ),
      getLlmStatus(),
    ])

    return NextResponse.json({
      success: true,
      data: {
        ...decision,
        // Ensure dates are serialized
        createdAt: decision.createdAt.toISOString(),
      },
      meta: {
        llmStatus,
        enhanced: !!decision.llmEnhancement?.used,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logger.error('AI_ENHANCED', `Enhanced decision failed: ${msg}`)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/**
 * GET /api/ai/enhanced/status — Get LLM provider status
 */
export async function GET() {
  try {
    const status = await getLlmStatus()
    return NextResponse.json({ success: true, data: status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
