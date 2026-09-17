/**
 * ai-llm.ts — Pemanggil LLM lintas provider (server-only, tanpa SDK vendor).
 *
 * Gaya API (mencerminkan python-engine/app/ai_providers.py):
 *  - openai : POST {baseUrl}{path}  Authorization: Bearer <key>
 *  - gemini : POST {baseUrl}/models/{model}:generateContent?key=<key>
 *  - ollama : POST {baseUrl}/api/chat  (native, tanpa key)
 *  - zai    : bila ada key manual → gaya openai ke api.z.ai;
 *             bila tanpa key → z-ai-web-dev-sdk (akses bawaan dashboard).
 *
 * Semua fungsi TIDAK melempar exception pada kegagalan jaringan/HTTP —
 * return null (atau {ok:false,...}) agar pemanggil dapat fallback ke model
 * lokal dengan aman.
 */

import 'server-only'
import ZAI from 'z-ai-web-dev-sdk'
import { upsertCredential } from '@/lib/ai-provider-credential-db'
import { AI_PROVIDER_REGISTRY, resolveCredential, type ResolvedCredential } from '@/lib/ai-keys'
import type { AiProviderId } from '@/lib/types'

interface LlmCallOptions {
  system: string
  user: string
  timeoutMs?: number
  /** Override kredensial hasil resolve (untuk test dengan key baru-belum-disimpan). */
  credOverride?: ResolvedCredential
}

function friendlyHttpError(status: number, provider: string): string {
  if (status === 401 || status === 403) {
    return `API key ${provider} ditolak (HTTP ${status}) — periksa ulang kunci, atau generate baru.`
  }
  if (status === 404) {
    return `Endpoint/model ${provider} tidak ditemukan (HTTP 404) — periksa Base URL & nama model.`
  }
  if (status === 429) {
    return `Rate limit ${provider} (HTTP 429) — coba lagi sebentar lagi atau turunkan frekuensi analisa.`
  }
  if (status >= 500) {
    return `Server ${provider} bermasalah (HTTP ${status}) — coba lagi nanti.`
  }
  return `HTTP ${status} dari ${provider}.`
}

/** Gaya OpenAI chat completions (zai/groq/openai/openrouter/tinyfish/tokenplus). */
async function callOpenAiStyle(
  cred: ResolvedCredential,
  opts: LlmCallOptions,
): Promise<{ text: string | null; error: string | null }> {
  const entry = AI_PROVIDER_REGISTRY[cred.provider]
  const url = `${cred.baseUrl.replace(/\/+$/, '')}${entry.path}`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000)
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.apiKey}`,
      },
      body: JSON.stringify({
        model: cred.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        temperature: 0.2,
        max_tokens: 1400,
      }),
    })
    clearTimeout(timer)
    if (!res.ok) {
      let detail = ''
      try {
        const j = (await res.json()) as { error?: { message?: string } | string }
        detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? '')
      } catch {
        /* body non-JSON — abaikan */
      }
      return { text: null, error: `${friendlyHttpError(res.status, entry.name)}${detail ? ` (${detail.slice(0, 180)})` : ''}` }
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) return { text: null, error: `Respons ${entry.name} kosong/malformed.` }
    return { text, error: null }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? `Timeout ${entry.name} (${Math.round((opts.timeoutMs ?? 60000) / 1000)}s).` : `Koneksi ke ${entry.name} gagal: ${e instanceof Error ? e.message : 'unknown'}`
    return { text: null, error: msg }
  }
}

/** Gaya Google Gemini REST (generateContent). */
async function callGeminiStyle(
  cred: ResolvedCredential,
  opts: LlmCallOptions,
): Promise<{ text: string | null; error: string | null }> {
  const base = cred.baseUrl.replace(/\/+$/, '')
  const url = `${base}/models/${encodeURIComponent(cred.model)}:generateContent?key=${encodeURIComponent(cred.apiKey)}`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000)
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
      }),
    })
    clearTimeout(timer)
    if (!res.ok) {
      let detail = ''
      try {
        const j = (await res.json()) as { error?: { message?: string } }
        detail = j.error?.message ?? ''
      } catch {
        /* abaikan */
      }
      return { text: null, error: `${friendlyHttpError(res.status, 'Google AI Studio')}${detail ? ` (${detail.slice(0, 180)})` : ''}` }
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) return { text: null, error: 'Respons Google AI Studio kosong/malformed.' }
    return { text, error: null }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Timeout Google AI Studio.' : `Koneksi ke Google AI Studio gagal: ${e instanceof Error ? e.message : 'unknown'}`
    return { text: null, error: msg }
  }
}

/** Gaya Ollama native (/api/chat, tanpa API key). */
async function callOllamaStyle(
  cred: ResolvedCredential,
  opts: LlmCallOptions,
): Promise<{ text: string | null; error: string | null }> {
  const url = `${cred.baseUrl.replace(/\/+$/, '')}/api/chat`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000)
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cred.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        stream: false,
        options: { temperature: 0.2 },
      }),
    })
    clearTimeout(timer)
    if (!res.ok) return { text: null, error: friendlyHttpError(res.status, 'Ollama') }
    const json = (await res.json()) as { message?: { content?: string } }
    const text = json.message?.content?.trim()
    if (!text) return { text: null, error: 'Respons Ollama kosong/malformed.' }
    return { text, error: null }
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'AbortError'
        ? 'Timeout Ollama (model lokal bisa lambat saat cold start).'
        : `Ollama tidak dapat dihubungi di ${cred.baseUrl} — pastikan \`ollama serve\` berjalan dan base URL benar.`
    return { text: null, error: msg }
  }
}

