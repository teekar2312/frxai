'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BrainCircuit, Save, Target, BarChart3, TrendingUp, CheckCircle2, XCircle } from 'lucide-react'
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

export default function AiEnginePanel() {
  const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG)
  const [strategies, setStrategies] = useState<StrategyInfo[]>([])
  const [accuracy, setAccuracy] = useState<AccuracyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/config')
      if (res.ok) {
        const json = await res.json()
        if (json.data) {
          setConfig(prev => ({
            ...prev,
            minConfidenceBuy: json.data.config.minConfidenceBuy ?? prev.minConfidenceBuy,
            minConfidenceSell: json.data.config.minConfidenceSell ?? prev.minConfidenceSell,
            technicalWeight: Math.round((json.data.config.technicalWeight ?? 0.5) * 100),
            newsWeight: Math.round((json.data.config.newsWeight ?? 0.25) * 100),
            sentimentWeight: Math.round((json.data.config.sentimentWeight ?? 0.25) * 100),
            maxPositionsPerDecision: json.data.config.maxPositionsPerDecision ?? 3,
            cooldownSeconds: json.data.config.cooldownSeconds ?? 300,
            extremeSentimentBlock: json.data.config.extremeSentimentBlock ?? true,
            volatilityScalingEnabled: json.data.config.volatilityScalingEnabled ?? true,
          }))
          setStrategies(json.data.strategies ?? [])
          setAccuracy(json.data.accuracy ?? null)
        }
      }
    } catch {
      // use stale
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

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
      {/* Konfigurasi AI */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-violet-500" />
            Konfigurasi AI Engine
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
  const color = wrPct >= 55 ? 'bg-emerald-500' : wrPct >= 45 ? 'bg-amber-500' : 'bg-red-500'
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
