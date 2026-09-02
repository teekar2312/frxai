import { NextRequest, NextResponse } from 'next/server'
import { testProvider } from '@/lib/ai-providers'

/**
 * POST /api/ai/providers/test — Test a single provider connection
 * Body: { provider: AiProviderId }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { provider } = body

    if (!provider) {
      return NextResponse.json(
        { success: false, error: 'provider ID is required' },
        { status: 400 },
      )
    }

    const result = await testProvider(provider)
    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
