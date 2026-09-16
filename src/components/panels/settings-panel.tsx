'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronsUp,
  Clock,
  Coins,
  Cpu,
  Hand,
  Loader2,
  Mail,
  RotateCcw,
  Save,
  Server,
  Shield,
  Timer,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { SectionTitle, LiveDot } from '@/components/shared/primitives'
import AiProviderKeysCard from '@/components/panels/ai-provider-keys'
import { usePolling, apiPut, apiPost, fmtMoney } from '@/hooks/use-polling'
import { useAppStore } from '@/lib/store'
import {
  AI_PROVIDERS,
  BROKER_PROFILE,
  EVENTS_NOTIF,
  INDICATORS,
  INDICATOR_CATEGORIES,
  PAIRS,
  RISK_LIMITS,
  SESSIONS,
  TIMEFRAMES,
  getIndicatorConfig,
  isSessionActive,
} from '@/lib/constants'
import type { EnginePollResponse, SelectionMode, SettingsData } from '@/lib/types'
import { cn } from '@/lib/utils'

// ============================================================
// SETTINGS PANEL — full system configuration
// Every selection dimension: Manual (chips) | AI Auto (engine decides)
// ============================================================

/** Client-only ticking clock (avoids SSR mismatch). */
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const tick = () => setNow(new Date())
    const t0 = setTimeout(tick, 0)
    const t = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(t0)
      clearInterval(t)
    }
  }, [intervalMs])
  return now
}

function toggleId<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

// ------------------------------------------------------------
// Small building blocks
// ------------------------------------------------------------

function ModeSwitch({ mode, onChange }: { mode: SelectionMode; onChange: (m: SelectionMode) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'text-[10px] font-semibold uppercase tracking-wider',
          mode === 'manual' ? 'text-foreground' : 'text-muted-foreground/60'
        )}
      >
        Manual
      </span>
      <Switch checked={mode === 'ai'} onCheckedChange={(v) => onChange(v ? 'ai' : 'manual')} aria-label="AI Auto" />
      <span
        className={cn(
          'flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider',
          mode === 'ai' ? 'text-emerald-500' : 'text-muted-foreground/60'
        )}
      >
        {mode === 'ai' ? <Bot className="h-3 w-3" /> : null}
        AI Auto
      </span>
    </div>
  )
}

function ModeCard({
  title,
  icon,
  mode,
  onMode,
  badge,
  children,
}: {
  title: string
  icon?: ReactNode
  mode?: SelectionMode
  onMode?: (m: SelectionMode) => void
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="h-full p-3">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {icon ? <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span> : null}
          {title}
          {badge}
        </h3>
        {mode && onMode ? <ModeSwitch mode={mode} onChange={onMode} /> : null}
      </div>
      {children}
    </Card>
  )
}

