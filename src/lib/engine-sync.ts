/**
 * engine-sync.ts — Penerusan kredensial AI provider dari dashboard ke Python engine.
 *
 * Dashboard adalah sumber kebenaran untuk kunci yang diinput manual
 * (DB AiProviderCredential, terenkripsi) maupun env dashboard. Saat mode
 * engine LIVE, kredensial tersebut diteruskan ke endpoint
 * `PUT /api/v1/ai-keys` engine sebagai *runtime override* (hanya di memori
 * engine) — dilindungi guard `X-Engine-Key` engine.
 *
 * Pemicu sinkronisasi:
 *   1. Simpan/hapus kunci di Settings (route /api/ai-providers)
 *   2. Tombol "Sync ke Engine" (POST /api/ai-providers {action:'sync-engine'})
 *   3. Auto-resync berkala dari poll route (healing setelah engine restart)
 *
 * Keamanan: payload berisi PLAINTEXT key — hanya dikirim ke engineUrl yang
 * dikonfigurasi, via koneksi yang seharusnya HTTPS/tunnel (lihat
 * PRODUCTION.md §keamanan jaringan engine). Nilai kunci tidak pernah di-log.
 */

import 'server-only'
import { getSimulator } from '@/lib/engine/simulator'
import { AI_PROVIDER_REGISTRY, resolveCredential } from '@/lib/ai-keys'
import type { AiProviderId } from '@/lib/types'

export type EngineSyncReason = 'demo-mode' | 'no-keys' | 'bad-url' | 'unreachable' | 'http-error'

export interface EngineSyncResult {
  ok: boolean
  reason?: EngineSyncReason
  detail?: string
  /** URL engine yang dituju (saat ok / kegagalan jaringan). */
  engineUrl?: string
  /** Jumlah provider dalam payload yang dikirim. */
  count?: number
  /** Id provider yang diterima engine (dari respons engine). */
  applied?: string[]
}

interface EngineKeyPayload {
  providers: Record<string, { apiKey?: string; baseUrl?: string; model?: string }>
  count: number
}

/**
 * Bangun payload kredensial untuk engine: resolusi penuh (DB → env) per
 * provider, hanya field yang bermakna (kunci bila ada; baseUrl/model hanya
 * bila berbeda dari default registry agar engine memakai default-nya sendiri).
 */
export async function buildEngineKeyPayload(): Promise<EngineKeyPayload> {
  const ids = Object.keys(AI_PROVIDER_REGISTRY) as AiProviderId[]
  const providers: EngineKeyPayload['providers'] = {}
  let count = 0
  for (const id of ids) {
    const entry = AI_PROVIDER_REGISTRY[id]
    const cred = await resolveCredential(id)
    const override: { apiKey?: string; baseUrl?: string; model?: string } = {}
    if (cred.apiKey && !entry.noKeyNeeded) override.apiKey = cred.apiKey
    if (cred.baseUrl && cred.baseUrl !== entry.baseUrlDefault) override.baseUrl = cred.baseUrl
    if (cred.model && cred.model !== entry.defaultModel) override.model = cred.model
    if (override.apiKey || override.baseUrl || override.model) {
      providers[id] = override
      count++
    }
  }
  return { providers, count }
}

/**
 * Teruskan kredensial AI ke engine (mode LIVE saja).
 *
 * @param opts.allowEmpty  true (default) = tetap PUT walau payload kosong —
 *   mengosongkan override engine (dipakai setelah hapus kunci terakhir).
 *   false = lewati HTTP bila tidak ada yang diteruskan (dipakai auto-resync).
 */
export async function syncAiKeysToEngine(
  opts: { timeoutMs?: number; allowEmpty?: boolean } = {},
): Promise<EngineSyncResult> {
  const timeoutMs = opts.timeoutMs ?? 6000
  const allowEmpty = opts.allowEmpty ?? true

  const sim = getSimulator()
  const settings = await sim.getSettings()
  if (settings.engineMode !== 'live') {
    return {
      ok: false,
      reason: 'demo-mode',
      detail: 'Mode engine DEMO — kunci hanya dipakai dashboard. Aktifkan mode LIVE untuk meneruskan kunci ke engine.',
    }
  }
  const base = settings.engineUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/.+/i.test(base)) {
    return { ok: false, reason: 'bad-url', detail: 'Engine URL tidak valid (harus diawali http:// atau https://).' }
  }

  const { providers, count } = await buildEngineKeyPayload()
  if (count === 0 && !allowEmpty) {
    return { ok: false, reason: 'no-keys', detail: 'Tidak ada kunci/override untuk diteruskan.' }
  }

  const engineKey = process.env.ENGINE_API_KEY?.trim() ?? ''
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/api/v1/ai-keys`, {
      method: 'PUT',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(engineKey ? { 'X-Engine-Key': engineKey } : {}),
      },
      body: JSON.stringify({ providers, syncedAt: new Date().toISOString() }),
    })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 200)
      return {
        ok: false,
        reason: 'http-error',
        detail: `Engine menolak sinkronisasi (HTTP ${res.status})${text ? ` — ${text}` : ''}`,
        engineUrl: base,
      }
    }
    const json = (await res.json().catch(() => null)) as { applied?: string[] } | null
    return {
      ok: true,
      engineUrl: base,
      count,
      applied: json?.applied ?? Object.keys(providers),
      detail:
        count === 0
          ? 'Tidak ada kunci tersimpan — override runtime di engine dikosongkan (engine kembali ke .env-nya).'
          : undefined,
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: `Engine tidak terjangkau (${e instanceof Error ? e.message : 'unknown'}) — periksa engineUrl dan pastikan engine berjalan.`,
      engineUrl: base,
    }
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------------
// Auto-resync berkala (healing setelah engine restart)
// ------------------------------------------------------------

const AUTO_SYNC_INTERVAL_MS = 5 * 60_000

const g = globalThis as unknown as {
  __finexAiKeySyncAt?: number
  __finexAiKeySyncBusy?: boolean
}

/**
 * Resync rate-limited (maks satu per 5 menit) — dipanggil dari poll route
 * setelah engine LIVE terjangkau, sehingga override kunci pulih otomatis
 * setelah engine restart. Fire-and-forget: tidak pernah melempar error.
 */
export function maybeAutoSyncAiKeys(): void {
  if (g.__finexAiKeySyncBusy) return
  if (Date.now() - (g.__finexAiKeySyncAt ?? 0) < AUTO_SYNC_INTERVAL_MS) return
  g.__finexAiKeySyncBusy = true
  g.__finexAiKeySyncAt = Date.now()
  void syncAiKeysToEngine({ timeoutMs: 5000, allowEmpty: false })
    .then((r) => {
      if (!r.ok) return
      const sim = getSimulator()
      void sim.log(
        'INFO',
        'SYSTEM',
        `Kunci AI tersinkron ke engine (${r.count} provider: ${(r.applied ?? []).join(', ') || '-'})`,
        `Runtime override di memori engine — prioritas di atas .env engine. Engine: ${r.engineUrl}`,
      )
    })
    .catch(() => {})
    .finally(() => {
      g.__finexAiKeySyncBusy = false
    })
}