/** Z.AI via SDK bawaan dashboard (tanpa key manual). */
async function callZaiSdk(opts: LlmCallOptions): Promise<{ text: string | null; error: string | null }> {
  try {
    const zai = await ZAI.create()
    const completion = (await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      thinking: { type: 'disabled' },
    })) as { choices?: Array<{ message?: { content?: string } }> }
    const text = completion?.choices?.[0]?.message?.content?.trim()
    if (!text) return { text: null, error: 'Respons Z.AI SDK kosong.' }
    return { text, error: null }
  } catch (e) {
    return { text: null, error: `Z.AI SDK gagal: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

export interface LlmTextResult {
  text: string | null
  error: string | null
  /** kredensial efektif yang dipakai (untuk label provider). */
  cred: ResolvedCredential
  /** true bila lewat jalur keyless SDK dashboard. */
  viaSdk: boolean
}

/**
 * Panggil LLM provider apa pun → teks jawaban.
 * Tidak throw; kembalikan {text, error}.
 */
export async function callProviderLlm(
  provider: AiProviderId,
  opts: LlmCallOptions,
): Promise<LlmTextResult> {
  const cred = opts.credOverride ?? (await resolveCredential(provider))
  const entry = AI_PROVIDER_REGISTRY[provider]

  // Z.AI tanpa key manual → SDK bawaan
  if (provider === 'zai' && !cred.apiKey) {
    const r = await callZaiSdk(opts)
    return { ...r, cred, viaSdk: true }
  }

  // Provider berkunci tapi key belum ada
  if (!entry.noKeyNeeded && !cred.apiKey) {
    return {
      text: null,
      error: `API key ${entry.name} belum diatur — isi di Settings → API Key Provider, atau set ${entry.envKey} di .env.`,
      cred,
      viaSdk: false,
    }
  }

  switch (entry.style) {
    case 'gemini':
      return { ...(await callGeminiStyle(cred, opts)), cred, viaSdk: false }
    case 'ollama':
      return { ...(await callOllamaStyle(cred, opts)), cred, viaSdk: false }
    default:
      return { ...(await callOpenAiStyle(cred, opts)), cred, viaSdk: false }
  }
}

// ------------------------------------------------------------
// Test koneksi (Settings → tombol Test)
// ------------------------------------------------------------

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number
  model: string
  message: string
}

/** Ping ringan: minta LLM membalas "OK" saja. Update status di DB. */
export async function testProviderLlm(provider: AiProviderId): Promise<ProviderTestResult> {
  const entry = AI_PROVIDER_REGISTRY[provider]
  const startedAt = Date.now()
  const r = await callProviderLlm(provider, {
    system: 'You are a connectivity test endpoint. Reply with exactly: OK',
    user: 'Ping. Balas hanya dengan: OK',
    timeoutMs: 30_000,
  })
  const latencyMs = Date.now() - startedAt
  const ok = !!r.text

  // persist status (best-effort, jalur tangguh: model Prisma → raw SQL)
  try {
    await upsertCredential(provider, {
      status: ok ? 'ok' : 'fail',
      lastError: ok ? null : (r.error ?? 'unknown').slice(0, 500),
      testedAt: new Date(),
    })
  } catch {
    /* status test tidak kritis */
  }

  return {
    ok,
    latencyMs,
    model: r.cred.model,
    message: ok
      ? `${entry.name} merespons dalam ${latencyMs}ms (model ${r.cred.model}${r.viaSdk ? ', via SDK' : ''}).`
      : (r.error ?? 'Gagal tanpa pesan.'),
  }
}
