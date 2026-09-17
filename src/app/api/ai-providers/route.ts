import { NextRequest, NextResponse } from 'next/server'
import { getSimulator } from '@/lib/engine/simulator'
import { encryptSecret } from '@/lib/crypto'
import { AI_PROVIDER_REGISTRY, listProviderStatus } from '@/lib/ai-keys'
import { testProviderLlm } from '@/lib/ai-llm'
import { deleteCredential, upsertCredential } from '@/lib/ai-provider-credential-db'
import { syncAiKeysToEngine, type EngineSyncResult } from '@/lib/engine-sync'
import { AI_PROVIDERS } from '@/lib/constants'
import type { AiProviderId } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai-providers — status kredensial semua provider (tanpa plaintext key).
 * PUT /api/ai-providers — simpan: { provider, apiKey?, baseUrl?, model? }
 *   - apiKey: string non-kosong → simpan (enkripsi); "" → hapus key; undefined → biarkan
 *   - baseUrl / model: string → simpan; "" → kosongkan (pakai default/env); undefined → biarkan
 *   - Setelah simpan: kunci otomatis diteruskan ke engine (mode LIVE) → field `engineSync`.
 * POST /api/ai-providers — test koneksi: { provider }
 *                    atau sync manual ke engine: { action: 'sync-engine' }
 * DELETE /api/ai-providers?provider=x — hapus seluruh kredensial provider
 *   (lalu re-sync engine — override provider tsb. dikembalikan ke .env engine)
 *
 * Semua method di balik session gate (src/proxy.ts) — data sensitif.
 */

const VALID_IDS = new Set(Object.keys(AI_PROVIDER_REGISTRY) as string[])
const DESCRIPTIONS: Record<AiProviderId, string> = AI_PROVIDERS.reduce(
  (acc, p) => {
    acc[p.id] = p.description
    return acc
  },
  {} as Record<AiProviderId, string>,
)

function parseProvider(value: unknown): AiProviderId | null {
  if (typeof value !== 'string' || !VALID_IDS.has(value)) return null
  return value as AiProviderId
}

