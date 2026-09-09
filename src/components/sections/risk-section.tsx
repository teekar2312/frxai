"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Info,
  Layers,
  Percent,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { useStore } from "@/lib/store";
import { BROKER_SPEC, PAIRS } from "@/lib/constants";
import type { Pair, RiskConfig } from "@/lib/types";

import {
  LiveDot,
  Panel,
  Pill,
  SectionHeader,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const fmtUsd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pipValuePerLot = (s: Pair) => (s === "XAUUSD" ? 1 : 10);

interface LotCalc {
  balance: number;
  riskPct: number;
  slPips: number;
  symbol: Pair;
}

export function RiskSection() {
  const account = useStore((s) => s.account);
  const setRiskCfg = useStore((s) => s.setRiskCfg);

  const [cfg, setCfg] = useState<RiskConfig>({
    riskPerTrade: 1,
    stopLossPipsMin: 5,
    stopLossPipsMax: 15,
    rrRatio: 1.5,
    maxOpenPositions: 3,
    dailyLossLimit: 3,
    avoidHighImpactNews: true,
    dailyTarget: 2,
    autoMode: false,
  });
  const [loaded, setLoaded] = useState(false);

  const [calc, setCalc] = useState<LotCalc>({
    balance: account.balance,
    riskPct: 1,
    slPips: 8,
    symbol: "EURUSD",
  });

  // Fetch risk config on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/config/risk");
        const data = await res.json();
        if (!mounted || !data?.config) return;
        setCfg(data.config as RiskConfig);
        setRiskCfg(data.config as RiskConfig);
        setCalc((c) => ({
          ...c,
          riskPct: (data.config as RiskConfig).riskPerTrade,
        }));
        // allow save effect to fire only after initial load completes
        setTimeout(() => setLoaded(true), 0);
      } catch {
        setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setRiskCfg]);

  // Debounced save on cfg change
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      fetch("/api/config/risk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      })
        .then(() => toast.success("Risiko diperbarui"))
        .catch(() => toast.error("Gagal menyimpan konfigurasi risiko"));
    }, 500);
    return () => clearTimeout(id);
  }, [cfg, loaded]);

  const update = useCallback(
    (patch: Partial<RiskConfig>) => {
      setCfg((prev) => {
        const next = { ...prev, ...patch };
        setRiskCfg(next);
        return next;
      });
    },
    [setRiskCfg],
  );

  // Lot calculator results
  const calcResults = useMemo(() => {
    const riskUsd = calc.balance * (calc.riskPct / 100);
    const pv = pipValuePerLot(calc.symbol);
    const lot = calc.slPips > 0 ? riskUsd / (calc.slPips * pv) : 0;
    const rewardUsd = riskUsd * cfg.rrRatio;
    return {
      riskUsd,
      lot: Math.max(0, lot),
      rewardUsd,
      potentialLoss: riskUsd,
      potentialProfit: rewardUsd,
    };
  }, [calc, cfg.rrRatio]);

  // Anti-MC progress
  const dailyLossPct = Math.min(
    100,
    (account.dailyLossUsed / cfg.dailyLossLimit) * 100,
  );
  const dailyLossDanger = dailyLossPct > 80;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      <SectionHeader
        title="Manajemen Risiko"
        description="Konfigurasi parameter risiko, kalkulator lot size & pengaman Anti-MC untuk akun FINEX."
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
            <span className="text-xs font-medium text-violet-400">
              AI Auto Risk
            </span>
            <Switch
              checked={cfg.autoMode}
              onCheckedChange={(v) => update({ autoMode: v })}
            />
          </div>
        }
      />

      {/* Config cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Risk per Trade */}
        <Panel title="Risk per Trade" description="% ekuitas per posisi">
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-semibold tnum text-rose-400">
                {cfg.riskPerTrade.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground tnum">
                = {fmtUsd(account.balance * (cfg.riskPerTrade / 100))}
              </span>
            </div>
            <Slider
              value={[cfg.riskPerTrade]}
              min={0.5}
              max={2}
              step={0.1}
              onValueChange={(v) => update({ riskPerTrade: v[0] })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground tnum">
              <span>0.5%</span>
              <span>2.0%</span>
            </div>
          </div>
        </Panel>

        {/* Stop Loss range */}
        <Panel
          title="Stop Loss Range"
          description="Batas pip untuk SL otomatis"
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Min (pips)</Label>
                <span className="tnum text-xs font-medium text-amber-400">
                  {cfg.stopLossPipsMin}p
                </span>
              </div>
              <Slider
                value={[cfg.stopLossPipsMin]}
                min={3}
                max={10}
                step={1}
                onValueChange={(v) =>
                  update({
                    stopLossPipsMin: Math.min(v[0], cfg.stopLossPipsMax - 1),
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Max (pips)</Label>
                <span className="tnum text-xs font-medium text-rose-400">
                  {cfg.stopLossPipsMax}p
                </span>
              </div>
              <Slider
                value={[cfg.stopLossPipsMax]}
                min={10}
                max={20}
                step={1}
                onValueChange={(v) =>
                  update({
                    stopLossPipsMax: Math.max(v[0], cfg.stopLossPipsMin + 1),
                  })
                }
              />
            </div>
          </div>
        </Panel>

        {/* RR Ratio */}
        <Panel
          title="Risk : Reward Ratio"
          description="Target rasio imbal hasil"
        >
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-semibold tnum text-emerald-400">
                1:{cfg.rrRatio.toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground tnum">
                reward {fmtUsd(account.balance * (cfg.riskPerTrade / 100) * cfg.rrRatio)}
              </span>
            </div>
            <Slider
              value={[cfg.rrRatio]}
              min={1}
              max={3}
              step={0.1}
              onValueChange={(v) => update({ rrRatio: v[0] })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground tnum">
              <span>1.0</span>
              <span>3.0</span>
            </div>
          </div>
        </Panel>

        {/* Max Open Positions */}
        <Panel
          title="Max Open Positions"
          description={`Batas broker ${BROKER_SPEC.maxOpenPositions}`}
        >
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-semibold tnum text-violet-400">
                {cfg.maxOpenPositions}
              </span>
              <span className="text-xs text-muted-foreground">
                posisi simultan
              </span>
            </div>
            <Slider
              value={[cfg.maxOpenPositions]}
              min={1}
              max={10}
              step={1}
              onValueChange={(v) => update({ maxOpenPositions: v[0] })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground tnum">
              <span>1</span>
              <span>10 (UI) · broker {BROKER_SPEC.maxOpenPositions}</span>
            </div>
          </div>
        </Panel>

        {/* Daily Loss Limit */}
        <Panel
          title="Daily Loss Limit (Anti-MC)"
          description="Batas kerugian harian %"
        >
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-semibold tnum text-rose-400">
                {cfg.dailyLossLimit.toFixed(0)}%
              </span>
              <span className="text-xs text-muted-foreground tnum">
                = {fmtUsd(account.balance * (cfg.dailyLossLimit / 100))}
              </span>
            </div>
            <Slider
              value={[cfg.dailyLossLimit]}
              min={1}
              max={5}
              step={1}
              onValueChange={(v) => update({ dailyLossLimit: v[0] })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground tnum">
              <span>1%</span>
              <span>5%</span>
            </div>
          </div>
        </Panel>

        {/* Daily Target */}
        <Panel title="Daily Target" description="Target profit harian %">
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-semibold tnum text-emerald-400">
                {cfg.dailyTarget.toFixed(0)}%
              </span>
              <span className="text-xs text-muted-foreground tnum">
                = {fmtUsd(account.balance * (cfg.dailyTarget / 100))}
              </span>
            </div>
            <Slider
              value={[cfg.dailyTarget]}
              min={1}
              max={5}
              step={1}
              onValueChange={(v) => update({ dailyTarget: v[0] })}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground tnum">
              <span>1%</span>
              <span>5%</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* Avoid High-Impact News */}
      <Panel
        title="Pengaturan Tambahan"
        description="Filter berita & event ekonomi berdampak tinggi"
        actions={
          <Switch
            checked={cfg.avoidHighImpactNews}
            onCheckedChange={(v) => update({ avoidHighImpactNews: v })}
          />
        }
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Avoid High-Impact News</p>
            <p className="text-xs text-muted-foreground">
              Saat aktif, sistem menolak pembukaan posisi baru selama 15 menit
              sebelum & sesudah rilis berita high-impact (NFP, CPI, FOMC, dll).
            </p>
          </div>
        </div>
      </Panel>

      {/* Lot size calculator */}
      <Panel
        title="Kalkulator Lot Size"
        description="Hitung ukuran lot ideal berdasarkan risiko & SL"
        actions={
          <Pill tone="accent">
            <Calculator className="h-3 w-3" /> Highlight
          </Pill>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Inputs */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lc-balance">Balance ($)</Label>
                <Input
                  id="lc-balance"
                  type="number"
                  min={1}
                  step={100}
                  value={calc.balance}
                  onChange={(e) =>
                    setCalc((c) => ({
                      ...c,
                      balance: Math.max(1, Number(e.target.value) || 0),
                    }))
                  }
                  className="tnum"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lc-symbol">Pair</Label>
                <Select
                  value={calc.symbol}
                  onValueChange={(v) =>
                    setCalc((c) => ({ ...c, symbol: v as Pair }))
                  }
                >
                  <SelectTrigger id="lc-symbol" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAIRS.map((p) => (
                      <SelectItem key={p.symbol} value={p.symbol}>
                        {p.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="lc-risk">Risk %</Label>
                <span className="tnum text-xs font-medium text-rose-400">
                  {calc.riskPct.toFixed(1)}%
                </span>
              </div>
              <Slider
                value={[calc.riskPct]}
                min={0.5}
                max={2}
                step={0.1}
                onValueChange={(v) => setCalc((c) => ({ ...c, riskPct: v[0] }))}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="lc-sl">Stop Loss (pips)</Label>
                <span className="tnum text-xs font-medium text-amber-400">
                  {calc.slPips}p
                </span>
              </div>
              <Slider
                value={[calc.slPips]}
                min={3}
                max={20}
                step={1}
                onValueChange={(v) => setCalc((c) => ({ ...c, slPips: v[0] }))}
              />
            </div>

            <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
                <span>
                  Rumus: <span className="tnum text-foreground">Lot = Risk$ / (SL pips × pip value)</span>.
                  Pip value: {PAIRS.find((p) => p.symbol === calc.symbol)?.symbol === "XAUUSD" ? "$1/pip/lot" : "$10/pip/lot"}.
                </span>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5 text-center">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Rekomendasi Lot Size
              </div>
              <div className="mt-1 text-4xl font-bold tnum text-violet-400">
                {calcResults.lot.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {calc.symbol} · {calc.slPips}p SL
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-rose-400">
                  <TrendingDown className="h-3 w-3" /> Potential Loss
                </div>
                <div className="mt-1 tnum text-lg font-semibold text-rose-400">
                  −{fmtUsd(calcResults.potentialLoss)}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400">
                  <TrendingUp className="h-3 w-3" /> Potential Profit
                </div>
                <div className="mt-1 tnum text-lg font-semibold text-emerald-400">
                  +{fmtUsd(calcResults.potentialProfit)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Risk $
                </div>
                <div className="tnum text-sm font-semibold">
                  {fmtUsd(calcResults.riskUsd)}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  R:R
                </div>
                <div className="tnum text-sm font-semibold text-violet-400">
                  1:{cfg.rrRatio.toFixed(1)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* Anti-MC + Broker spec */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel
          title="Aturan Anti-MC"
          description="Penggunaan batas kerugian harian"
          className="lg:col-span-2"
        >
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Daily Loss Used
                </div>
                <div
                  className={cn(
                    "tnum text-2xl font-semibold",
                    dailyLossDanger ? "text-rose-400" : "text-amber-400",
                  )}
                >
                  {account.dailyLossUsed.toFixed(2)}%
                  <span className="text-sm text-muted-foreground">
                    {" "}
                    / {cfg.dailyLossLimit}% limit
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Sisa
                </div>
                <div className="tnum text-lg font-semibold text-emerald-400">
                  {Math.max(0, cfg.dailyLossLimit - account.dailyLossUsed).toFixed(2)}%
                </div>
              </div>
            </div>
            <Progress
              value={dailyLossPct}
              className={cn(
                "h-2.5",
                dailyLossDanger && "[&_[data-slot=progress-indicator]]:bg-rose-500",
              )}
            />
            <div className="flex items-center gap-2 text-xs">
              {dailyLossDanger ? (
                <Pill tone="down">
                  <ShieldAlert className="h-3 w-3" /> Risiko tinggi
                </Pill>
              ) : dailyLossPct > 50 ? (
                <Pill tone="warn">
                  <AlertTriangle className="h-3 w-3" /> Waspada
                </Pill>
              ) : (
                <Pill tone="up">
                  <ShieldCheck className="h-3 w-3" /> Aman
                </Pill>
              )}
              <span className="text-muted-foreground">
                Sistem akan menolak order baru saat limit harian tercapai.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-amber-400">
                  Margin Call
                </div>
                <div className="tnum text-lg font-semibold">
                  {BROKER_SPEC.marginCall}%
                </div>
              </div>
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-rose-400">
                  Stop Out
                </div>
                <div className="tnum text-lg font-semibold">
                  {BROKER_SPEC.stopOut}%
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Equity Stop
                </div>
                <div className="tnum text-lg font-semibold">
                  {cfg.dailyLossLimit}%
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Daily Target
                </div>
                <div className="tnum text-lg font-semibold text-emerald-400">
                  {cfg.dailyTarget}%
                </div>
              </div>
            </div>
          </div>
        </Panel>

        {/* Broker spec */}
        <Panel
          title="Spesifikasi Broker FINEX"
          description={BROKER_SPEC.name}
        >
          <dl className="space-y-2 text-xs">
            <SpecRow icon={<Percent className="h-3.5 w-3.5" />} label="Leverage Forex & Metals" value={BROKER_SPEC.leverageForexMetals} />
            <SpecRow icon={<TrendingUp className="h-3.5 w-3.5" />} label="Spread from" value={BROKER_SPEC.spreadFrom} />
            <SpecRow icon={<Info className="h-3.5 w-3.5" />} label="Commission" value={BROKER_SPEC.commission} />
            <SpecRow icon={<Layers className="h-3.5 w-3.5" />} label="Min Volume" value={`${BROKER_SPEC.minVolume} lot`} />
            <SpecRow icon={<Layers className="h-3.5 w-3.5" />} label="Max Volume / Order" value={`${BROKER_SPEC.maxVolumePerOrder} lot`} />
            <SpecRow icon={<Shield className="h-3.5 w-3.5" />} label="Max Open Positions" value={`${BROKER_SPEC.maxOpenPositions}`} />
            <SpecRow icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Margin Call" value={`${BROKER_SPEC.marginCall}%`} tone="warn" />
            <SpecRow icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Stop Out" value={`${BROKER_SPEC.stopOut}%`} tone="down" />
          </dl>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/20 p-2 text-[10px] text-muted-foreground">
            <LiveDot active label="Spec aktif" />
            <span className="ml-auto">
              <Badge variant="outline" className="text-[10px]">
                {BROKER_SPEC.name}
              </Badge>
            </span>
          </div>
        </Panel>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span>
          Trading forex & gold membawa risiko kerugian besar. Patuhi selalu
          aturan Anti-MC — jangan meningkatkan rasio risiko melebihi 2% per
          posisi.
        </span>
      </div>
    </motion.div>
  );
}

function SpecRow({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "warn" | "down";
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      <span
        className={cn(
          "tnum font-medium",
          tone === "warn" && "text-amber-400",
          tone === "down" && "text-rose-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default RiskSection;
