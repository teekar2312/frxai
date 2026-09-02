'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  BrainCircuit,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
  Zap,
  ExternalLink,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Shield,
  MessageSquare,
  Newspaper,
  BarChart3,
  Clock,
  Wifi,
} from 'lucide-react'
import { toast } from 'sonner'

// ---- Types ----

interface ModelInfo {
  id: string
  name: string
  maxTokens: number
  supportsVision: boolean
  contextWindow: number
}

interface ProviderConfig {
  id?: string
  enabled: boolean
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
  systemPrompt: string
  roles: string[]
  priority: number
  timeoutMs: number
  lastTestedAt: string | null
  lastTestResult: 'success' | 'failure' | null
  lastLatencyMs: number | null
}

interface ProviderMeta {
  id: string
  name: string
  description: string
  website: string
  defaultModel: string
  defaultBaseUrl: string
  models: ModelInfo[]
  supportsStreaming: boolean
  supportsVision: boolean
  maxContextTokens: number
  iconColor: string
  config: ProviderConfig | null
}

// ---- Helpers ----

const ROLE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  analysis: { label: 'Analisis', icon: <BarChart3 className="h-3 w-3" />, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  sentiment: { label: 'Sentimen', icon: <MessageSquare className="h-3 w-3" />, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  news_summary: { label: 'Ringkasan Berita', icon: <Newspaper className="h-3 w-3" />, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
}

const ALL_ROLES = ['analysis', 'sentiment', 'news_summary']

function formatTimeAgo(iso: string | null): string {
  if (!iso) return 'Belum diuji'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'Baru saja'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} menit lalu`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} jam lalu`
  return `${Math.floor(diff / 86400000)} hari lalu`
}

// ---- Component ----

export default function AiProviderSettings() {
  const [providers, setProviders] = useState<ProviderMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  // Local editing state per provider
  const [editState, setEditState] = useState<Record<string, ProviderConfig>>({})

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/providers')
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data) {
          setProviders(json.data)
          // Initialize edit state for each provider with their current config
          const edits: Record<string, ProviderConfig> = {}
          for (const p of json.data) {
            if (p.config) {
              edits[p.id] = { ...p.config }
            }
          }
          setEditState(edits)
        }
      }
    } catch {
      // use stale
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const handleToggle = async (providerId: string, enabled: boolean) => {
    try {
      await fetch('/api/ai/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', provider: providerId, enabled }),
      })
      setProviders(prev =>
        prev.map(p =>
          p.id === providerId
            ? { ...p, config: p.config ? { ...p.config, enabled } : null }
            : p,
        ),
      )
      toast.success(`${enabled ? 'Aktifkan' : 'Nonaktifkan'} ${providers.find(p => p.id === providerId)?.name}`)
    } catch {
      toast.error('Gagal mengubah status provider')
    }
  }

  const handleTest = async (providerId: string) => {
    setTestingId(providerId)
    try {
      const res = await fetch('/api/ai/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.success) {
          const data = json.data
          if (data.success) {
            toast.success(`${data.model} — ${data.latencyMs}ms`, {
              description: 'Koneksi berhasil',
            })
          } else {
            toast.error(`Gagal: ${data.error || 'Unknown error'}`, {
              description: `${data.latencyMs}ms`,
            })
          }
          // Refresh to get updated test results
          fetchProviders()
        }
      }
    } catch {
      toast.error('Gagal menguji provider')
    } finally {
      setTestingId(null)
    }
  }

  const handleSave = async (providerId: string) => {
    const edits = editState[providerId]
    if (!edits) return

    setSavingId(providerId)
    try {
      const res = await fetch('/api/ai/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, ...edits }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.success) {
          toast.success('Konfigurasi tersimpan')
          fetchProviders()
        } else {
          toast.error(json.error || 'Gagal menyimpan')
        }
      }
    } catch {
      toast.error('Gagal menyimpan konfigurasi')
    } finally {
      setSavingId(null)
    }
  }

  const updateEdit = (providerId: string, key: string, value: unknown) => {
    setEditState(prev => ({
      ...prev,
      [providerId]: { ...prev[providerId], [key]: value } as ProviderConfig,
    }))
  }

  const toggleRole = (providerId: string, role: string) => {
    const current = editState[providerId]?.roles || []
    const updated = current.includes(role)
      ? current.filter(r => r !== role)
      : [...current, role]
    updateEdit(providerId, 'roles', updated)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-3 text-sm text-muted-foreground">Memuat konfigurasi AI...</span>
        </CardContent>
      </Card>
    )
  }

  const enabledCount = providers.filter(p => p.config?.enabled).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <BrainCircuit className="h-4 w-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Provider AI</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Kelola provider LLM untuk analisis — {enabledCount} aktif dari {providers.length}
              </CardDescription>
            </div>
          </div>
          <Badge variant={enabledCount > 0 ? 'default' : 'outline'} className={enabledCount > 0 ? 'bg-emerald-600' : ''}>
            {enabledCount > 0 ? `${enabledCount} Aktif` : 'Belum Ada Aktif'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {providers.map((provider) => {
          const config = provider.config
          const isExpanded = expandedId === provider.id
          const edits = editState[provider.id]

          return (
            <div
              key={provider.id}
              className={
                'rounded-lg border transition-colors ' +
                (config?.enabled
                  ? 'border-emerald-300 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/20'
                  : 'border-border')
              }
            >
              {/* Provider Header Row */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : provider.id)}
              >
                {/* Color dot */}
                <div className={
                  'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ' +
                  (config?.enabled ? provider.iconColor + ' text-white' : 'bg-muted text-muted-foreground')
                }>
                  <BrainCircuit className="h-4 w-4" />
                </div>

                {/* Name & description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{provider.name}</span>
                    {config?.enabled && (
                      <Badge variant="default" className="h-5 text-[10px] bg-emerald-600">
                        Aktif
                      </Badge>
                    )}
                    {config?.lastTestResult === 'success' && (
                      <Tooltip>
                        <TooltipTrigger>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Terakhir diuji: {formatTimeAgo(config.lastTestedAt)}</p>
                          {config.lastLatencyMs && <p>Latensi: {config.lastLatencyMs}ms</p>}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {config?.lastTestResult === 'failure' && (
                      <Tooltip>
                        <TooltipTrigger>
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Uji terakhir gagal: {formatTimeAgo(config.lastTestedAt)}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{provider.description}</p>
                </div>

                {/* Status badges */}
                <div className="hidden md:flex items-center gap-1.5">
                  {config?.roles?.map(role => {
                    const rl = ROLE_LABELS[role]
                    if (!rl) return null
                    return (
                      <Badge key={role} variant="outline" className={
                        'h-5 text-[10px] gap-1 ' + rl.color
                      }>
                        {rl.icon}
                        {rl.label}
                      </Badge>
                    )
                  })}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={config?.enabled || false}
                    onCheckedChange={(checked) => {
                      handleToggle(provider.id, checked)
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {/* Expanded Settings */}
              {isExpanded && (
                <div className="border-t px-4 py-4 space-y-4 bg-muted/30">
                  {/* API Key */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">API Key</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showKeys[provider.id] ? 'text' : 'password'}
                            placeholder={
                              provider.id === 'local'
                                ? 'Tidak diperlukan untuk Ollama'
                                : 'Masukkan API key...'
                            }
                            value={edits?.apiKey || ''}
                            onChange={(e) => updateEdit(provider.id, 'apiKey', e.target.value)}
                            className="h-8 text-xs pr-9"
                          />
                          <button
                            type="button"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                          >
                            {showKeys[provider.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Base URL</Label>
                      <Input
                        value={edits?.baseUrl || ''}
                        onChange={(e) => updateEdit(provider.id, 'baseUrl', e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  {/* Model & Parameters */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Model</Label>
                      <Select
                        value={edits?.model || ''}
                        onValueChange={(v) => updateEdit(provider.id, 'model', v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Pilih model..." />
                        </SelectTrigger>
                        <SelectContent>
                          {provider.models.map(m => (
                            <SelectItem key={m.id} value={m.id} className="text-xs">
                              <div className="flex items-center justify-between w-full gap-4">
                                <span className="truncate">{m.name}</span>
                                <span className="text-muted-foreground text-[10px] shrink-0">
                                  {m.contextWindow >= 1000 ? `${Math.round(m.contextWindow / 1000)}k` : m.contextWindow} ctx
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Temperature: {edits?.temperature?.toFixed(1) || '0.3'}</Label>
                      <Slider
                        value={[edits?.temperature ?? 0.3]}
                        onValueChange={([v]) => updateEdit(provider.id, 'temperature', v)}
                        min={0}
                        max={2}
                        step={0.1}
                        className="py-1.5"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Max Tokens: {edits?.maxTokens || 4096}</Label>
                      <Slider
                        value={[edits?.maxTokens ?? 4096]}
                        onValueChange={([v]) => updateEdit(provider.id, 'maxTokens', v)}
                        min={256}
                        max={16384}
                        step={256}
                        className="py-1.5"
                      />
                    </div>
                  </div>

                  {/* Roles */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Peran Analisis</Label>
                    <div className="flex flex-wrap gap-2">
                      {ALL_ROLES.map(role => {
                        const rl = ROLE_LABELS[role]
                        if (!rl) return null
                        const isActive = edits?.roles?.includes(role)
                        return (
                          <button
                            key={role}
                            type="button"
                            className={
                              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors ' +
                              (isActive
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/50')
                            }
                            onClick={() => toggleRole(provider.id, role)}
                          >
                            {rl.icon}
                            {rl.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Priority & Timeout */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Prioritas Fallback: {edits?.priority || 10}</Label>
                      <Slider
                        value={[edits?.priority ?? 10]}
                        onValueChange={([v]) => updateEdit(provider.id, 'priority', v)}
                        min={1}
                        max={20}
                        step={1}
                        className="py-1.5"
                      />
                      <p className="text-[10px] text-muted-foreground">Semakin rendah = semakin diprioritaskan</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Timeout (detik): {Math.round((edits?.timeoutMs || 60000) / 1000)}s</Label>
                      <Slider
                        value={[edits?.timeoutMs ?? 60000]}
                        onValueChange={([v]) => updateEdit(provider.id, 'timeoutMs', v)}
                        min={5000}
                        max={180000}
                        step={5000}
                        className="py-1.5"
                      />
                    </div>
                  </div>

                  {/* System Prompt */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">System Prompt</Label>
                    <Textarea
                      value={edits?.systemPrompt || ''}
                      onChange={(e) => updateEdit(provider.id, 'systemPrompt', e.target.value)}
                      rows={3}
                      className="text-xs resize-y"
                    />
                  </div>

                  {/* Action Buttons */}
                  <Separator />
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {config?.lastTestedAt && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Terakhir diuji: {formatTimeAgo(config.lastTestedAt)}
                          {config.lastLatencyMs != null && ` • ${config.lastLatencyMs}ms`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={provider.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        {provider.website.replace('https://', '')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1.5"
                        onClick={() => handleTest(provider.id)}
                        disabled={testingId === provider.id || !config?.enabled}
                      >
                        {testingId === provider.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wifi className="h-3 w-3" />
                        )}
                        Tes Koneksi
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={() => handleSave(provider.id)}
                        disabled={savingId === provider.id}
                      >
                        {savingId === provider.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Settings className="h-3 w-3" />
                        )}
                        Simpan
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
