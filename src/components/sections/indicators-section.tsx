"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Cpu,
  Loader2,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel, Pill, SectionHeader } from "@/components/shared";
import { useStore } from "@/lib/store";
import {
  INDICATOR_CATEGORIES,
  INDICATOR_POOL,
} from "@/lib/constants";
import type { IndicatorState } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEFAULT_ENABLED = ["EMA", "RSI", "ATR", "Supertrend"];

const CAT_PILL: Record<string, string> = {
  trend: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  momentum: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  volatility: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  channel: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  volume: "border-violet-500/30 bg-violet-500/10 text-violet-400",
};
const CAT_TEXT: Record<string, string> = {
  trend: "text-emerald-400",
  momentum: "text-amber-400",
  volatility: "text-rose-400",
  channel: "text-sky-400",
  volume: "text-violet-400",
};
const CAT_BAR: Record<string, string> = {
  trend: "bg-emerald-500",
  momentum: "bg-amber-500",
  volatility: "bg-rose-500",
  channel: "bg-sky-500",
  volume: "bg-violet-500",
};

export function IndicatorsSection() {
  // L1: select only the field we need (not whole tradingCfg)
  const indicatorAuto = useStore((s) => s.tradingCfg.indicatorAuto);
  const setTradingCfg = useStore((s) => s.setTradingCfg);
  const setIndicators = useStore((s) => s.setIndicators);

  const [map, setMap] = useState<Record<string, IndicatorState>>({});
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true); // M7: loading state
  const [autoSelecting, setAutoSelecting] = useState(false);

  // C2: refetch indicators from server (used after auto-select)
  const refetchIndicators = useCallback(async () => {
    try {
      const r = await fetch("/api/indicators");
      if (!r.ok) throw new Error(`HTTP ${r.status}`); // M1: check res.ok
      const d = await r.json();
      const fetched: IndicatorState[] = d.indicators ?? [];
      const m: Record<string, IndicatorState> = {};
      for (const def of INDICATOR_POOL) {
        const f = fetched.find((x) => x.name === def.name);
        // M4: prune orphan param keys (only keep keys in defaultParams)
        const cleanParams = f
          ? Object.fromEntries(
              Object.entries({ ...def.defaultParams, ...f.params }).filter(
                ([k]) => k in def.defaultParams,
              ),
            )
          : { ...def.defaultParams };
        m[def.name] = f
          ? { ...f, params: cleanParams, category: def.category }
          : {
              name: def.name,
              enabled: DEFAULT_ENABLED.includes(def.name),
              autoMode: false,
              params: { ...def.defaultParams },
              category: def.category,
            };
      }
      setMap(m);
      setIndicators(Object.values(m));
    } catch {
      toast.error("Gagal memuat indikator");
    } finally {
      setLoading(false);
    }
  }, [setIndicators]);

  useEffect(() => {
    refetchIndicators();
  }, [refetchIndicators]);

  // H2: persist now checks res.ok before success toast
  async function persist(state: IndicatorState, silent = false) {
    try {
      const res = await fetch("/api/indicators", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!silent) toast.success("Indikator diperbarui", { description: state.name });
    } catch {
      toast.error("Gagal menyimpan indikator", { description: state.name });
      // M3: rollback — refetch to restore server state
      refetchIndicators();
    }
  }

  function toggleEnabled(name: string, enabled: boolean) {
    const cur = map[name];
    if (!cur) return;
    const next = { ...cur, enabled };
    const updated = { ...map, [name]: next };
    setMap(updated);
    setIndicators(Object.values(updated));
    void persist(next);
  }

  function toggleAuto(name: string, autoMode: boolean) {
    const cur = map[name];
    if (!cur) return;
    const next = { ...cur, autoMode };
    const updated = { ...map, [name]: next };
    setMap(updated);
    setIndicators(Object.values(updated));
    void persist(next);
  }

  // H3: setParam no longer pushes to global store (was per-keystroke)
  function setParam(name: string, key: string, value: number) {
    const cur = map[name];
    if (!cur) return;
    const next = { ...cur, params: { ...cur.params, [key]: value } };
    setMap({ ...map, [name]: next }); // local state only
  }

  // H3: commitParam pushes to store + persists on blur
  function commitParam(name: string) {
    const cur = map[name];
    if (!cur) return;
    setIndicators(Object.values(map)); // push to store once on commit
    void persist(cur, true); // L4: silent (no toast on param blur)
  }

  // C1: AI Auto-Select toggle — fires immediately via dedicated endpoint
  async function handleAutoSelectToggle(v: boolean) {
    setTradingCfg({ indicatorAuto: v });

    // Persist the trading config change
    try {
      await fetch("/api/config/trading", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indicatorAuto: v }),
      });
    } catch { /* ignore */ }

    if (!v) {
      toast.info("AI Auto-Select OFF", {
        description: "Indikator dikonfigurasi manual. Auto-select dihentikan.",
      });
      return;
    }

    // C1: fire auto-select immediately (don't wait for 90s tick)
    setAutoSelecting(true);
    try {
      const res = await fetch("/api/indicators/auto-select", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // C2: refetch to reflect server-side changes
      await refetchIndicators();
      toast.success("AI Auto-Select aktif", {
        description: `${data.changed} indikator diubah. Subset scalping: ${data.enabled?.length ?? 0} indikator aktif. Indikator dengan autoMode=OFF tidak diubah.`,
      });
    } catch {
      toast.error("Gagal menjalankan AI auto-select");
    } finally {
      setAutoSelecting(false);
    }
  }

  // M9: Reset to defaults
  function resetToDefaults() {
    const updated: Record<string, IndicatorState> = {};
    for (const def of INDICATOR_POOL) {
      updated[def.name] = {
        name: def.name,
        enabled: DEFAULT_ENABLED.includes(def.name),
        autoMode: false,
        params: { ...def.defaultParams },
        category: def.category,
      };
      void persist(updated[def.name], true);
    }
    setMap(updated);
    setIndicators(Object.values(updated));
    toast.success("Reset ke default", {
      description: `${DEFAULT_ENABLED.length} indikator diaktifkan, sisanya dinonaktifkan.`,
    });
  }

  const filtered = useMemo(
    () => INDICATOR_POOL.filter((p) => filter === "all" || p.category === filter),
    [filter],
  );

  // L2: memoize computed values
  const enabledCount = useMemo(
    () => Object.values(map).filter((x) => x.enabled).length,
    [map],
  );

  const catCounts = useMemo(
    () =>
      INDICATOR_CATEGORIES.map((c) => ({
        ...c,
        total: INDICATOR_POOL.filter((p) => p.category === c.key).length,
        enabled: Object.values(map).filter(
          (x) => x.category === c.key && x.enabled,
        ).length,
      })),
    [map],
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Indicators Lab — 30 Indikator Scalping"
        description="Pool indikator lengkap dengan konfigurasi scalping M1-M5. AI auto-select mengaktifkan 5 indikator scalping optimal."
        icon={<SlidersHorizontal className="size-5" />}
        actions={
          <>
            <Pill tone="accent">
              <Check className="size-3" /> {enabledCount} aktif
            </Pill>
            <Button size="sm" variant="ghost" onClick={refetchIndicators} disabled={loading}>
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
            <Button size="sm" variant="ghost" onClick={resetToDefaults}>
              <RotateCcw className="size-3.5" /> Reset
            </Button>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">AI Auto-Select</Label>
              <Switch
                checked={indicatorAuto}
                onCheckedChange={handleAutoSelectToggle}
                disabled={autoSelecting}
              />
              {autoSelecting && <Loader2 className="size-3 animate-spin text-violet-400" />}
            </div>
          </>
        }
      />

      {/* Filter */}
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(v) => { if (v) setFilter(v); }}
        variant="outline"
        size="sm"
        className="flex-wrap"
      >
        <ToggleGroupItem value="all">Semua ({INDICATOR_POOL.length})</ToggleGroupItem>
        {INDICATOR_CATEGORIES.map((c) => (
          <ToggleGroupItem key={c.key} value={c.key}>
            {c.label} ({INDICATOR_POOL.filter((p) => p.category === c.key).length})
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Grid — M7: skeleton while loading */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((def) => {
            const st = map[def.name];
            if (!st) return null;
            return (
              <div
                key={def.name}
                className={cn(
                  "rounded-xl border bg-card p-4 shadow-sm transition-opacity",
                  st.enabled ? "border-border opacity-100" : "border-border/60 opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{def.name}</span>
                      <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase", CAT_PILL[def.category])}>
                        {def.category}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {def.scalpingHint}
                    </p>
                  </div>
                  <Switch
                    checked={st.enabled}
                    onCheckedChange={(v) => toggleEnabled(def.name, v)}
                  />
                </div>

                {Object.keys(def.defaultParams).length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {Object.entries(st.params).map(([k, v]) => (
                      <div key={k} className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {k}
                        </Label>
                        <Input
                          type="number"
                          value={v}
                          min={1}
                          max={500}
                          step={1}
                          onChange={(e) => {
                            // M2: guard against NaN/empty input
                            const n = Number(e.target.value);
                            if (Number.isFinite(n)) setParam(def.name, k, n);
                          }}
                          onBlur={() => commitParam(def.name)}
                          className="h-7 tnum text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2">
                  <Label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Cpu className="size-3" /> Auto Mode
                    {st.autoMode && (
                      <span className="text-violet-400">(AI-managed)</span>
                    )}
                  </Label>
                  <Switch
                    checked={st.autoMode}
                    onCheckedChange={(v) => toggleAuto(def.name, v)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Strategi aktif */}
      <Panel
        title="Strategi Scalping Aktif"
        description="Distribusi indikator aktif per kategori"
        actions={
          indicatorAuto ? (
            <Pill tone="accent">
              <Cpu className="size-3" /> AI Auto-Select ON
            </Pill>
          ) : (
            <Pill>Manual</Pill>
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {catCounts.map((c) => (
            <div
              key={c.key}
              className="rounded-lg border border-border bg-muted/20 p-3"
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs font-medium", CAT_TEXT[c.key])}>
                  {c.label}
                </span>
                <span className="text-xs tnum text-muted-foreground">
                  {c.enabled}/{c.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", CAT_BAR[c.key])}
                  style={{ width: `${c.total > 0 ? (c.enabled / c.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {indicatorAuto
            ? "AI Auto-Select aktif: 5 indikator scalping optimal (EMA, RSI, ATR, Supertrend, Bollinger Bands) diaktifkan otomatis. Indikator dengan Auto Mode OFF tidak diubah oleh AI."
            : "Mode manual: aktifkan/nonaktifkan indikator secara individual. Aktifkan AI Auto-Select untuk konfigurasi otomatis."}
        </p>
      </Panel>
    </div>
  );
}
