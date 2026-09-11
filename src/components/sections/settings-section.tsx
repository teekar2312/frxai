"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LogOut,
  PlugZap,
  RefreshCw,
  Save,
  Server,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  // H3: load error state + retry
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // H2: debounce timer ref for updateTrading
  const tradingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // MT5 credentials state
  interface Mt5Creds {
    mt5Account: string;
    mt5Password: string;
    mt5Server: string;
    mt5AccountType: "demo" | "real";
    mt5Terminal: string;
    hasPassword: boolean;
  }
  const [mt5Creds, setMt5Creds] = useState<Mt5Creds>({
    mt5Account: "",
    mt5Password: "",
    mt5Server: "FINEX-Live01",
    mt5AccountType: "demo",
    mt5Terminal: "MetaTrader5",
    hasPassword: false,
  });
  const [mt5Connecting, setMt5Connecting] = useState(false);
  const [showMt5Password, setShowMt5Password] = useState(false);

  // MT5 terminal app state
  interface Mt5Terminal {
    path: string;
    running: boolean;
    pid: number | null;
    autoStart: boolean;
  }
  const [mt5Terminal, setMt5Terminal] = useState<Mt5Terminal>({
    path: "",
    running: false,
    pid: null,
    autoStart: true,
  });
  const [terminalBusy, setTerminalBusy] = useState(false);

  // Fetch all configs on mount — H3: show error + retry on failure
  const loadConfigs = useCallback(async () => {
    setLoadError(false);
    try {
      const [tr, rk, ks, mt5] = await Promise.all([
        fetch("/api/config/trading").then((r) => r.json()),
        fetch("/api/config/risk").then((r) => r.json()),
        fetch("/api/config/keys").then((r) => r.json()),
        fetch("/api/mt5/credentials").then((r) => r.json()),
      ]);
      if (tr?.config) setTradingCfg(tr.config);
      if (rk?.config) setRiskCfg(rk.config);
      if (ks?.keys) {
        setApiKeys(ks.keys);
        setKeyDraft(ks.keys);
      }
      if (mt5?.credentials) {
        setMt5Creds({
          mt5Account: mt5.credentials.mt5Account ?? "",
          mt5Password: mt5.credentials.mt5Password ?? "",
          mt5Server: mt5.credentials.mt5Server ?? "FINEX-Live01",
          mt5AccountType: mt5.credentials.mt5AccountType ?? "demo",
          mt5Terminal: mt5.credentials.mt5Terminal ?? "MetaTrader5",
          hasPassword: mt5.credentials.hasPassword ?? false,
        });
      }
      if (mt5?.terminal) {
        setMt5Terminal({
          path: mt5.terminal.path ?? "",
          running: mt5.terminal.running ?? false,
          pid: mt5.terminal.pid ?? null,
          autoStart: mt5.terminal.autoStart ?? true,
        });
      }
      setLoaded(true);
    } catch {
      setLoadError(true);
      toast.error("Gagal memuat konfigurasi", {
        description: "Periksa koneksi server lalu coba lagi.",
      });
    }
  }, [setTradingCfg, setRiskCfg, setApiKeys]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // --- Trading config helpers ---
  // H1: optimistic update with rollback + H2: debounce 300ms
  const updateTrading = useCallback(async (patch: Partial<TradingConfig>) => {
    const prev = useStore.getState().tradingCfg;
    setTradingCfg(patch); // optimistic
    // H2: debounce the PUT to prevent race on rapid toggles
    if (tradingDebounceRef.current) clearTimeout(tradingDebounceRef.current);
    tradingDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/config/trading", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("PUT failed");
        toast.success("Konfigurasi trading disimpan");
      } catch {
        // H1: rollback to previous state
        setTradingCfg(prev);
        toast.error("Gagal menyimpan konfigurasi", {
          description: "Perubahan dikembalikan ke nilai sebelumnya.",
        });
      }
    }, 300);
  }, [setTradingCfg]);

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

  // H1: optimistic rollback + M3: key-presence check
  const handleActiveProvider = async (provider: ApiKeys["activeProvider"]) => {
    if (provider !== "zai") {
      // M3: check that the selected provider has a key
      const keyVal = keyDraft[provider as keyof ApiKeys] as string;
      if (!keyVal || keyVal.includes("•")) {
        toast.error(`API key untuk ${provider} belum diisi`, {
          description: `Isi key ${provider} di bawah, simpan, lalu aktifkan provider.`,
        });
        return;
      }
    }
    const prev = useStore.getState().apiKeys;
    setApiKeys({ activeProvider: provider });
    setKeyDraft((d) => ({ ...d, activeProvider: provider }));
    try {
      const res = await fetch("/api/config/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeProvider: provider }),
      });
      if (!res.ok) throw new Error("PUT failed");
      toast.success(`Provider aktif: ${provider}`, {
        description: "Perubahan diterapkan pada MT5 bridge.",
      });
    } catch {
      setApiKeys(prev); // H1: rollback
      setKeyDraft((d) => ({ ...d, activeProvider: prev.activeProvider }));
      toast.error("Gagal mengubah provider");
    }
  };

  const handleSaveKeys = async () => {
    setSavingKeys(true);
    const prev = useStore.getState().apiKeys;
    try {
      // Only send fields that have been changed (non-masked, non-empty)
      // This prevents sending masked values that the backend would skip anyway,
      // and makes it clear which keys are actually being updated.
      const payload: Partial<ApiKeys> = {};
      let changedCount = 0;
      for (const k of Object.keys(keyDraft) as (keyof ApiKeys)[]) {
        const v = keyDraft[k];
        if (typeof v === "string") {
          // Only send if it's a real new value (not masked, not empty)
          if (v && !v.includes("•")) {
            (payload as any)[k] = v;
            changedCount++;
          }
        } else {
          (payload as any)[k] = v; // activeProvider
        }
      }

      if (changedCount === 0 && !payload.activeProvider) {
        toast.info("Tidak ada perubahan", {
          description: "Isi field API key dengan nilai baru untuk menyimpan.",
        });
        setSavingKeys(false);
        return;
      }

      const res = await fetch("/api/config/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("PUT failed");
      toast.success("API keys disimpan", {
        description: `${changedCount} key diperbarui permanen di database.`,
      });
      // Re-fetch to re-mask
      const refetchRes = await fetch("/api/config/keys");
      const refetchData = await refetchRes.json();
      if (refetchData?.keys) {
        setApiKeys(refetchData.keys);
        setKeyDraft(refetchData.keys);
      }
    } catch {
      setApiKeys(prev); // H1: rollback
      setKeyDraft(prev);
      toast.error("Gagal menyimpan keys");
    } finally {
      setSavingKeys(false);
    }
  };

  // M2: Standalone save (without connecting) — so user can save creds for later
  const handleSaveMt5Creds = async () => {
    if (!/^\d{4,12}$/.test(mt5Creds.mt5Account)) {
      toast.error("Nomor akun MT5 tidak valid", { description: "Harus 4-12 digit angka." });
      return;
    }
    const pwd = mt5Creds.mt5Password.includes("•") ? "" : mt5Creds.mt5Password;
    // M4: match server validation (min 4 chars) — only if new password entered
    if (pwd && pwd.length < 4) {
      toast.error("Password MT5 minimal 4 karakter");
      return;
    }
    if (!mt5Creds.mt5Server.trim()) {
      toast.error("Server MT5 wajib diisi");
      return;
    }
    try {
      const res = await fetch("/api/mt5/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mt5Account: mt5Creds.mt5Account,
          mt5Password: pwd || undefined,
          mt5Server: mt5Creds.mt5Server,
          mt5AccountType: mt5Creds.mt5AccountType,
          mt5Terminal: mt5Creds.mt5Terminal,
          mt5TerminalPath: mt5Terminal.path,
          mt5AutoStartTerminal: mt5Terminal.autoStart,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success("Kredensial MT5 disimpan", {
        description: "Klik 'Sambungkan MT5' untuk mulai trading.",
      });
    } catch {
      toast.error("Gagal menyimpan kredensial MT5");
    }
  };

  // --- MT5 connect (with credentials) ---
  const handleMt5Connect = async () => {
    // Validate
    if (!/^\d{4,12}$/.test(mt5Creds.mt5Account)) {
      toast.error("Nomor akun MT5 tidak valid", {
        description: "Harus 4-12 digit angka.",
      });
      return;
    }
    const pwd = mt5Creds.mt5Password.includes("•") ? "" : mt5Creds.mt5Password;
    // M4: match server validation (min 4 chars)
    if (pwd && pwd.length < 4) {
      toast.error("Password MT5 minimal 4 karakter");
      return;
    }
    if (!pwd && !mt5Creds.hasPassword) {
      toast.error("Password MT5 wajib diisi");
      return;
    }
    if (!mt5Creds.mt5Server.trim()) {
      toast.error("Server MT5 wajib diisi");
      return;
    }
    setMt5Connecting(true);
    try {
      // 1) Save credentials first
      await fetch("/api/mt5/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mt5Account: mt5Creds.mt5Account,
          mt5Password: pwd || undefined, // don't send masked
          mt5Server: mt5Creds.mt5Server,
          mt5AccountType: mt5Creds.mt5AccountType,
          mt5Terminal: mt5Creds.mt5Terminal,
        }),
      });
      // 2) Connect (bridge reads saved creds)
      const res = await fetch("/api/mt5/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mt5Account: mt5Creds.mt5Account,
          mt5Password: pwd || undefined,
          mt5Server: mt5Creds.mt5Server,
          mt5AccountType: mt5Creds.mt5AccountType,
          mt5Terminal: mt5Creds.mt5Terminal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Gagal menyambungkan MT5");
      }
      if (data?.account) {
        setAccount(data.account);
        toast.success("MT5 Terhubung", {
          description: `Akun ${mt5Creds.mt5Account} @ ${mt5Creds.mt5Server} (${mt5Creds.mt5AccountType})`,
        });
        // refresh terminal status (auto-start may have launched the app)
        refreshTerminalStatus();
      }
    } catch (e) {
      toast.error("Gagal menyambungkan MT5", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setMt5Connecting(false);
    }
  };

  // --- MT5 disconnect ---
  const handleMt5Disconnect = async () => {
    try {
      const res = await fetch("/api/mt5/disconnect", { method: "POST" });
      const data = await res.json();
      if (data?.account) {
        setAccount(data.account);
        toast.info("MT5 Diputus", {
          description: "Kredensial tetap tersimpan untuk reconnect cepat.",
        });
      }
    } catch {
      toast.error("Gagal memutus MT5");
    }
  };

  // --- MT5 terminal: save path + auto-start ---
  const handleTerminalConfigSave = async () => {
    try {
      await fetch("/api/mt5/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mt5TerminalPath: mt5Terminal.path,
          mt5AutoStartTerminal: mt5Terminal.autoStart,
        }),
      });
      toast.success("Konfigurasi terminal disimpan");
    } catch {
      toast.error("Gagal menyimpan konfigurasi terminal");
    }
  };

  // --- MT5 terminal: launch the app ---
  const handleStartTerminal = async () => {
    if (!mt5Terminal.path.trim()) {
      toast.error("Path terminal MT5 belum diisi", {
        description: "Isi path ke terminal64.exe terlebih dahulu, lalu Simpan.",
      });
      return;
    }
    // save path first
    setTerminalBusy(true);
    try {
      await fetch("/api/mt5/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mt5TerminalPath: mt5Terminal.path,
          mt5AutoStartTerminal: mt5Terminal.autoStart,
        }),
      });
      const res = await fetch("/api/mt5/start-terminal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Gagal menjalankan terminal");
      }
      setMt5Terminal((t) => ({ ...t, running: true, pid: data.pid ?? null }));
      toast.success("Terminal MT5 dijalankan", {
        description: data.alreadyRunning
          ? "Terminal sudah berjalan sebelumnya"
          : `PID ${data.pid} · ${mt5Terminal.path}`,
      });
    } catch (e) {
      toast.error("Gagal menjalankan terminal MT5", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setTerminalBusy(false);
    }
  };

  // --- MT5 terminal: stop the app ---
  const handleStopTerminal = async () => {
    setTerminalBusy(true);
    try {
      const res = await fetch("/api/mt5/stop-terminal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error("Gagal menghentikan terminal");
      setMt5Terminal((t) => ({ ...t, running: false, pid: null }));
      // also reflect disconnected account state
      const st = await fetch("/api/config/account").then((r) => r.json());
      if (st?.account) setAccount(st.account);
      toast.info("Terminal MT5 dihentikan", {
        description: "Koneksi bridge juga diputus.",
      });
    } catch (e) {
      toast.error("Gagal menghentikan terminal");
    } finally {
      setTerminalBusy(false);
    }
  };

  // --- MT5 terminal: refresh status ---
  const refreshTerminalStatus = async () => {
    try {
      const res = await fetch("/api/mt5/terminal-status");
      const data = await res.json();
      setMt5Terminal((t) => ({
        ...t,
        running: data.running ?? false,
        pid: data.pid ?? null,
        path: data.path ?? t.path,
        autoStart: data.autoStart ?? t.autoStart,
      }));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Pengaturan Sistem"
        description="Konfigurasi broker, AI provider, pair/sesi/timeframe, dan API keys."
        icon={<SettingsIcon className="h-4 w-4" />}
      />

      {/* H3: Load error with retry */}
      {loadError && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2 text-sm text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            <span>Gagal memuat konfigurasi. Periksa koneksi server.</span>
          </div>
          <Button size="sm" variant="outline" onClick={loadConfigs}>
            <RefreshCw className="h-3.5 w-3.5" /> Coba Lagi
          </Button>
        </div>
      )}

      {/* L4: Loading skeleton */}
      {!loaded && !loadError && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {(loaded || loadError) && (
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
            title="Kredensial Akun MT5"
            description="Masukkan nomor akun, password & server MT5 Anda untuk trading"
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
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Credentials form */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Detail Login MT5</span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mt5-account" className="text-xs">
                    Nomor Akun MT5 <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    id="mt5-account"
                    inputMode="numeric"
                    pattern="\d{4,12}"
                    value={mt5Creds.mt5Account}
                    onChange={(e) =>
                      setMt5Creds((c) => ({
                        ...c,
                        mt5Account: e.target.value.replace(/\D/g, "").slice(0, 12),
                      }))
                    }
                    placeholder="cth: 90123456"
                    autoComplete="off"
                    disabled={account.mt5Connected}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Nomor akun trading MT5 Anda (4-12 digit). Diberikan broker saat registrasi.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mt5-password" className="text-xs">
                    Password MT5 <span className="text-rose-400">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="mt5-password"
                      type={showMt5Password ? "text" : "password"}
                      value={mt5Creds.mt5Password}
                      onFocus={(e) => {
                        if (e.target.value.includes("•")) {
                          setMt5Creds((c) => ({ ...c, mt5Password: "" }));
                        }
                      }}
                      onChange={(e) =>
                        setMt5Creds((c) => ({ ...c, mt5Password: e.target.value }))
                      }
                      placeholder={
                        mt5Creds.hasPassword ? "•••••••• (tersimpan, ketik untuk ganti)" : "Masukkan password MT5..."
                      }
                      autoComplete="off"
                      disabled={account.mt5Connected}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowMt5Password((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={showMt5Password ? "Sembunyikan password" : "Tampilkan password"}
                    >
                      {showMt5Password ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Password master atau investor (read-only). Disimpan lokal di database.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mt5-server" className="text-xs">
                    Server MT5 <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    id="mt5-server"
                    value={mt5Creds.mt5Server}
                    onChange={(e) =>
                      setMt5Creds((c) => ({ ...c, mt5Server: e.target.value }))
                    }
                    placeholder="cth: FINEX-Live01 / FINEX-Demo"
                    autoComplete="off"
                    disabled={account.mt5Connected}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Nama server trading FINEX Indonesia (cek di aplikasi MT5 → File → Open Account).
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tipe Akun</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(["demo", "real"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setMt5Creds((c) => ({ ...c, mt5AccountType: t }))}
                          disabled={account.mt5Connected}
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium uppercase transition-colors ${
                            mt5Creds.mt5AccountType === t
                              ? t === "real"
                                ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : "border-border text-muted-foreground hover:bg-muted/40"
                          }`}
                        >
                          {t === "real" ? "Real" : "Demo"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mt5-terminal" className="text-xs">
                      Terminal
                    </Label>
                    <Input
                      id="mt5-terminal"
                      value={mt5Creds.mt5Terminal}
                      onChange={(e) =>
                        setMt5Creds((c) => ({ ...c, mt5Terminal: e.target.value }))
                      }
                      placeholder="MetaTrader5"
                      autoComplete="off"
                      disabled={account.mt5Connected}
                    />
                  </div>
                </div>

                {mt5Creds.mt5AccountType === "real" && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                    <p className="text-[11px] leading-relaxed text-rose-300/90">
                      <span className="font-semibold">Akun Real.</span> Trading dengan uang sungguhan. Pastikan risk management (0.5-1%/trade, anti-MC 3%) aktif. Mulai dengan lot kecil (0.01).
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {account.mt5Connected ? (
                    <Button variant="destructive" size="sm" onClick={handleMt5Disconnect}>
                      <LogOut className="h-3.5 w-3.5" />
                      Putuskan MT5
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" onClick={handleMt5Connect} disabled={mt5Connecting}>
                        {mt5Connecting ? (
                          <>
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Menghubungkan...
                          </>
                        ) : (
                          <>
                            <PlugZap className="h-3.5 w-3.5" />
                            Sambungkan MT5
                          </>
                        )}
                      </Button>
                      {/* M2: Standalone save without connecting */}
                      <Button size="sm" variant="outline" onClick={handleSaveMt5Creds}>
                        <Save className="h-3.5 w-3.5" />
                        Simpan Kredensial
                      </Button>
                    </>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    Kredensial disimpan lokal & dipakai oleh MT5 bridge di mesin Windows Anda.
                  </span>
                </div>
              </div>

              {/* Status + account info */}
              <div className="space-y-4">
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
                        <KVRow
                          k="Tipe"
                          v={mt5Creds.mt5AccountType === "real" ? "REAL" : "DEMO"}
                        />
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          Belum terhubung. Isi kredensial di kiri lalu klik <span className="text-foreground">Sambungkan MT5</span>.
                        </p>
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
            </div>

            {/* How-to-verify guide */}
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-violet-300">Cara mendapatkan detail akun MT5:</span>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Buka aplikasi <span className="text-foreground">MetaTrader 5</span> di Windows 11 Anda.</li>
                  <li><span className="text-foreground">File → Open Account</span> atau cek email registrasi FINEX Indonesia untuk nomor akun & server.</li>
                  <li>Login di MT5 desktop untuk memastikan server & kredensial benar.</li>
                  <li>Masukkan detail yang sama di form kiri, lalu klik <span className="text-foreground">Sambungkan MT5</span>.</li>
                </ol>
                <p className="mt-2">
                  Dashboard ini berkomunikasi dengan <span className="text-foreground">MT5 Python bridge</span> yang berjalan di mesin Windows Anda (library <code className="rounded bg-muted px-1">MetaTrader5</code>). Bridge membaca kredensial tersimpan untuk eksekusi order otomatis.
                </p>
              </div>
            </div>
          </Panel>

          {/* MT5 Terminal Application Panel */}
          <Panel
            title="Aplikasi Terminal MT5"
            description="Jalankan aplikasi MetaTrader 5 desktop (terminal64.exe) dari dashboard"
            actions={
              <Badge
                variant="outline"
                className={
                  mt5Terminal.running
                    ? "gap-1.5 border-emerald-500/40 text-emerald-400"
                    : "text-muted-foreground"
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${mt5Terminal.running ? "bg-emerald-500 live-dot" : "bg-muted-foreground/50"}`}
                />
                {mt5Terminal.running ? "Berjalan" : "Berhenti"}
              </Badge>
            }
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Config + controls */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Lokasi terminal64.exe</span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mt5-terminal-path" className="text-xs">
                    Path Terminal MT5
                  </Label>
                  <Input
                    id="mt5-terminal-path"
                    value={mt5Terminal.path}
                    onChange={(e) =>
                      setMt5Terminal((t) => ({ ...t, path: e.target.value }))
                    }
                    placeholder='C:\Program Files\MetaTrader 5\terminal64.exe'
                    autoComplete="off"
                    className="tnum text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Path lengkap ke executable terminal MT5 di Windows Anda. Klik kanan shortcut MT5 → Properties → "Target" untuk menyalin.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <PlugZap className="h-4 w-4 text-violet-400" />
                    <div>
                      <div className="text-sm font-medium">Auto-start terminal</div>
                      <div className="text-xs text-muted-foreground">
                        Jalankan terminal otomatis sebelum connect bridge
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={mt5Terminal.autoStart}
                    onCheckedChange={(v) =>
                      setMt5Terminal((t) => ({ ...t, autoStart: v }))
                    }
                    aria-label="Auto-start terminal"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTerminalConfigSave}
                  >
                    <Save className="h-3.5 w-3.5" />
                    Simpan Konfigurasi
                  </Button>
                  {mt5Terminal.running ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleStopTerminal}
                      disabled={terminalBusy}
                    >
                      {terminalBusy ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <LogOut className="h-3.5 w-3.5" />
                      )}
                      Hentikan Terminal
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleStartTerminal}
                      disabled={terminalBusy}
                    >
                      {terminalBusy ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <PlugZap className="h-3.5 w-3.5" />
                      )}
                      Jalankan Terminal
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={refreshTerminalStatus}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Status display */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Status Terminal</span>
                  </div>
                  <div className="rounded-lg border border-border bg-card/60 p-3 text-sm">
                    <div className="space-y-1.5">
                      <KVRow
                        k="Status"
                        v={mt5Terminal.running ? "BERJALAN" : "BERHENTI"}
                      />
                      <KVRow
                        k="PID"
                        v={mt5Terminal.pid != null ? String(mt5Terminal.pid) : "—"}
                        mono
                      />
                      <KVRow
                        k="Path"
                        v={mt5Terminal.path || "— belum dikonfigurasi —"}
                        mono
                      />
                      <KVRow
                        k="Auto-start"
                        v={mt5Terminal.autoStart ? "Aktif" : "Nonaktif"}
                      />
                    </div>
                  </div>
                </div>

                {mt5Terminal.running && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <p className="text-[11px] leading-relaxed text-emerald-300/90">
                      Terminal MT5 berjalan. Bridge Python dapat memanggil{" "}
                      <code className="rounded bg-muted px-1">MetaTrader5.initialize()</code>{" "}
                      lalu{" "}
                      <code className="rounded bg-muted px-1">.login()</code> untuk koneksi akun.
                    </p>
                  </div>
                )}
                {!mt5Terminal.running && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <p className="text-[11px] leading-relaxed text-amber-300/90">
                      Terminal MT5 belum berjalan. Bridge Python tidak dapat terhubung ke MetaTrader 5. Klik{" "}
                      <span className="font-semibold">Jalankan Terminal</span> di kiri.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* How launch works */}
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-violet-300">Cara kerja launch terminal:</span>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Isi path ke <code className="rounded bg-muted px-1">terminal64.exe</code> di Windows 11 Anda (cth: <code className="rounded bg-muted px-1">C:\Program Files\MetaTrader 5\terminal64.exe</code>).</li>
                  <li>Klik <span className="text-foreground">Jalankan Terminal</span> — bridge Python menjalankan <code className="rounded bg-muted px-1">subprocess.Popen([path])</code>.</li>
                  <li>Bridge menunggu <code className="rounded bg-muted px-1">MetaTrader5.initialize(path)</code> sukses, lalu <code className="rounded bg-muted px-1">.login(account, password, server)</code>.</li>
                  <li>Aktifkan <span className="text-foreground">Auto-start</span> agar terminal otomatis dijalankan setiap kali klik "Sambungkan MT5".</li>
                </ol>
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
                value={tradingCfg.riskAuto ? "On" : "Off"}
                tone={tradingCfg.riskAuto ? "accent" : "default"}
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
      )}
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
  const hasStored = stored && stored.length > 0;
  const isMasked = value.includes("•");
  const isChanged = value && !isMasked;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {/* Show saved status */}
        {hasStored && !isChanged && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
            <CheckCircle2 className="size-2.5" />
            Tersimpan
          </span>
        )}
        {isChanged && (
          <span className="text-[10px] text-amber-400">Belum disimpan</span>
        )}
      </div>
      <Input
        id={id}
        type="password"
        value={value}
        onFocus={(e) => {
          // Clear masked value on focus so user can type new key
          if (e.target.value.includes("•")) onChange("");
        }}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasStored ? "•••••••• (tersimpan, klik untuk ganti)" : "Masukkan API key..."}
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
