"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SlidersHorizontal,
  Cpu,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SectionHeader, Panel, Pill } from "@/components/shared";
import { useStore } from "@/lib/store";
import { INDICATOR_POOL, INDICATOR_CATEGORIES } from "@/lib/constants";
import type { IndicatorState } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEFAULT_ENABLED = ["EMA", "RSI", "ATR", "Supertrend"];

const CAT_PILL: Record<string, string> = {
  trend: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  momentum: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  volatility: "text-rose-400 bg-rose-500/15 border-rose-500/30",
  channel: "text-sky-400 bg-sky-500/15 border-sky-500/30",
  volume: "text-violet-400 bg-violet-500/15 border-violet-500/30",
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
  const tradingCfg = useStore((s) => s.tradingCfg);
  const setTradingCfg = useStore((s) => s.setTradingCfg);
  const setIndicators = useStore((s) => s.setIndicators);

  const [map, setMap] = useState<Record<string, IndicatorState>>({});
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    let mounted = true;
    fetch("/api/indicators")
      .then((r) => r.json())
      .then((d) => {
        if (!mounted) return;
        const fetched: IndicatorState[] = d.indicators ?? [];
        const m: Record<string, IndicatorState> = {};
        for (const def of INDICATOR_POOL) {
          const f = fetched.find((x) => x.name === def.name);
          m[def.name] = f
            ? {
                ...f,
                params: { ...def.defaultParams, ...f.params },
                category: def.category,
              }
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
      })
      .catch(() => toast.error("Gagal memuat indikator"));
    return () => {
      mounted = false;
    };
  }, [setIndicators]);

  async function persist(state: IndicatorState) {
    try {
      await fetch("/api/indicators", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      toast.success("Indikator diperbarui", { description: state.name });
    } catch {
      toast.error("Gagal menyimpan indikator");
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

  function setParam(name: string, key: string, value: number) {
    const cur = map[name];
    if (!cur) return;
    const next = { ...cur, params: { ...cur.params, [key]: value } };
    const updated = { ...map, [name]: next };
    setMap(updated);
    setIndicators(Object.values(updated));
  }

  function commitParam(name: string) {
    const cur = map[name];
    if (cur) void persist(cur);
  }

  const filtered = useMemo(
    () =>
      INDICATOR_POOL.filter((p) => filter === "all" || p.category === filter),
    [filter],
  );

  const enabledCount = Object.values(map).filter((x) => x.enabled).length;

  const catCounts = INDICATOR_CATEGORIES.map((c) => ({
    ...c,
    total: INDICATOR_POOL.filter((p) => p.category === c.key).length,
    enabled: Object.values(map).filter(
      (x) => x.category === c.key && x.enabled,
    ).length,
  }));

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Indicators Lab — 30 Indikator Scalping"
        description="Pool indikator lengkap dengan konfigurasi scalping M1-M5. AI auto-select memilih subset optimal per market regime."
        icon={<SlidersHorizontal className="size-5" />}
        actions={
          <>
            <Pill tone="accent">
              <Check className="size-3" /> {enabledCount} aktif
            </Pill>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">
                AI Auto-Select
              </Label>
              <Switch
                checked={tradingCfg.indicatorAuto}
                onCheckedChange={(v) => setTradingCfg({ indicatorAuto: v })}
              />
            </div>
          </>
        }
      />

      {/* Filter */}
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(v) => {
          if (v) setFilter(v);
        }}
        variant="outline"
        size="sm"
        className="flex-wrap"
      >
        <ToggleGroupItem value="all">
          Semua ({INDICATOR_POOL.length})
        </ToggleGroupItem>
        {INDICATOR_CATEGORIES.map((c) => (
          <ToggleGroupItem key={c.key} value={c.key}>
            {c.label} (
            {INDICATOR_POOL.filter((p) => p.category === c.key).length})
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((def) => {
          const st = map[def.name];
          if (!st) return null;
          return (
            <div
              key={def.name}
              className={cn(
                "rounded-xl border bg-card p-4 shadow-sm transition-opacity",
                st.enabled
                  ? "border-border opacity-100"
                  : "border-border/60 opacity-70",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {def.name}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase",
                        CAT_PILL[def.category],
                      )}
                    >
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
                        onChange={(e) =>
                          setParam(def.name, k, Number(e.target.value))
                        }
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

      {/* Strategi aktif */}
      <Panel
        title="Strategi Scalping Aktif"
        description="Distribusi indikator aktif per kategori"
        actions={
          tradingCfg.indicatorAuto ? (
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
                  className={cn(
                    "h-full rounded-full transition-all",
                    CAT_BAR[c.key],
                  )}
                  style={{
                    width: `${c.total > 0 ? (c.enabled / c.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Saat AI Auto-Select aktif, model memilih subset indikator optimal
          berdasarkan regime pasar (trending / ranging / volatile) secara
          real-time, mengoptimalkan sinyal scalping M1-M5.
        </p>
      </Panel>
    </div>
  );
}
