'use client'

import { useState } from 'react'
import { useApiQuery } from '@/hooks/use-api-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BrainCircuit, Save, Target, BarChart3, TrendingUp, CheckCircle2, XCircle, Sparkles, Wifi, WifiOff, Zap } from 'lucide-react'
import { toast } from 'sonner'

interface AiConfig {
  minConfidenceBuy: number
  minConfidenceSell: number
  technicalWeight: number
  newsWeight: number
  sentimentWeight: number
  maxPositionsPerDecision: number
  cooldownSeconds: number
  extremeSentimentBlock: boolean
  volatilityScalingEnabled: boolean
}

interface StrategyInfo {
  id: string
  name: string
  description: string
  timeframes: string[]
  minBars: number
  weight: number
}

interface AccuracyData {
  totalDecisions: number
  winRate: number
  avgConfidence: number
  avgPnlImpact: number
  confidenceCalibration: {
    low: { count: number; winRate: number }
    medium: { count: number; winRate: number }
    high: { count: number; winRate: number }
  }
}

interface LlmStatus {
  available: boolean
  activeProviders: string[]
  taskCoverage: Record<string, boolean>
}

const DEFAULT_CONFIG: AiConfig = {
  minConfidenceBuy: 65,
  minConfidenceSell: 65,
  technicalWeight: 50,
  newsWeight: 25,
  sentimentWeight: 25,
  maxPositionsPerDecision: 3,
  cooldownSeconds: 300,
  extremeSentimentBlock: true,
  volatilityScalingEnabled: true,
}

const PROVIDER_COLORS: Record<string, string> = {
  groq: 'bg-orange-500',
  openai: 'bg-emerald-600',
  together: 'bg-sky-600',
  tinyfish: 'bg-violet-500',
  local: 'bg-slate-600',
}

const PROVIDER_NAMES: Record<string, string> = {
  groq: 'Groq AI',
  openai: 'OpenAI',
  together: 'Together.ai',
  tinyfish: 'Tinyfish.ai',
  local: 'Ollama (Lokal)',
}

const TASK_LABELS: Record<string, string> = {
  market_analysis: 'Analisis Pasar',
  sentiment_analysis: 'Analisis Sentimen',
  news_summary: 'Ringkasan Berita',
  strategy_suggestion: 'Saran Strategi',
  risk_assessment: 'Penilaian Risiko',
}

