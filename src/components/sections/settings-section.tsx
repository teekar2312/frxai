"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  KeyRound,
  Link2,
  Save,
  Settings as SettingsIcon,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Panel, Pill, SectionHeader, StatCard } from "@/components/shared";
import { useStore } from "@/lib/store";
import {
  AI_PROVIDERS,
  BROKER_SPEC,
  PAIRS,
  SESSIONS,
  TIMEFRAMES,
} from "@/lib/constants";
import type {
  ApiKeys,
  Pair,
  Session,
  Timeframe,
  TradingConfig,
} from "@/lib/types";

type ProviderKey = "groq" | "openai" | "together" | "tinyfish";

const PROVIDER_KEYS: { key: ProviderKey; label: string; hint: string }[] = [
  { key: "groq", label: "Groq AI", hint: "Ultra-low latency inference" },
  { key: "openai", label: "OpenAI", hint: "GPT-4 class reasoning" },
  { key: "together", label: "Together.ai", hint: "Open-source models" },
  { key: "tinyfish", label: "Tinyfish.ai", hint: "Edge AI" },
];

function toggleInArray<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function SettingsSection() {
  const tradingCfg = useStore((s) => s.tradingCfg);
  const setTradingCfg = useStore((s) => s.setTradingCfg);
  const riskCfg = useStore((s) => s.riskCfg);
  const setRiskCfg = useStore((s) => s.setRiskCfg);
  const apiKeys = useStore((s) => s.apiKeys);
  const setApiKeys = useStore((s) => s.setApiKeys);
  const account = useStore((s) => s.account);
  const setAccount = useStore((s) => s.setAccount);
  const setSection = useStore((s) => s.setSection);

  const [keyDraft, setKeyDraft] = useState<ApiKeys>(apiKeys);
  const [savingKeys, setSavingKeys] = useState(false);

  // Fetch all configs on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [tr, rk, ks] = await Promise.all([
          fetch("/api/config/trading").then((r) => r.json()),
          fetch("/api/config/risk").then((r) => r.json()),
          fetch("/api/config/keys").then((r) => r.json()),
        ]);
        if (!mounted) return;
        if (tr?.config) setTradingCfg(tr.config);
        if (rk?.config) setRiskCfg(rk.config);
        if (ks?.keys) {
          setApiKeys(ks.keys);
          setKeyDraft(ks.keys);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setTradingCfg, setRiskCfg, setApiKeys]);

  // --- Trading config helpers ---
  const updateTrading = async (patch: Partial<TradingConfig>) => {
    setTradingCfg(patch);
    try {
      await fetch("/api/config/trading", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      toast.success("Konfigurasi trading disimpan");
    } catch {
      toast.error("Gagal menyimpan konfigurasi");
    }
  };

  const handlePairsChange = (vals: string[]) => {
    updateTrading({ pairs: vals as Pair[] });
  };
  const handleTimeframesChange = (vals: string[]) => {
    updateTrading({ timeframes: vals as Timeframe[] });
  };
  const handleSessionsToggle = (s: Session) => {
    updateTrading({ sessions: toggleInArray(tradingCfg.sessions, s) });
  };

  // --- API keys helpers ---
  const handleKeyChange = (key: keyof ApiKeys, value: string) => {
    setKeyDraft((d) => ({ ...d, [key]: value }));
  };

  const handleActiveProvider = async (provider: ApiKeys["activeProvider"]) => {
    setApiKeys({ activeProvider: provider });
    setKeyDraft((d) => ({ ...d, activeProvider: provider }));
    try {
      await fetch("/api/config/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeProvider: provider }),
      });
      toast.success(`Provider aktif: ${provider}`, {
        description: "Perubahan diterapkan pada MT5 bridge.",
      });
    } catch {
      toast.error("Gagal mengubah provider");
    }
  };

  const handleSaveKeys = async () => {
    setSavingKeys(true);
    try {
      // Send all keyDraft values — backend ignores masked (•) values
      await fetch("/api/config/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keyDraft),
      });
      toast.success("API keys disimpan", {
        description: "Perubahan diterapkan pada MT5 bridge.",
      });
      // Re-fetch to re-mask
      const res = await fetch("/api/config/keys");
      const data = await res.json();
      if (data?.keys) {
        setApiKeys(data.keys);
        setKeyDraft(data.keys);
      }
    } catch {
      toast.error("Gagal menyimpan keys");
    } finally {
      setSavingKeys(false);
    }
  };

  // --- MT5 connect ---
  const handleMt5Connect = async () => {
    try {
      const res = await fetch("/api/mt5/connect", { method: "POST" });
      const data = await res.json();
      if (data?.account) {
        setAccount(data.account);
        toast.success("MT5 Terhubung", {
          description: `Login ${data.account.login} @ ${data.account.server}`,
        });
      }
    } catch {
      toast.error("Gagal menyambungkan MT5");
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Pengaturan Sistem"
        description="Konfigurasi broker, AI provider, pair/sesi/timeframe, dan API keys."
        icon={<SettingsIcon className="h-4 w-4" />}
      />

      <Tabs defaultValue="trading" className="w-full">
        <TabsList className="h-auto w-full justify-start overflow-x-auto p-1">
          <TabsTrigger value="trading">Trading</TabsTrigger>
          <TabsTrigger value="ai">AI Provider</TabsTrigger>
          <TabsTrigger value="broker">Broker / MT5</TabsTrigger>
          <TabsTrigger value="risk">Risiko</TabsTrigger>
        </TabsList>

        {/* ============ Trading Tab ============ */}
        <TabsContent value="trading" className="space-y-5">
          <Panel
            title="Pair Aktif"
            description="Pilih pasangan mata uang yang dipantau dan diperdagangkan"
          >
            <ToggleGroup
              type="multiple"
              value={tradingCfg.pairs as string[]}
              onValueChange={handlePairsChange}
              variant="outline"
              className="flex w-full flex-wrap"
            >
              {PAIRS.map((p) => (
                <ToggleGroupItem
                  key={p.symbol}
                  value={p.symbol}
                  className="m-0.5 flex-1 px-3"
                  aria-label={p.symbol}
                >
                  {p.symbol}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="tnum text-foreground">{tradingCfg.pairs.length}</span>{" "}
              pair dipilih · <span className="tnum">{PAIRS.length}</span> total tersedia
            </p>
          </Panel>

          <Panel
            title="Timeframe"
            description="Pilih timeframe untuk analisis & scalping"
          >
            <ToggleGroup
              type="multiple"
              value={tradingCfg.timeframes as string[]}
              onValueChange={handleTimeframesChange}
              variant="outline"
              className="flex w-full flex-wrap"
            >
              {TIMEFRAMES.map((t) => (
                <ToggleGroupItem
                  key={t.value}
                  value={t.value}
                  className="m-0.5 flex-1 px-3"
                  aria-label={t.value}
                >
                  {t.value}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="tnum text-foreground">
                {tradingCfg.timeframes.length}
              </span>{" "}
              timeframe dipilih
            </p>
          </Panel>

          <Panel
            title="Sesi Trading"
            description="Sesi pasar yang aktif untuk eksekusi (waktu UTC)"
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SESSIONS.map((s) => {
                const active = tradingCfg.sessions.includes(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => handleSessionsToggle(s.value)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card hover:bg-accent"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.label}</div>
                      <div className="text-[10px] text-muted-foreground tnum">
                        {String(s.utcStart).padStart(2, "0")}:00–
                        {String(s.utcEnd).padStart(2, "0")}:00 UTC
                      </div>
                    </div>
                    {active && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="Aturan & Mode Otomatis"
            description="Pengaturan eksekusi & auto-mode"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleRow
                icon={<Calendar className="h-4 w-4 text-amber-400" />}
                title="Hindari Akhir Pekan"
                desc="Skip trading Sabtu/Minggu"
                checked={tradingCfg.avoidWeekends}
                onChange={(v) => updateTrading({ avoidWeekends: v })}
              />
              <ToggleRow
                icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}
                title="Trailing Stop Auto"
                desc="Otomatis geser SL mengikuti harga"
                checked={tradingCfg.trailingAuto}
                onChange={(v) => updateTrading({ trailingAuto: v })}
              />
              <ToggleRow
                icon={<Activity className="h-4 w-4 text-violet-400" />}
                title="Indikator Auto"
                desc="Optimasi parameter indikator otomatis"
                checked={tradingCfg.indicatorAuto}
                onChange={(v) => updateTrading({ indicatorAuto: v })}
              />
              <ToggleRow
                icon={<ShieldAlert className="h-4 w-4 text-rose-400" />}
                title="Risk Auto"
                desc="Penyesuaian parameter risiko otomatis"
                checked={tradingCfg.riskAuto}
                onChange={(v) => updateTrading({ riskAuto: v })}
              />
            </div>
          </Panel>
        </TabsContent>

        {/* ============ AI Provider Tab ============ */}
        <TabsContent value="ai" className="space-y-5">
          <Panel
            title="Provider Aktif"
            description="Pilih AI provider untuk analisis pasar"
          >
            <RadioGroup
              value={apiKeys.activeProvider}
              onValueChange={(v) =>
                handleActiveProvider(v as ApiKeys["activeProvider"])
              }
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              {AI_PROVIDERS.map((p) => {
                const checked = apiKeys.activeProvider === p.key;
                return (
                  <label
                    key={p.key}
                    htmlFor={`prov-${p.key}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      checked
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <RadioGroupItem
                      id={`prov-${p.key}`}
                      value={p.key}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{p.label}</span>
                        {p.key === "zai" && (
                          <Pill tone="accent" className="gap-1">
                            <Sparkles className="h-3 w-3" /> Default
                          </Pill>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{p.note}</p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </Panel>

          <Panel
            title="API Keys"
            description="Isi key pada mesin Windows (MT5 bridge). Nilai dikirim dengan aman."
            actions={
              <Button size="sm" onClick={handleSaveKeys} disabled={savingKeys}>
                <Save className="h-3.5 w-3.5" />
                {savingKeys ? "Menyimpan..." : "Simpan Keys"}
              </Button>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              {PROVIDER_KEYS.map((p) => (
                <KeyInput
                  key={p.key}
                  id={`key-${p.key}`}
                  label={p.label}
                  hint={p.hint}
                  value={keyDraft[p.key]}
                  stored={apiKeys[p.key]}
                  onChange={(v) => handleKeyChange(p.key, v)}
                />
              ))}
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Market Data Integrations
              </h4>
              <div className="grid gap-4 md:grid-cols-2">
                <KeyInput
                  id="key-finnhub"
                  label="Finnhub API Key"
                  hint="Real-time market data & news"
                  value={keyDraft.finnhub}
                  stored={apiKeys.finnhub}
                  onChange={(v) => handleKeyChange("finnhub", v)}
                />
                <KeyInput
                  id="key-marketaux"
                  label="Marketaux API Key"
                  hint="Berita ekonomi & sentimen pasar"
                  value={keyDraft.marketaux}
                  stored={apiKeys.marketaux}
                  onChange={(v) => handleKeyChange("marketaux", v)}
                />
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-xs">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
              <p>
                <strong className="text-violet-300">Z.ai</strong> adalah provider
                bawaan yang selalu aktif tanpa key. Provider lain membutuhkan API
                key yang diisi pada mesin Windows Anda (MT5 bridge).
              </p>
            </div>
          </Panel>
        </TabsContent>

        {/* ============ Broker / MT5 Tab ============ */}
        <TabsContent value="broker" className="space-y-5">
          <Panel title="Spesifikasi Broker" description={BROKER_SPEC.name}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Leverage" value={BROKER_SPEC.leverageForexMetals} />
              <StatCard
                label="Spread"
                value={BROKER_SPEC.spreadFrom}
                sub="Mulai dari"
              />
              <StatCard label="Komisi" value={BROKER_SPEC.commission} />
              <StatCard
                label="Min Volume"
                value={BROKER_SPEC.minVolume}
                sub="lot"
              />
              <StatCard
                label="Max Volume / Order"
                value={BROKER_SPEC.maxVolumePerOrder}
                sub="lot"
              />
              <StatCard
                label="Max Open Positions"
                value={BROKER_SPEC.maxOpenPositions}
              />
              <StatCard
                label="Margin Call"
                value={`${BROKER_SPEC.marginCall}%`}
                tone="warn"
              />
              <StatCard
                label="Stop Out"
                value={`${BROKER_SPEC.stopOut}%`}
                tone="down"
              />
            </div>
          </Panel>

          <Panel
            title="Koneksi MT5"
            description="Status bridge ke MetaTrader 5"
            actions={
              account.mt5Connected ? (
                <Badge
                  variant="outline"
                  className="gap-1.5 border-emerald-500/40 text-emerald-400"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 live-dot" />
                  Terhubung
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Off
                </Badge>
              )
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Status Koneksi</span>
                </div>
                <div className="rounded-lg border border-border bg-card/60 p-3 text-sm">
                  {account.mt5Connected ? (
                    <div className="space-y-1.5">
                      <KVRow k="Broker" v={account.broker} />
                      <KVRow k="Login" v={account.login ?? "—"} mono />
                      <KVRow k="Server" v={account.server ?? "—"} />
                      <KVRow k="Leverage" v={account.leverage} mono />
                      <KVRow k="Currency" v={account.currency} mono />
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-2">
                      <p className="text-xs text-muted-foreground">
                        Bridge MT5 belum terhubung. Klik di bawah untuk
                        menyambungkan (simulasi sandbox).
                      </p>
                      <Button size="sm" onClick={handleMt5Connect}>
                        <Link2 className="h-3.5 w-3.5" />
                        Sambungkan MT5
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Info Akun</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="Balance" value={`$${formatMoney(account.balance)}`} />
                  <MiniStat label="Equity" value={`$${formatMoney(account.equity)}`} />
                  <MiniStat
                    label="Free Margin"
                    value={`$${formatMoney(account.freeMargin)}`}
                  />
                  <MiniStat
                    label="Margin Used"
                    value={`$${formatMoney(account.margin)}`}
                  />
                  <MiniStat
                    label="Daily Loss Used"
                    value={`${account.dailyLossUsed.toFixed(2)}%`}
                    tone="down"
                  />
                  <MiniStat
                    label="Daily Loss Limit"
                    value={`${account.dailyLossLimit}%`}
                    tone="warn"
                  />
                </div>
              </div>
            </div>
          </Panel>
        </TabsContent>

        {/* ============ Risk Tab ============ */}
        <TabsContent value="risk" className="space-y-5">
          <Panel
            title="Ringkasan Risiko"
            description="Konfigurasi risk management (read-only di sini)"
            actions={
              <Button size="sm" onClick={() => setSection("risk")}>
                <ShieldAlert className="h-3.5 w-3.5" />
                Buka Risk Management
              </Button>
            }
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <StatCard label="Risk / Trade" value={`${riskCfg.riskPerTrade}%`} />
              <StatCard label="R:R Ratio" value={riskCfg.rrRatio} />
              <StatCard
                label="Max Open Positions"
                value={riskCfg.maxOpenPositions}
              />
              <StatCard
                label="SL Pips Min"
                value={riskCfg.stopLossPipsMin}
              />
              <StatCard label="SL Pips Max" value={riskCfg.stopLossPipsMax} />
              <StatCard
                label="Daily Loss Limit"
                value={`${riskCfg.dailyLossLimit}%`}
                tone="down"
              />
              <StatCard
                label="Daily Target"
                value={`${riskCfg.dailyTarget}%`}
                tone="up"
              />
              <StatCard
                label="Avoid High-Impact News"
                value={riskCfg.avoidHighImpactNews ? "Yes" : "No"}
                tone={riskCfg.avoidHighImpactNews ? "warn" : "default"}
              />
              <StatCard
                label="Risk Auto"
                value={riskCfg.autoMode ? "On" : "Off"}
                tone={riskCfg.autoMode ? "accent" : "default"}
              />
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card/40 p-3 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 shrink-0" />
              <span>
                Untuk mengubah nilai, buka halaman{" "}
                <span className="text-foreground">Risk Management</span>.
              </span>
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Sub-components ----

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

function KeyInput({
  id,
  label,
  hint,
  value,
  stored,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  stored: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onFocus={(e) => {
          if (e.target.value.includes("•")) onChange("");
        }}
        onChange={(e) => onChange(e.target.value)}
        placeholder={stored ? "••••••••" : "Masukkan API key..."}
        autoComplete="off"
      />
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function KVRow({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className={`text-xs font-medium ${mono ? "tnum" : ""}`}>{v}</span>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "warn";
}) {
  const toneCls =
    tone === "up"
      ? "text-emerald-400"
      : tone === "down"
        ? "text-rose-400"
        : tone === "warn"
          ? "text-amber-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`tnum text-sm font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}