export async function GET() {
  try {
    const providers = await listProviderStatus(DESCRIPTIONS)
    return NextResponse.json({ providers })
  } catch (e) {
    return NextResponse.json(
      { error: `Gagal membaca status provider: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 },
    )
  }
}

export async function PUT(req: NextRequest) {
  const sim = getSimulator()
  try {
    const body = (await req.json()) as {
      provider?: unknown
      apiKey?: unknown
      baseUrl?: unknown
      model?: unknown
    }
    const provider = parseProvider(body.provider)
    if (!provider) {
      return NextResponse.json({ error: 'Provider tidak valid' }, { status: 400 })
    }

    const updates: {
      apiKeyEnc?: string | null
      baseUrl?: string | null
      model?: string | null
    } = {}
    let touched = 0

    if (typeof body.apiKey === 'string') {
      const key = body.apiKey.trim()
      if (key) {
        if (key.length < 8 || key.length > 512) {
          return NextResponse.json({ error: 'Panjang API key tidak wajar (8-512 karakter)' }, { status: 400 })
        }
        updates.apiKeyEnc = encryptSecret(key)
      } else {
        updates.apiKeyEnc = null // hapus key
      }
      touched++
    }

    if (typeof body.baseUrl === 'string') {
      const url = body.baseUrl.trim()
      if (url) {
        try {
          const u = new URL(url)
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('proto')
        } catch {
          return NextResponse.json({ error: 'Base URL tidak valid (harus http/https)' }, { status: 400 })
        }
        updates.baseUrl = url
      } else {
        updates.baseUrl = null
      }
      touched++
    }

    if (typeof body.model === 'string') {
      const m = body.model.trim()
      if (m) {
        if (m.length > 120 || /[\s`$"'<>]/.test(m)) {
          return NextResponse.json({ error: 'Nama model tidak valid' }, { status: 400 })
        }
        updates.model = m
      } else {
        updates.model = null
      }
      touched++
    }

    if (touched === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan untuk disimpan' }, { status: 400 })
    }

    await upsertCredential(provider, {
      ...(updates.apiKeyEnc !== undefined ? { apiKeyEnc: updates.apiKeyEnc } : {}),
      ...(updates.baseUrl !== undefined ? { baseUrl: updates.baseUrl } : {}),
      ...(updates.model !== undefined ? { model: updates.model } : {}),
      status: 'untested',
      lastError: null,
      testedAt: null,
    })

    const entry = AI_PROVIDER_REGISTRY[provider]
    await sim.log(
      'INFO',
      'SYSTEM',
      `API key ${entry.name} diperbarui dari dashboard`,
      [...(updates.apiKeyEnc !== undefined ? ['key ' + (updates.apiKeyEnc ? 'disimpan (terenkripsi)' : 'dihapus')] : []), ...(updates.baseUrl !== undefined ? [`baseUrl=${updates.baseUrl ?? 'default'}`] : []), ...(updates.model !== undefined ? [`model=${updates.model ?? 'default'}`] : [])].join(' · ') || '-',
    )

    // Teruskan kredensial terbaru ke engine (mode LIVE; timeout pendek agar
    // simpan tetap responsif walau engine sedang tidak terjangkau).
    const engineSync = await syncAiKeysToEngine({ timeoutMs: 3500 })

    const providers = await listProviderStatus(DESCRIPTIONS)
    return NextResponse.json({ providers, engineSync })
  } catch (e) {
    return NextResponse.json(
      { error: `Gagal menyimpan: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const sim = getSimulator()
  try {
    const body = (await req.json()) as { provider?: unknown; action?: unknown }

    // --- Aksi khusus: sinkronisasi manual kunci AI ke engine ---
    if (body.action === 'sync-engine') {
      const engineSync: EngineSyncResult = await syncAiKeysToEngine({ timeoutMs: 8000 })
      await sim.log(
        engineSync.ok ? 'INFO' : 'WARN',
        'SYSTEM',
        `Sinkronisasi kunci AI ke engine: ${engineSync.ok ? 'OK' : 'GAGAL'}`,
        engineSync.ok
          ? `${engineSync.count} provider (${(engineSync.applied ?? []).join(', ') || '-'}) → ${engineSync.engineUrl}`
          : (engineSync.detail ?? 'unknown'),
      )
      const providers = await listProviderStatus(DESCRIPTIONS)
      return NextResponse.json({ engineSync, providers })
    }

    const provider = parseProvider(body.provider)
    if (!provider) {
      return NextResponse.json({ error: 'Provider tidak valid' }, { status: 400 })
    }
    const result = await testProviderLlm(provider)
    await sim.log(
      result.ok ? 'INFO' : 'WARN',
      'AI',
      `Test koneksi ${AI_PROVIDER_REGISTRY[provider].name}: ${result.ok ? 'OK' : 'GAGAL'}`,
      result.message,
    )
    const providers = await listProviderStatus(DESCRIPTIONS)
    return NextResponse.json({ result, providers })
  } catch (e) {
    return NextResponse.json(
      { error: `Gagal test: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const sim = getSimulator()
  const provider = parseProvider(req.nextUrl.searchParams.get('provider'))
  if (!provider) {
    return NextResponse.json({ error: 'Parameter provider tidak valid' }, { status: 400 })
  }
  try {
    await deleteCredential(provider)
    const entry = AI_PROVIDER_REGISTRY[provider]
    await sim.log('INFO', 'SYSTEM', `Kredensial ${entry.name} dihapus (kembali ke fallback env)`)
    // Re-sync engine: provider yang dihapus tidak disertakan dalam payload →
    // override runtime-nya di engine dikembalikan ke resolusi .env engine.
    const engineSync = await syncAiKeysToEngine({ timeoutMs: 3500 })
    const providers = await listProviderStatus(DESCRIPTIONS)
    return NextResponse.json({ providers, engineSync })
  } catch (e) {
    return NextResponse.json(
      { error: `Gagal menghapus: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 500 },
    )
  }
}
