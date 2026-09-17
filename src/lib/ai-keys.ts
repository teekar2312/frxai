/**
 * ai-keys.ts — Registry & resolusi kredensial AI provider (server-only).
 *
 * Sumber kunci (prioritas):
 *   1. Input manual dashboard → DB `AiProviderCredential` (terenkripsi AES-256-GCM)
 *   2. Environment variable (nama IDENTIK dengan python-engine/.env —
 *      ZAI_API_KEY, GROQ_API_KEY, TINYFISH_API_KEY, OPENAI_API_KEY,
 *      GOOGLE_API_KEY, OPENROUTER_API_KEY, TOKENPLUS_API_KEY, OLLAMA_BASE_URL)
 *
 * Registry endpoint mencerminkan python-engine/app/ai_providers.py agar
 * dashboard (mode DEMO / analisa on-demand) dan engine LIVE berperilaku sama.
 */

import 'server-only'
import { getCredentialRow, listCredentialRows } from '@/lib/ai-provider-credential-db'
import { decryptSecret, maskKey } from '@/lib/crypto'
import type { AiProviderId } from '@/lib/types'

export type AiCallStyle = 'openai' | 'gemini' | 'ollama'

export interface AiProviderRegistryEntry {
  id: AiProviderId
  name: string
  defaultModel: string
  /** Nama env untuk API key (python-engine memakai nama yang sama). */
  envKey: string | null // null untuk 'local' (pakai baseUrl env saja)
  /** Nama env untuk override base URL. */
  envBaseUrl: string | null
  baseUrlDefault: string
  path: string
  style: AiCallStyle
  /** URL/penunjuk cara mengambil kunci (untuk hint UI). */
  keyHint: string
  /** true = dashboard punya jalur keyless bawaan (Z.AI via SDK). */
  keylessSdk: boolean
  /** true = provider tidak butuh API key (Ollama lokal). */
  noKeyNeeded: boolean
}

export const AI_PROVIDER_REGISTRY: Record<AiProviderId, AiProviderRegistryEntry> = {
  zai: {
    id: 'zai',
    name: 'Z.AI',
    defaultModel: 'glm-4.6',
    envKey: 'ZAI_API_KEY',
    envBaseUrl: null,
    baseUrlDefault: 'https://api.z.ai/api/paas/v4',
    path: '/chat/completions',
    style: 'openai',
    keyHint: 'Opsional — dashboard sudah punya akses bawaan via SDK. Key manual dipakai bila ingin panggil API langsung (daftar di z.ai / BigModel).',
    keylessSdk: true,
    noKeyNeeded: false,
  },
  groq: {
    id: 'groq',
    name: 'Groq AI',
    defaultModel: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY',
    envBaseUrl: null,
    baseUrlDefault: 'https://api.groq.com/openai/v1',
    path: '/chat/completions',
    style: 'openai',
    keyHint: 'Ambil gratis di console.groq.com/keys.',
    keylessSdk: false,
    noKeyNeeded: false,
  },
  tinyfish: {
    id: 'tinyfish',
    name: 'Tinyfish AI',
    defaultModel: 'tinyfish-1',
    envKey: 'TINYFISH_API_KEY',
    envBaseUrl: 'TINYFISH_BASE_URL',
    baseUrlDefault: 'https://api.tinyfish.ai',
    path: '/v1/chat/completions',
    style: 'openai',
    keyHint: 'Ambil di dashboard Tinyfish; endpoint kustom bisa diisi di kolom Base URL.',
    keylessSdk: false,
    noKeyNeeded: false,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    envKey: 'OPENAI_API_KEY',
    envBaseUrl: null,
    baseUrlDefault: 'https://api.openai.com/v1',
    path: '/chat/completions',
    style: 'openai',
    keyHint: 'Buat di platform.openai.com/api-keys.',
    keylessSdk: false,
    noKeyNeeded: false,
  },
  google: {
    id: 'google',
    name: 'Google AI Studio',
    defaultModel: 'gemini-2.0-flash',
    envKey: 'GOOGLE_API_KEY',
    envBaseUrl: null,
    baseUrlDefault: 'https://generativelanguage.googleapis.com/v1beta',
    path: '',
    style: 'gemini',
    keyHint: 'Buat gratis di aistudio.google.com/app/apikey.',
    keylessSdk: false,
    noKeyNeeded: false,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter AI',
    defaultModel: 'openrouter/auto',
    envKey: 'OPENROUTER_API_KEY',
    envBaseUrl: null,
    baseUrlDefault: 'https://openrouter.ai/api/v1',
    path: '/chat/completions',
    style: 'openai',
    keyHint: 'Ambil di openrouter.ai/keys (agregator 100+ model).',
    keylessSdk: false,
    noKeyNeeded: false,
  },
  tokenplus: {
    id: 'tokenplus',
    name: 'Tokenplus AI',
    defaultModel: 'tokenplus-pro',
    envKey: 'TOKENPLUS_API_KEY',
    envBaseUrl: 'TOKENPLUS_BASE_URL',
    baseUrlDefault: 'https://api.tokenplus.ai/v1',
    path: '/chat/completions',
    style: 'openai',
    keyHint: 'Ambil di dashboard Tokenplus; endpoint kustom bisa diisi di kolom Base URL.',
    keylessSdk: false,
    noKeyNeeded: false,
  },
  local: {
    id: 'local',
    name: 'Local AI',
    defaultModel: 'qwen2.5:14b',
    envKey: null,
    envBaseUrl: 'OLLAMA_BASE_URL',
    baseUrlDefault: 'http://localhost:11434',
    path: '/api/chat',
    style: 'ollama',
    keyHint: 'Tanpa API key — install Ollama (ollama.com), `ollama pull <model>`, pastikan base URL benar.',
    keylessSdk: false,
    noKeyNeeded: true,
  },
}

