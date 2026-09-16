'use client'

/**
 * ai-provider-keys.tsx — Kartu manajemen API key AI provider (Settings).
 *
 * Sumber kunci: input manual di sini (disimpan terenkripsi di DB) →
 * fallback env var. Key TIDAK PERNAH dikirim utuh kembali ke client —
 * hanya versi masked (sk-…abc4).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  ChevronDown,
  CloudUpload,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiPost, apiPut } from '@/hooks/use-polling'
import { cn } from '@/lib/utils'
import type { AiProviderId } from '@/lib/types'
import type { ProviderStatusClient } from '@/lib/ai-keys'

/** Hasil sinkronisasi kunci ke engine (dari route /api/ai-providers). */
interface EngineSyncInfo {
  ok: boolean
  reason?: 'demo-mode' | 'no-keys' | 'bad-url' | 'unreachable' | 'http-error'
  detail?: string
  engineUrl?: string
  count?: number
  applied?: string[]
}

/** Ringkasan ramah untuk hasil sync (dipakai inline & toast). */
function syncMessage(s: EngineSyncInfo): string {
  if (s.ok) {
    if ((s.count ?? 0) === 0) return s.detail ?? 'Override engine dikosongkan.'
    return `Tersinkron ke engine — ${(s.applied ?? []).length} provider: ${(s.applied ?? []).join(', ')}`
  }
  switch (s.reason) {
    case 'demo-mode':
      return 'Mode engine DEMO — kunci hanya dipakai dashboard. Aktifkan LIVE di tab Engine untuk meneruskan.'
    case 'no-keys':
      return 'Tidak ada kunci/override untuk diteruskan — isi API key terlebih dahulu.'
    case 'bad-url':
      return 'Engine URL tidak valid — periksa pengaturan tab Engine.'
    case 'unreachable':
      return 'Engine tidak terjangkau — periksa engineUrl dan pastikan engine berjalan.'
    case 'http-error':
      return s.detail ?? 'Engine menolak sinkronisasi.'
    default:
      return s.detail ?? 'Sinkronisasi gagal.'
  }
}

// ------------------------------------------------------------
// Status badge per provider
// ------------------------------------------------------------

function KeyStatusBadge({ p }: { p: ProviderStatusClient }) {
  if (p.keySource === 'db') {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
        <KeyRound className="h-2.5 w-2.5" /> Key tersimpan · {p.keyMasked}
      </Badge>
    )
  }
  if (p.keySource === 'env') {
    return (
      <Badge variant="outline" className="gap-1 border-sky-500/40 bg-sky-500/10 px-1.5 text-[9px] font-semibold text-sky-600 dark:text-sky-400">
        ENV · {p.keyMasked}
      </Badge>
    )
  }
  if (p.keylessSdk) {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
        SDK bawaan
      </Badge>
    )
  }
  if (p.noKeyNeeded) {
    return (
      <Badge variant="outline" className="gap-1 border-zinc-500/30 px-1.5 text-[9px] font-semibold text-muted-foreground">
        Tanpa key (Ollama)
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
      Belum diatur
    </Badge>
  )
}

function TestStateBadge({ p }: { p: ProviderStatusClient }) {
  if (p.status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" /> Test OK
      </span>
    )
  }
  if (p.status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-red-500" title={p.lastError ?? undefined}>
        <X className="h-3 w-3" /> Test gagal
      </span>
    )
  }
  return <span className="text-[9px] text-muted-foreground/70">belum di-test</span>
}

// ------------------------------------------------------------
// Main card
// ------------------------------------------------------------