function Chip({
  active,
  compact,
  onClick,
  children,
  title,
  ariaLabel,
}: {
  active: boolean
  compact?: boolean
  onClick: () => void
  children: ReactNode
  title?: string
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'rounded-md border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50',
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1.5 text-[11px]',
        active
          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'border-border bg-card text-muted-foreground hover:border-emerald-500/40 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

/** Shown when a dimension is set to AI mode. */
function AiInfoPreview({ values, note }: { values: string[]; note?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Bot className="h-3.5 w-3.5 text-emerald-500" />
        Dipilih otomatis oleh AI
      </p>
      {note ? <p className="text-[10px] leading-tight text-muted-foreground/80">{note}</p> : null}
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1 opacity-50">
          {values.map((v) => (
            <span
              key={v}
              className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {v}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ModeOption({
  selected,
  onClick,
  title,
  desc,
  icon,
  ariaLabel,
}: {
  selected: boolean
  onClick: () => void
  title: string
  desc: string
  icon?: ReactNode
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={cn(
        'rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
        selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-border hover:border-emerald-500/50 hover:bg-emerald-500/5'
      )}
    >
      <span className="flex items-center gap-1.5">
        {icon ? <span className="[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-emerald-500">{icon}</span> : null}
        <span className="text-xs font-bold">{title}</span>
      </span>
      <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">{desc}</span>
    </button>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  badge,
  note,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display: ReactNode
  badge?: ReactNode
  note?: ReactNode
  disabled?: boolean
}) {
  return (
    <div className={cn('space-y-1.5', disabled && 'pointer-events-none opacity-50')}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <span className="flex items-center gap-2">
          {badge}
          <span className="num text-xs font-semibold tabular-nums">{display}</span>
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
        className="[&_[data-slot=slider-range]]:bg-emerald-500 [&_[data-slot=slider-thumb]]:border-emerald-500"
      />
      {note ? <p className="text-[9px] leading-tight text-muted-foreground">{note}</p> : null}
    </div>
  )
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

export default function SettingsPanel() {
  const { data: settings, refresh: refreshSettings } = usePolling<SettingsData>('/api/settings', 15000)
  const { data: engine } = usePolling<EnginePollResponse>('/api/engine', 5000)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)

  // local editable copy — synced from poll while no dirty edits
  const [draft, setDraft] = useState<SettingsData | null>(null)
  const dirtyRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const now = useNow(30000)

  useEffect(() => {
    if (settings && !dirtyRef.current) setDraft(settings)
  }, [settings])

  // resume auto-sync once the local copy matches the server again
  useEffect(() => {
    if (settings && draft && JSON.stringify(draft) === JSON.stringify(settings)) dirtyRef.current = false
  }, [settings, draft])

  const patch = useCallback((p: Partial<SettingsData>) => {
    dirtyRef.current = true
    setDraft((d) => (d ? { ...d, ...p } : d))
  }, [])

  const patchSelection = useCallback(
    (key: 'pairs' | 'sessions' | 'timeframes' | 'indicators', next: string[], minLabel: string) => {
      if (next.length === 0) {
        toast.error(`Minimal 1 ${minLabel} harus dipilih`)
        return
      }
      patch({ [key]: next } as unknown as Partial<SettingsData>)
    },
    [patch]
  )

  const dirty = !!draft && !!settings && JSON.stringify(draft) !== JSON.stringify(settings)
  const equity = engine?.account.equity ?? 0

  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const res = await apiPut<SettingsData>('/api/settings', draft)
      dirtyRef.current = false
      setDraft(res)
      toast.success('Settings disimpan', {
        description: `Mode ${res.tradingMode} · ${res.pairs.length} pair · ${res.timeframes.length} timeframe · ${res.indicators.length} indikator`,
      })
      bumpRefresh()
      await refreshSettings()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan settings')
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    if (settings) {
      dirtyRef.current = false
      setDraft(settings)
      toast.info('Perubahan lokal dibatalkan')
    }
  }

  const sendTest = async () => {
    if (testing) return
    setTesting(true)
    try {
      const res = await apiPost<{ success: boolean; note: string }>('/api/notify', { action: 'test' })
      toast.success('Email test dikirim', { description: res.note })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengirim test notification')
    } finally {
      setTesting(false)
    }
  }

  const setIndicatorGroup = (cat: string, selectAll: boolean) => {
    if (!draft) return
    const ids = INDICATORS.filter((i) => i.category === cat).map((i) => i.id)
    const next = selectAll
      ? draft.indicators.filter((id) => !ids.includes(id))
      : Array.from(new Set([...draft.indicators, ...ids]))
    patchSelection('indicators', next, 'indikator')
  }

  // indicator selection summary for the AI preview
  const indicatorPreview = useMemo(
    () => (draft ? draft.indicators.map((id) => getIndicatorConfig(id).name) : []),
    [draft]
  )

  if (!draft) {
    return (
      <div className="space-y-3 p-3 sm:p-4" aria-busy="true" aria-label="Memuat settings">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
        <Skeleton className="h-56 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* ===== a) Trading mode ===== */}
      <ModeCard title="Mode Trading" icon={<Bot />}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ModeOption
            selected={draft.tradingMode === 'manual'}
            onClick={() => patch({ tradingMode: 'manual' })}
            title="Manual"
            desc="Anda yang mengeksekusi order dari tab Trading — engine hanya memantau pasar & alert."
            icon={<Hand />}
            ariaLabel="Mode trading manual"
          />
          <ModeOption
            selected={draft.tradingMode === 'ai'}
            onClick={() => patch({ tradingMode: 'ai' })}
            title="AI Auto-Trade"
            desc="Engine membuka & menutup posisi otomatis: gate sesi, news, daily limit, lalu voting indikator berbobot."
            icon={<Bot />}
            ariaLabel="Mode trading AI auto"
          />
        </div>
      </ModeCard>

      {/* ===== b) c) d) Pairs / Sessions / Timeframes ===== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ModeCard
          title="Pairs"
          icon={<Coins />}
          mode={draft.pairMode}
          onMode={(m) => patch({ pairMode: m })}
          badge={
            <Badge variant="outline" className="num ml-1 px-1 text-[9px] tabular-nums">
              {draft.pairs.length}/{PAIRS.length}
            </Badge>
          }
        >
          {draft.pairMode === 'manual' ? (
            <div className="flex flex-wrap gap-1.5">
              {PAIRS.map((p) => (
                <Chip
                  key={p.id}
                  active={draft.pairs.includes(p.id)}
                  onClick={() => patchSelection('pairs', toggleId(draft.pairs, p.id), 'pair')}
                  ariaLabel={`Toggle pair ${p.name}`}
                >
                  {p.id}
                </Chip>
              ))}
            </div>
          ) : (
            <AiInfoPreview values={draft.pairs} note="AI men-skor semua pair lalu memilih kandidat terbaik per cycle." />
          )}
        </ModeCard>

        <ModeCard
          title="Sesi Trading"
          icon={<Clock />}
          mode={draft.sessionMode}
          onMode={(m) => patch({ sessionMode: m })}
          badge={
            <Badge variant="outline" className="num ml-1 px-1 text-[9px] tabular-nums">
              {draft.sessions.length}/4
            </Badge>
          }
        >
          {draft.sessionMode === 'manual' ? (
            <div className="flex flex-wrap gap-1.5">
              {SESSIONS.map((s) => (
                <Chip
                  key={s.id}
                  active={draft.sessions.includes(s.id)}
                  onClick={() => patchSelection('sessions', toggleId(draft.sessions, s.id), 'sesi trading')}
                  ariaLabel={`Toggle sesi ${s.name}`}
                >
                  <span className="flex items-center gap-1.5">
                    {now && isSessionActive(s.id, now) ? <LiveDot ok /> : null}
                    {s.name}
                  </span>
                </Chip>
              ))}
            </div>
          ) : (
            <AiInfoPreview values={draft.sessions} note="AI trading hanya saat minimal satu sesi sedang aktif." />
          )}
          <p className="mt-2 text-[9px] text-muted-foreground">
            <LiveDot ok /> = sesi sedang berjalan (waktu UTC riil)
          </p>
        </ModeCard>

        <ModeCard
          title="Timeframes"
          icon={<Timer />}
          mode={draft.timeframeMode}
          onMode={(m) => patch({ timeframeMode: m })}
          badge={
            <Badge variant="outline" className="num ml-1 px-1 text-[9px] tabular-nums">
              {draft.timeframes.length}/9
            </Badge>
          }
        >
          {draft.timeframeMode === 'manual' ? (
            <div className="flex flex-wrap gap-1.5">
              {TIMEFRAMES.map((t) => (
                <Chip
                  key={t.id}
                  active={draft.timeframes.includes(t.id)}
                  onClick={() => patchSelection('timeframes', toggleId(draft.timeframes, t.id), 'timeframe')}
                  ariaLabel={`Toggle timeframe ${t.id}`}
                >
                  <span className="font-mono">{t.id}</span>
                </Chip>
              ))}
            </div>
          ) : (
            <AiInfoPreview values={draft.timeframes} note="AI memilih TF sesuai volatilitas (ATR M15 vs normal per menit)." />
          )}
          <p className="mt-2 text-[9px] text-muted-foreground">Timeframe pertama dipakai sebagai default analisa & chart.</p>
        </ModeCard>
      </div>

      {/* ===== e) Indicators ===== */}
      <ModeCard
        title="Indikator Teknikal"
        icon={<Activity />}
        mode={draft.indicatorMode}
        onMode={(m) => patch({ indicatorMode: m })}
        badge={
          <Badge variant="outline" className="num ml-1 px-1 text-[9px] tabular-nums">
            {draft.indicators.length}/30
          </Badge>
        }
      >
        {draft.indicatorMode === 'manual' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {INDICATOR_CATEGORIES.map((cat) => {
              const group = INDICATORS.filter((i) => i.category === cat)
              const selectedCount = group.filter((i) => draft.indicators.includes(i.id)).length
              const allSelected = selectedCount === group.length
              return (
                <div key={cat} className="rounded-lg border bg-muted/20 p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {cat}
                      <Badge variant="outline" className="num px-1 text-[9px] tabular-nums">
                        {selectedCount}/{group.length}
                      </Badge>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIndicatorGroup(cat, !allSelected)}
                      className="rounded px-1 text-[9px] font-semibold text-muted-foreground transition-colors hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50"
                      aria-label={allSelected ? `Kosongkan kategori ${cat}` : `Pilih semua indikator ${cat}`}
                    >
                      {allSelected ? 'Kosongkan' : 'Pilih semua'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.map((i) => (
                      <Chip
                        key={i.id}
                        compact
                        active={draft.indicators.includes(i.id)}
                        onClick={() => patchSelection('indicators', toggleId(draft.indicators, i.id), 'indikator')}
                        title={i.name}
                        ariaLabel={`Toggle indikator ${i.name}`}
                      >
                        {i.name}
                      </Chip>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <AiInfoPreview
            values={indicatorPreview}
            note="AI memilih top indikator berdasarkan bobot hasil self-learning (win/loss per indikator)."
          />
        )}
      </ModeCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ===== f) AI provider (manual only) ===== */}
        <ModeCard
          title="AI Provider"
          icon={<Cpu />}
          badge={
            <Badge variant="outline" className="ml-1 border-zinc-500/30 px-1 text-[9px] font-normal text-muted-foreground">
              manual only
            </Badge>
          }
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AI_PROVIDERS.map((p) => {
              const selected = draft.aiProvider === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => patch({ aiProvider: p.id })}
                  aria-pressed={selected}
                  aria-label={`Pilih provider ${p.name}`}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                    selected ? 'border-emerald-500 bg-emerald-500/[0.07]' : 'border-border hover:border-emerald-500/40'
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold">{p.name}</span>
                    {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                  </span>
                  <span className="num block text-[10px] text-muted-foreground">{p.model}</span>
                  <span className="mt-0.5 block text-[9px] leading-tight text-muted-foreground/80">{p.description}</span>
                  {p.demoLive ? (
                    <Badge
                      variant="outline"
                      className="mt-1.5 border-emerald-500/40 bg-emerald-500/10 px-1 text-[8px] font-semibold text-emerald-500"
                    >
                      Aktif di dashboard
                    </Badge>
                  ) : (
                    <span className="mt-1.5 block text-[8px] leading-tight text-amber-600/90 dark:text-amber-400/90">
                      Fallback local di demo — aktif penuh via Python engine
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </ModeCard>

        {/* ===== g) Risk management ===== */}
        <ModeCard title="Risk Management" icon={<Shield />} mode={draft.riskMode} onMode={(m) => patch({ riskMode: m })}>
          {draft.riskMode === 'manual' ? (
            <div className="space-y-3.5">
              <SliderRow
                label="Risk per trade"
                value={draft.riskPerTrade}
                min={RISK_LIMITS.riskPerTrade.min}
                max={RISK_LIMITS.riskPerTrade.max}
                step={RISK_LIMITS.riskPerTrade.step}
                onChange={(v) => patch({ riskPerTrade: v })}
                display={`${draft.riskPerTrade.toFixed(2)}%`}
                note={`≈ ${fmtMoney((equity * draft.riskPerTrade) / 100)} dari equity ${fmtMoney(equity)} — dipakai untuk hitung lot otomatis`}
              />
              <SliderRow
                label="Stop Loss"
                value={draft.stopLossPips}
                min={RISK_LIMITS.stopLossPips.min}
                max={RISK_LIMITS.stopLossPips.max}
                step={RISK_LIMITS.stopLossPips.step}
                onChange={(v) => patch({ stopLossPips: v })}
                display={`${draft.stopLossPips} pips`}
              />
              <SliderRow
                label="Take Profit ratio"
                value={draft.takeProfitRatio}
                min={RISK_LIMITS.takeProfitRatio.min}
                max={RISK_LIMITS.takeProfitRatio.max}
                step={RISK_LIMITS.takeProfitRatio.step}
                onChange={(v) => patch({ takeProfitRatio: v })}
                display={`${draft.takeProfitRatio.toFixed(1)}×`}
                badge={
                  <Badge variant="outline" className="border-emerald-500/40 px-1.5 text-[10px] font-bold text-emerald-500">
                    1 : {draft.takeProfitRatio.toFixed(1)}
                  </Badge>
                }
                note={`TP = SL × ratio → ${Math.round(draft.stopLossPips * draft.takeProfitRatio)} pips`}
              />
              <SliderRow
                label="Maks posisi terbuka"
                value={draft.maxPositions}
                min={RISK_LIMITS.maxPositions.min}
                max={RISK_LIMITS.maxPositions.max}
                step={RISK_LIMITS.maxPositions.step}
                onChange={(v) => patch({ maxPositions: v })}
                display={`${draft.maxPositions}`}
              />
              <SliderRow
                label="Daily risk limit"
                value={draft.dailyRiskLimit}
                min={RISK_LIMITS.dailyRiskLimit.min}
                max={RISK_LIMITS.dailyRiskLimit.max}
                step={RISK_LIMITS.dailyRiskLimit.step}
                onChange={(v) => patch({ dailyRiskLimit: v })}
                display={`${draft.dailyRiskLimit.toFixed(1)}%`}
                note="Anti margin call — engine berhenti trading saat loss harian mencapai limit ini"
              />
              <SliderRow
                label="Target harian"
                value={draft.dailyTarget}
                min={RISK_LIMITS.dailyTarget.min}
                max={RISK_LIMITS.dailyTarget.max}
                step={RISK_LIMITS.dailyTarget.step}
                onChange={(v) => patch({ dailyTarget: v })}
                display={`${draft.dailyTarget.toFixed(1)}%`}
                note="Saat target tercapai, trading dijeda sampai hari berikutnya (protect profit)"
              />
              <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2">
                <div>
                  <Label className="text-xs">Hindari news HIGH impact</Label>
                  <p className="text-[9px] leading-tight text-muted-foreground">
                    Tidak membuka posisi ±15 menit sekitar rilis news HIGH impact
                  </p>
                </div>
                <Switch
                  checked={draft.avoidNews}
                  onCheckedChange={(v) => patch({ avoidNews: v })}
                  aria-label="Hindari news HIGH impact ±15 menit"
                />
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t pt-2 text-[9px] leading-tight text-muted-foreground">
                <span className="flex items-center gap-1 font-semibold">
                  <Wallet className="h-3 w-3" />
                  {BROKER_PROFILE.name}
                </span>
                <span>Leverage {BROKER_PROFILE.leverageForex}</span>
                <span>Spread {BROKER_PROFILE.spread}</span>
                <span>Komisi {BROKER_PROFILE.commission}</span>
                <span>
                  Lot {BROKER_PROFILE.minVolume}–{BROKER_PROFILE.maxVolumePerOrder}/order
                </span>
                <span>
                  MC/SO {BROKER_PROFILE.marginCall}%/{BROKER_PROFILE.stopOut}%
                </span>
              </p>
            </div>
          ) : (
            <AiInfoPreview
              values={[
                `risk ${draft.riskPerTrade}%`,
                `SL ${draft.stopLossPips}p`,
                `RR 1:${draft.takeProfitRatio.toFixed(1)}`,
                `max ${draft.maxPositions} posisi`,
                `limit ${draft.dailyRiskLimit}%`,
                `target ${draft.dailyTarget}%`,
              ]}
              note="AI menyesuaikan SL/TP dengan volatilitas (ATR) dalam batas risk profile di atas."
            />
          )}
        </ModeCard>
      </div>

      {/* ===== API key provider AI (input manual, terenkripsi) ===== */}
      <AiProviderKeysCard />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* ===== h) Trailing stop ===== */}
        <ModeCard
          title="Trailing Stop"
          icon={<ChevronsUp />}
          mode={draft.trailingMode}
          onMode={(m) => patch({ trailingMode: m })}
        >
          {draft.trailingMode === 'manual' ? (
            <SliderRow
              label="Jarak trailing"
              value={draft.trailingStopPips}
              min={RISK_LIMITS.trailingStopPips.min}
              max={RISK_LIMITS.trailingStopPips.max}
              step={RISK_LIMITS.trailingStopPips.step}
              onChange={(v) => patch({ trailingStopPips: v })}
              display={`${draft.trailingStopPips} pips`}
              note="SL mengikuti harga sejauh ini saat posisi profit — tidak pernah mundur."
            />
          ) : (
            <AiInfoPreview
              values={[`trailing ${draft.trailingStopPips} pips`]}
              note="Mode AI: trailing aktif otomatis saat posisi profit lebih dari 6 pips."
            />
          )}
        </ModeCard>

        {/* ===== Engine connection ===== */}
        <ModeCard title="Engine Connection" icon={<Server />}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <ModeOption
              selected={draft.engineMode === 'demo'}
              onClick={() => patch({ engineMode: 'demo' })}
              title="DEMO"
              desc="Simulator dashboard — berjalan penuh di server ini."
              icon={<Cpu />}
              ariaLabel="Mode engine demo"
            />
            <ModeOption
              selected={draft.engineMode === 'live'}
              onClick={() => patch({ engineMode: 'live' })}
              title="LIVE"
              desc="Python engine di PC Anda (MetaTrader 5, akun real)."
              icon={<Server />}
              ariaLabel="Mode engine live"
            />
          </div>

          {draft.engineMode === 'live' ? (
            <div className="mt-2.5 space-y-2">
              <div className="space-y-1">
                <Label htmlFor="engine-url" className="text-[11px] text-muted-foreground">
                  Engine URL
                </Label>
                <Input
                  id="engine-url"
                  placeholder="http://localhost:8000"
                  value={draft.engineUrl}
                  onChange={(e) => patch({ engineUrl: e.target.value })}
                  className="num h-8 font-mono text-xs"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <Alert className="border-amber-500/40 bg-amber-500/10 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-[10px] leading-tight text-amber-600 dark:text-amber-400">
                  Pastikan python-engine berjalan di PC Anda (lihat tab Engine Setup). Jika tidak terjangkau, dashboard
                  otomatis fallback ke DEMO.
                </AlertDescription>
              </Alert>
            </div>
          ) : null}

          <div className="mt-2.5 flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-[10px]">
            <LiveDot ok={engine?.status.connected ?? false} />
            <span>
              Engine saat ini:{' '}
              <span className="font-bold">{engine?.status.mode ?? '—'}</span> ·{' '}
              {engine?.status.connected ? 'terhubung' : 'tidak terjangkau (fallback DEMO)'}
            </span>
          </div>
        </ModeCard>

        {/* ===== Notifications ===== */}
        <ModeCard title="Notifikasi Email" icon={<Mail />}>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2">
              <div>
                <Label htmlFor="email-enabled" className="text-xs">
                  Notifikasi email
                </Label>
                <p className="text-[9px] leading-tight text-muted-foreground">Kirim email saat event penting terjadi</p>
              </div>
              <Switch
                id="email-enabled"
                checked={draft.emailEnabled}
                onCheckedChange={(v) => patch({ emailEnabled: v })}
                aria-label="Aktifkan notifikasi email"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="email-to" className="text-[11px] text-muted-foreground">
                Alamat email tujuan
              </Label>
              <Input
                id="email-to"
                type="email"
                placeholder="nama@email.com"
                value={draft.emailTo}
                onChange={(e) => patch({ emailTo: e.target.value })}
                disabled={!draft.emailEnabled}
                className="h-8 text-xs"
                autoComplete="email"
              />
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Event yang dikirim
              </span>
              <div className={cn('mt-1 grid grid-cols-1 gap-1', !draft.emailEnabled && 'pointer-events-none opacity-50')}>
                {EVENTS_NOTIF.map((ev) => (
                  <label
                    key={ev.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition-colors hover:border-emerald-500/40"
                  >
                    <Checkbox
                      checked={draft.emailEvents.includes(ev.id)}
                      onCheckedChange={() => patch({ emailEvents: toggleId(draft.emailEvents, ev.id) })}
                      aria-label={ev.label}
                    />
                    {ev.label}
                  </label>
                ))}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5 text-[11px]"
              disabled={!draft.emailEnabled || testing}
              onClick={sendTest}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Kirim Test
            </Button>
            <p className="text-[9px] leading-tight text-muted-foreground">
              Mode demo: email disimulasikan dan tercatat di tab Logs (<span className="font-mono">[EMAIL-SIM]</span>).
              Pengiriman SMTP nyata berjalan via Python engine di PC Anda.
            </p>
          </div>
        </ModeCard>
      </div>

      {/* ===== Sticky save bar ===== */}
      <div className="sticky bottom-0 z-30 -mx-3 -mb-3 border-t bg-background/95 px-3 py-2.5 backdrop-blur sm:-mx-4 sm:-mb-4 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
            {dirty ? (
              <span className="flex items-center gap-1.5 font-semibold text-amber-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                Ada perubahan belum disimpan
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Settings tersinkron dengan engine
              </span>
            )}
            <span className="hidden truncate sm:inline">
              · {draft.tradingMode === 'ai' ? 'AI Auto-Trade' : 'Manual'} · {draft.engineMode.toUpperCase()} engine
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[11px]" disabled={!dirty || saving} onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-[11px] font-bold text-white hover:bg-emerald-600/90"
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Simpan
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