export default function AiEnginePanel() {
  const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)

  // Two independent 30s polls through the centralised hook (was one
  // Promise.all inside fetchData): /api/ai/config carries the config merge +
  // strategies + accuracy; /api/ai/enhanced carries LLM provider status.
  // Abort/stale-guard/visibility-restart handled generically. The config
  // sync into local state runs in onJson — verbatim guard chain from the
  // hand-rolled fetch.
  const {
    data: engineData,
    loading: engineLoading,
    refresh: refreshEngine,
  } = useApiQuery<{ strategies: StrategyInfo[]; accuracy: AccuracyData | null }>({
    url: '/api/ai/config',
    intervalMs: 30_000,
    transform: (json) => {
      const d = (json as { data?: { strategies?: StrategyInfo[]; accuracy?: AccuracyData } }).data
      if (!d) return undefined
      return {
        strategies: d.strategies ?? [],
        accuracy: d.accuracy ?? null,
      }
    },
    onJson: (json) => {
      const cfg = (json as { data?: { config?: Partial<AiConfig> } }).data?.config
      if (!cfg) return
      setConfig(prev => ({
        ...prev,
        minConfidenceBuy: cfg.minConfidenceBuy ?? prev.minConfidenceBuy,
        minConfidenceSell: cfg.minConfidenceSell ?? prev.minConfidenceSell,
        technicalWeight: Math.round((cfg.technicalWeight ?? 0.5) * 100),
        newsWeight: Math.round((cfg.newsWeight ?? 0.25) * 100),
        sentimentWeight: Math.round((cfg.sentimentWeight ?? 0.25) * 100),
        maxPositionsPerDecision: cfg.maxPositionsPerDecision ?? 3,
        cooldownSeconds: cfg.cooldownSeconds ?? 300,
        extremeSentimentBlock: cfg.extremeSentimentBlock ?? true,
        volatilityScalingEnabled: cfg.volatilityScalingEnabled ?? true,
      }))
    },
  })

  const { data: llmData, loading: llmLoading } = useApiQuery<LlmStatus>({
    url: '/api/ai/enhanced',
    intervalMs: 30_000,
    transform: (json) => (json as { data?: LlmStatus | null }).data ?? undefined,
  })

  // Combined loading — true until BOTH endpoints settle (was one Promise.all).
  const loading = engineLoading || llmLoading
  const strategies = engineData?.strategies ?? []
  const accuracy = engineData?.accuracy ?? null
  const llmStatus = llmData ?? null

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minConfidenceBuy: config.minConfidenceBuy,
          minConfidenceSell: config.minConfidenceSell,
          technicalWeight: config.technicalWeight / 100,
          newsWeight: config.newsWeight / 100,
          sentimentWeight: config.sentimentWeight / 100,
          maxPositionsPerDecision: config.maxPositionsPerDecision,
          cooldownSeconds: config.cooldownSeconds,
          extremeSentimentBlock: config.extremeSentimentBlock,
          volatilityScalingEnabled: config.volatilityScalingEnabled,
        }),
      })
      if (res.ok) {
        toast.success('Konfigurasi AI berhasil disimpan')
        // Re-sync the engine payload so the saved config is reflected
        // immediately instead of waiting for the next 30s poll.
        void refreshEngine()
      } else {
        const json = await res.json().catch(() => ({}))
        toast.error(`Gagal menyimpan: ${json.error || 'Unknown error'}`)
      }
    } catch {
      toast.error('Gagal menyimpan konfigurasi')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-spin h-6 w-6 border-2 border-emerald-600 border-t-transparent rounded-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* LLM Provider Status Banner */}
      {llmStatus && (
        <Card className={llmStatus.available ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Status Provider LLM
              {llmStatus.available ? (
                <Badge className="ml-auto bg-emerald-600 text-white text-[10px] gap-1">
                  <Wifi className="h-3 w-3" />
                  {llmStatus.activeProviders.length} Aktif
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-auto text-[10px] gap-1">
                  <WifiOff className="h-3 w-3" />
                  Belum Dikonfigurasi
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Active Providers */}
            {llmStatus.available && (
              <div className="flex flex-wrap gap-2">
                {llmStatus.activeProviders.map(pid => (
                  <Badge key={pid} className="text-[10px] gap-1.5">
                    <div className={`h-2.5 w-2.5 rounded-full ${PROVIDER_COLORS[pid] || 'bg-gray-400'}`} />
                    {PROVIDER_NAMES[pid] || pid}
                  </Badge>
                ))}
              </div>
            )}

            {/* Task Coverage */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              {Object.entries(TASK_LABELS).map(([task, label]) => {
                const covered = llmStatus.taskCoverage[task]
                return (
                  <div
                    key={task}
                    className={
                      'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] border ' +
                      (covered
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-border text-muted-foreground')
                    }
                  >
                    {covered ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {label}
                  </div>
                )
              })}
            </div>

            {/* Info message when no providers configured */}
            {!llmStatus.available && (
              <p className="text-[11px] text-muted-foreground">
                Belum ada provider LLM yang aktif. Buka <strong>Provider AI</strong> di bawah untuk mengkonfigurasi Groq, OpenAI, Together.ai, Tinyfish.ai, atau Ollama lokal.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Konfigurasi AI */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-violet-500" />
            Konfigurasi AI Engine
            {llmStatus?.available && (
              <Badge variant="outline" className="ml-auto text-[10px] gap-1 text-violet-600 border-violet-300">
                <Zap className="h-3 w-3" />
                LLM Enhanced
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Confidence Thresholds */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Min. Confidence BUY</Label>
                <span className="text-xs font-mono font-bold text-emerald-600">{config.minConfidenceBuy}%</span>
              </div>
              <Slider
                value={[config.minConfidenceBuy]}
                onValueChange={([v]) => setConfig(p => ({ ...p, minConfidenceBuy: v }))}
                min={0} max={100} step={1}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Min. Confidence SELL</Label>
                <span className="text-xs font-mono font-bold text-red-600">{config.minConfidenceSell}%</span>
              </div>
              <Slider
                value={[config.minConfidenceSell]}
                onValueChange={([v]) => setConfig(p => ({ ...p, minConfidenceSell: v }))}
                min={0} max={100} step={1}
              />
            </div>
          </div>

          {/* Weight Distribution */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Distribusi Bobot Faktor</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs flex items-center gap-1"><BarChart3 className="h-3 w-3 text-blue-500" /> Teknikal</span>
                  <span className="text-xs font-mono font-bold">{config.technicalWeight}%</span>
                </div>
                <Progress value={config.technicalWeight} className="h-2" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs flex items-center gap-1"><Target className="h-3 w-3 text-amber-500" /> Berita</span>
                  <span className="text-xs font-mono font-bold">{config.newsWeight}%</span>
                </div>
                <Progress value={config.newsWeight} className="h-2" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs flex items-center gap-1"><TrendingUp className="h-3 w-3 text-violet-500" /> Sentimen</span>
                  <span className="text-xs font-mono font-bold">{config.sentimentWeight}%</span>
                </div>
                <Progress value={config.sentimentWeight} className="h-2" />
              </div>
            </div>
          </div>

          {/* Toggles and Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <Label className="text-xs">Block Sentimen Ekstrem</Label>
              <Switch
                checked={config.extremeSentimentBlock}
                onCheckedChange={v => setConfig(p => ({ ...p, extremeSentimentBlock: v }))}
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <Label className="text-xs">Scaling Volatilitas</Label>
              <Switch
                checked={config.volatilityScalingEnabled}
                onCheckedChange={v => setConfig(p => ({ ...p, volatilityScalingEnabled: v }))}
              />
            </div>
            <div className="space-y-1.5 p-3 rounded-lg border">
              <Label className="text-xs text-muted-foreground">Maks. Posisi/Keputusan</Label>
              <Select
                value={String(config.maxPositionsPerDecision)}
                onValueChange={v => setConfig(p => ({ ...p, maxPositionsPerDecision: Number(v) }))}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 p-3 rounded-lg border">
              <Label className="text-xs text-muted-foreground">Cooldown (detik)</Label>
              <Select
                value={String(config.cooldownSeconds)}
                onValueChange={v => setConfig(p => ({ ...p, cooldownSeconds: Number(v) }))}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[30, 60, 120, 180, 300, 600].map(n => (
                    <SelectItem key={n} value={String(n)} className="text-xs">{n}s</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
          </Button>
        </CardContent>
      </Card>

      {/* Daftar Strategi */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            Daftar Strategi
            <Badge variant="outline" className="text-[10px] ml-auto">{strategies.length} strategi</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {strategies.map(s => (
              <div key={s.id} className="p-3 rounded-lg border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{s.name}</span>
                  <Badge variant="outline" className="text-[10px]">{s.weight}x</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">{s.description}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>TF: {s.timeframes.join(', ')}</span>
                  <span>|</span>
                  <span>Min: {s.minBars} bar</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Akurasi AI */}
      {accuracy && (
        <Card>
          <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-500" />
            Akurasi AI
            <Badge variant="outline" className="text-[10px] ml-auto">30 hari terakhir</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Keputusan" value={accuracy.totalDecisions} />
            <StatCard
              label="Win Rate"
              value={`${(accuracy.winRate * 100).toFixed(1)}%`}
              color={accuracy.winRate >= 0.55 ? 'text-emerald-600' : accuracy.winRate >= 0.45 ? 'text-amber-600' : 'text-red-600'}
            />
            <StatCard label="Avg. Confidence" value={`${accuracy.avgConfidence}%`} />
            <StatCard
              label="Avg. PnL Impact"
              value={`${accuracy.avgPnlImpact > 0 ? '+' : ''}${accuracy.avgPnlImpact.toLocaleString()}`}
              color={accuracy.avgPnlImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}
            />
          </div>

          {/* Confidence Calibration */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Kalibrasi Confidence</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <CalibrationCard
                tier="Rendah (0-49%)"
                count={accuracy.confidenceCalibration.low.count}
                winRate={accuracy.confidenceCalibration.low.winRate}
              />
              <CalibrationCard
                tier="Sedang (50-69%)"
                count={accuracy.confidenceCalibration.medium.count}
                winRate={accuracy.confidenceCalibration.medium.winRate}
              />
              <CalibrationCard
                tier="Tinggi (70-100%)"
                count={accuracy.confidenceCalibration.high.count}
                winRate={accuracy.confidenceCalibration.high.winRate}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="p-3 rounded-lg border space-y-1">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${color ?? ''}`}>{value}</p>
    </div>
  )
}

function CalibrationCard({ tier, count, winRate }: { tier: string; count: number; winRate: number }) {
  const wrPct = winRate * 100
  return (
    <div className="p-3 rounded-lg border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium">{tier}</span>
        <span className="text-[10px] text-muted-foreground">{count} keputusan</span>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={wrPct} className={`h-2 ${count === 0 ? 'opacity-30' : ''}`} />
        <span className={`text-xs font-mono font-bold min-w-[3rem] text-right ${wrPct >= 55 ? 'text-emerald-600' : wrPct >= 45 ? 'text-amber-600' : 'text-red-600'}`}>
          {count > 0 ? `${wrPct.toFixed(0)}%` : '-'}
        </span>
      </div>
    </div>
  )
}