export default function AiProviderKeysCard() {
  const [providers, setProviders] = useState<ProviderStatusClient[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<AiProviderId | null>(null)

  // form state (hanya untuk provider yang sedang dibuka)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncInfo, setSyncInfo] = useState<{ at: number; s: EngineSyncInfo } | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/ai-providers')
      const json = (await res.json()) as { providers?: ProviderStatusClient[]; error?: string }
      if (!res.ok || !json.providers) throw new Error(json.error || `HTTP ${res.status}`)
      setProviders(json.providers)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat status provider')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = (p: ProviderStatusClient) => {
    if (expanded === p.provider) {
      setExpanded(null)
      return
    }
    setExpanded(p.provider)
    setApiKey('')
    setShowKey(false)
    // pre-isi override yang sudah tersimpan (bukan hasil env/default)
    setBaseUrl(p.baseUrlSource === 'db' ? p.baseUrl : '')
    setModel(p.modelSource === 'db' ? p.model : '')
  }

  const save = async (p: ProviderStatusClient) => {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, string> = { provider: p.provider }
      // apiKey: hanya kirim bila user mengetik (string kosong eksplisit = hapus)
      if (apiKey.trim() !== '') body.apiKey = apiKey.trim()
      if (baseUrl !== '' || p.baseUrlSource === 'db') body.baseUrl = baseUrl.trim()
      if (model !== '' || p.modelSource === 'db') body.model = model.trim()
      const res = await apiPut<{ providers: ProviderStatusClient[]; engineSync?: EngineSyncInfo }>('/api/ai-providers', body)
      setProviders(res.providers)
      setApiKey('')
      if (res.engineSync) setSyncInfo({ at: Date.now(), s: res.engineSync })
      toast.success(`Kredensial ${p.name} disimpan`, {
        description: res.engineSync?.ok
          ? 'Terenkripsi AES-256-GCM · diteruskan ke engine (mode LIVE)'
          : 'Terenkripsi AES-256-GCM di database · analisa berikutnya memakai kunci ini',
      })
    } catch (e) {
      toast.error(`Gagal menyimpan ${p.name}`, { description: e instanceof Error ? e.message : 'unknown' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: ProviderStatusClient) => {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/ai-providers?provider=${p.provider}`, { method: 'DELETE' })
      const json = (await res.json()) as { providers?: ProviderStatusClient[]; engineSync?: EngineSyncInfo; error?: string }
      if (!res.ok || !json.providers) throw new Error(json.error || `HTTP ${res.status}`)
      setProviders(json.providers)
      setApiKey('')
      if (json.engineSync) setSyncInfo({ at: Date.now(), s: json.engineSync })
      toast.success(`Kredensial ${p.name} dihapus`, { description: 'Kembali ke fallback environment variable.' })
    } catch (e) {
      toast.error(`Gagal menghapus ${p.name}`, { description: e instanceof Error ? e.message : 'unknown' })
    } finally {
      setDeleting(false)
    }
  }

  const syncEngine = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await apiPost<{ engineSync: EngineSyncInfo; providers: ProviderStatusClient[] }>(
        '/api/ai-providers',
        { action: 'sync-engine' },
      )
      setProviders(res.providers)
      setSyncInfo({ at: Date.now(), s: res.engineSync })
      if (res.engineSync.ok) {
        toast.success('Kunci AI tersinkron ke engine', { description: syncMessage(res.engineSync) })
      } else {
        toast.warning('Sinkronisasi ke engine tidak berjalan', { description: syncMessage(res.engineSync) })
      }
    } catch (e) {
      toast.error('Gagal sinkron ke engine', { description: e instanceof Error ? e.message : 'unknown' })
    } finally {
      setSyncing(false)
    }
  }

  const test = async (p: ProviderStatusClient) => {
    if (testing) return
    setTesting(true)
    try {
      const res = await apiPost<{ result: { ok: boolean; message: string; latencyMs: number }; providers: ProviderStatusClient[] }>(
        '/api/ai-providers',
        { provider: p.provider },
      )
      setProviders(res.providers)
      if (res.result.ok) {
        toast.success(`Test ${p.name} berhasil`, { description: res.result.message })
      } else {
        toast.error(`Test ${p.name} gagal`, { description: res.result.message })
      }
    } catch (e) {
      toast.error(`Gagal test ${p.name}`, { description: e instanceof Error ? e.message : 'unknown' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
            <KeyRound className="h-4 w-4 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-xs font-bold">API Key Provider AI</h3>
            <p className="text-[10px] text-muted-foreground">
              Input manual per provider — tersimpan terenkripsi (AES-256-GCM) · fallback env var bila kosong
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[10px]"
            onClick={() => void syncEngine()}
            disabled={syncing}
            title="Teruskan semua kunci/override tersimpan ke Python engine (mode LIVE)"
          >
            {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudUpload className="h-3 w-3" />}
            Sync ke Engine
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[10px]"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {syncInfo ? (
        <div
          className={cn(
            'mb-2.5 flex items-start gap-1.5 rounded-lg border p-2 text-[10px] leading-relaxed',
            syncInfo.s.ok
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
          )}
          role="status"
        >
          {syncInfo.s.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <X className="mt-0.5 h-3 w-3 shrink-0" />}
          <span>
            <span className="font-semibold">Engine sync:</span> {syncMessage(syncInfo.s)}
            {syncInfo.s.engineUrl ? <span className="font-mono"> ({syncInfo.s.engineUrl})</span> : null}
            <span className="text-muted-foreground/70"> · {new Date(syncInfo.at).toLocaleTimeString()}</span>
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-[11px] text-red-600 dark:text-red-400">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            coba lagi
          </button>
        </div>
      ) : null}

      {loading && !providers ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {(providers ?? []).map((p) => {
            const isOpen = expanded === p.provider
            return (
              <div key={p.provider} className={cn('rounded-lg border transition-colors', isOpen ? 'border-emerald-500/50' : 'border-border')}>
                {/* --- row header --- */}
                <button
                  type="button"
                  onClick={() => open(p)}
                  aria-expanded={isOpen}
                  aria-label={`Atur API key ${p.name}`}
                  className="flex w-full items-center gap-2 rounded-lg p-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold">{p.name}</span>
                      <span className="num rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{p.model}</span>
                      {p.keySource !== 'none' && p.modelSource === 'env' ? (
                        <span className="text-[8px] text-muted-foreground/70">(model via env)</span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <KeyStatusBadge p={p} />
                      <TestStateBadge p={p} />
                    </div>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>

                {/* --- expanded editor --- */}
                {isOpen ? (
                  <div className="space-y-3 border-t border-border/70 p-2.5 pt-3">
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {p.keyHint}
                      {p.envKey ? (
                        <>
                          {' '}
                          Alternatif tanpa input manual: set <code className="rounded bg-muted px-1">{p.envKey}</code> di{' '}
                          <code className="rounded bg-muted px-1">.env</code>.
                        </>
                      ) : null}
                    </p>

                    {!p.noKeyNeeded ? (
                      <div className="space-y-1">
                        <Label htmlFor={`key-${p.provider}`} className="text-[10px] font-semibold text-muted-foreground">
                          API Key{' '}
                          {p.keyMasked ? (
                            <span className="font-normal text-muted-foreground/70">
                              (aktif: {p.keyMasked} · via {p.keySource === 'db' ? 'input manual' : 'env'})
                            </span>
                          ) : null}
                        </Label>
                        <div className="relative">
                          <Input
                            id={`key-${p.provider}`}
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={p.keylessSdk && p.keySource === 'none' ? 'Opsional — tanpa key, dashboard pakai SDK bawaan' : 'Tempel API key di sini…'}
                            className="h-8 pr-9 font-mono text-[11px]"
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey((v) => !v)}
                            aria-label={showKey ? 'Sembunyikan key' : 'Tampilkan key'}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                          >
                            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <p className="text-[9px] text-muted-foreground/70">
                          Kosongkan + Simpan tanpa mengisi = hapus key tersimpan
                        </p>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`url-${p.provider}`} className="text-[10px] font-semibold text-muted-foreground">
                          Base URL <span className="font-normal text-muted-foreground/60">(opsional)</span>
                        </Label>
                        <Input
                          id={`url-${p.provider}`}
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder={p.baseUrlDefault}
                          className="h-8 font-mono text-[10px]"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`model-${p.provider}`} className="text-[10px] font-semibold text-muted-foreground">
                          Model <span className="font-normal text-muted-foreground/60">(opsional)</span>
                        </Label>
                        <Input
                          id={`model-${p.provider}`}
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder={p.defaultModel}
                          className="h-8 font-mono text-[10px]"
                          spellCheck={false}
                        />
                      </div>
                    </div>

                    {p.status === 'fail' && p.lastError ? (
                      <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-[10px] leading-relaxed text-red-600 dark:text-red-400">
                        Kesalahan test terakhir: {p.lastError}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 bg-emerald-600 text-[11px] font-bold text-white hover:bg-emerald-600/90"
                        disabled={saving || (apiKey.trim() === '' && baseUrl.trim() === '' && model.trim() === '' && !(p.keyMasked && p.keySource === 'db'))}
                        onClick={() => void save(p)}
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Simpan
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-[11px]"
                        disabled={testing}
                        onClick={() => void test(p)}
                      >
                        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                        Test koneksi
                      </Button>
                      {p.hasDbRow ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-[11px] text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                          disabled={deleting}
                          onClick={() => void remove(p)}
                        >
                          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Hapus
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          <p className="pt-1 text-[9px] leading-relaxed text-muted-foreground/70">
            Saat mode engine <span className="font-semibold">LIVE</span>, kunci &amp; override di sini otomatis diteruskan ke Python engine
            (runtime override di memori — prioritas di atas <code className="rounded bg-muted px-1">python-engine/.env</code>, dilindungi
            X-Engine-Key). Engine restart? Tekan <span className="font-semibold">Sync ke Engine</span> (auto-resync juga berjalan tiap 5
            menit saat engine terjangkau). Saat mode DEMO, kunci hanya dipakai analisa dashboard.
          </p>
        </div>
      )}
    </div>
  )
}
