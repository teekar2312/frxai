import { NextRequest, NextResponse } from 'next/server'
import { getAllProviderConfigs, getProviderConfig, updateProviderConfig, enableProvider, getProviderMetas, seedProviderConfigs } from '@/lib/ai-providers'

/**
 * GET /api/ai/providers — List all provider configs + metadata
 * PUT /api/ai/providers — Update a provider config
 * POST /api/ai/providers — Seed default provider configs
 */

export async function GET() {
  try {
    // Ensure defaults are seeded
    await seedProviderConfigs()

    const configs = await getAllProviderConfigs()
    const metas = getProviderMetas()

    // Merge config data with metadata
    const merged = metas.map(meta => {
      const config = configs.find(c => c.provider === meta.id)
      return {
        ...meta,
        config: config
          ? {
              id: config.id,
              enabled: config.enabled,
              apiKey: config.apiKey ? '••••••••' + config.apiKey.slice(-4) : '',
              baseUrl: config.baseUrl,
              model: config.model,
              temperature: config.temperature,
              maxTokens: config.maxTokens,
              topP: config.topP,
              frequencyPenalty: config.frequencyPenalty,
              presencePenalty: config.presencePenalty,
              systemPrompt: config.systemPrompt,
              roles: config.roles,
              priority: config.priority,
              timeoutMs: config.timeoutMs,
              lastTestedAt: config.lastTestedAt,
              lastTestResult: config.lastTestResult,
              lastLatencyMs: config.lastLatencyMs,
            }
          : null,
      }
    })

    return NextResponse.json({ success: true, data: merged })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { provider, ...data } = body

    if (!provider) {
      return NextResponse.json({ success: false, error: 'Provider ID required' }, { status: 400 })
    }

    const updated = await updateProviderConfig(provider, data)

    // Mask API key in response
    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        apiKey: updated.apiKey ? '••••••••' + updated.apiKey.slice(-4) : '',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (body.action === 'seed') {
      await seedProviderConfigs()
      return NextResponse.json({ success: true, message: 'Provider configs seeded' })
    }

    if (body.action === 'toggle') {
      const { provider, enabled } = body
      if (!provider || enabled === undefined) {
        return NextResponse.json({ success: false, error: 'provider and enabled required' }, { status: 400 })
      }
      await enableProvider(provider, enabled)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