export type KeySource = 'db' | 'env' | 'none'

export interface ResolvedCredential {
  provider: AiProviderId
  apiKey: string // kosong bila tidak ada
  keySource: KeySource
  keyMasked: string | null
  baseUrl: string
  model: string
  modelSource: 'db' | 'env' | 'default'
}

/** Baca semua kredensial tersimpan (didekrip) — dipakai analysis & test. */
export async function resolveCredential(
  provider: AiProviderId,
): Promise<ResolvedCredential> {
  const entry = AI_PROVIDER_REGISTRY[provider]
  let row: { apiKeyEnc: string | null; baseUrl: string | null; model: string | null } | null = null
  try {
    row = await getCredentialRow(provider)
  } catch {
    row = null // DB bermasalah → fallback env sepenuhnya
  }

  const dbKey = decryptSecret(row?.apiKeyEnc ?? null) ?? ''
  const envKey = entry.envKey ? (process.env[entry.envKey] ?? '').trim() : ''

  const apiKey = dbKey || envKey
  const keySource: KeySource = dbKey ? 'db' : envKey ? 'env' : 'none'

  const envBase = entry.envBaseUrl ? (process.env[entry.envBaseUrl] ?? '').trim() : ''
  const baseUrl = (row?.baseUrl ?? '').trim() || envBase || entry.baseUrlDefault

  const modelEnvName =
    provider === 'local' ? 'OLLAMA_MODEL' : `${provider.toUpperCase()}_MODEL`
  const envModel = (process.env[modelEnvName] ?? '').trim()
  const model = (row?.model ?? '').trim() || envModel || entry.defaultModel
  const modelSource: ResolvedCredential['modelSource'] = (row?.model ?? '').trim()
    ? 'db'
    : envModel
      ? 'env'
      : 'default'

  return {
    provider,
    apiKey,
    keySource,
    keyMasked: apiKey ? maskKey(apiKey) : null,
    baseUrl,
    model,
    modelSource,
  }
}

/** Bentuk aman untuk dikirim ke client (tanpa plaintext key). */
export interface ProviderStatusClient {
  provider: AiProviderId
  name: string
  description: string
  defaultModel: string
  keyHint: string
  envKey: string | null
  baseUrlDefault: string
  style: AiCallStyle
  keylessSdk: boolean
  noKeyNeeded: boolean
  // status terpasang
  keySource: KeySource
  keyMasked: string | null
  baseUrl: string
  baseUrlSource: 'db' | 'env' | 'default'
  model: string
  modelSource: 'db' | 'env' | 'default'
  status: 'untested' | 'ok' | 'fail'
  lastError: string | null
  testedAt: string | null
  hasDbRow: boolean
}

/** Ambil status semua provider untuk GET /api/ai-providers. */
export async function listProviderStatus(
  descriptions: Record<AiProviderId, string>,
): Promise<ProviderStatusClient[]> {
  const ids = Object.keys(AI_PROVIDER_REGISTRY) as AiProviderId[]
  // Tahan bermacam kegagalan DB (client stale, migrasi belum di-push,
  // file terkunci): daftar provider tetap tampil dengan fallback env —
  // daripada seluruh halaman Settings mati dengan error 500.
  let rows: {
    provider: string
    apiKeyEnc: string | null
    baseUrl: string | null
    model: string | null
    status: string
    lastError: string | null
    testedAt: Date | null
  }[] = []
  try {
    rows = await listCredentialRows()
  } catch (e) {
    console.warn(
      '[ai-keys] Gagal baca AiProviderCredential (fallback env):',
      e instanceof Error ? e.message : e,
    )
  }
  const byProvider = new Map(rows.map((r) => [r.provider, r]))

  return Promise.all(
    ids.map(async (id) => {
      const entry = AI_PROVIDER_REGISTRY[id]
      const cred = await resolveCredential(id)
      const row = byProvider.get(id)
      return {
        provider: id,
        name: entry.name,
        description: descriptions[id] ?? '',
        defaultModel: entry.defaultModel,
        keyHint: entry.keyHint,
        envKey: entry.envKey,
        baseUrlDefault: entry.baseUrlDefault,
        style: entry.style,
        keylessSdk: entry.keylessSdk,
        noKeyNeeded: entry.noKeyNeeded,
        keySource: cred.keySource,
        keyMasked: cred.keyMasked,
        baseUrl: cred.baseUrl,
        baseUrlSource:
          (row?.baseUrl ?? '').trim() ? ('db' as const) : cred.baseUrl !== entry.baseUrlDefault ? ('env' as const) : ('default' as const),
        model: cred.model,
        modelSource: cred.modelSource,
        status: (row?.status as 'untested' | 'ok' | 'fail' | undefined) ?? 'untested',
        lastError: row?.lastError ?? null,
        testedAt: row?.testedAt ? row.testedAt.toISOString() : null,
        hasDbRow: !!row,
      }
    }),
  )
}
