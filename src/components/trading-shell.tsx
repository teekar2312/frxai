"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CandlestickChart,
  Gauge,
  LayoutDashboard,
  History,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { useStore, type SectionKey } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/shared";
import { activeSessions } from "@/lib/market";
import { PAIRS } from "@/lib/constants";
import type { Pair } from "@/lib/types";
import { livePnl } from "@/lib/format";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { Skeleton } from "@/components/ui/skeleton";

// H5: Code-split sections — only the active section's JS loads
const OverviewSection = dynamic(() => import("@/components/sections/overview-section").then((m) => m.OverviewSection), { loading: () => <SectionSkeleton /> });
const AiSection = dynamic(() => import("@/components/sections/ai-section").then((m) => m.AiSection), { loading: () => <SectionSkeleton /> });
const TradingSection = dynamic(() => import("@/components/sections/trading-section").then((m) => m.TradingSection), { loading: () => <SectionSkeleton /> });
const IndicatorsSection = dynamic(() => import("@/components/sections/indicators-section").then((m) => m.IndicatorsSection), { loading: () => <SectionSkeleton /> });
const RiskSection = dynamic(() => import("@/components/sections/risk-section").then((m) => m.RiskSection), { loading: () => <SectionSkeleton /> });
const BacktestSection = dynamic(() => import("@/components/sections/backtest-section").then((m) => m.BacktestSection), { loading: () => <SectionSkeleton /> });
const AlertsSection = dynamic(() => import("@/components/sections/alerts-section").then((m) => m.AlertsSection), { loading: () => <SectionSkeleton /> });
const LogsSection = dynamic(() => import("@/components/sections/logs-section").then((m) => m.LogsSection), { loading: () => <SectionSkeleton /> });
const SettingsSection = dynamic(() => import("@/components/sections/settings-section").then((m) => m.SettingsSection), { loading: () => <SectionSkeleton /> });

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
import { Moon, Sun } from "lucide-react";

const NAV: { key: SectionKey; label: string; icon: typeof Activity }[] = [
  { key: "overview", label: "Dashboard", icon: LayoutDashboard },
  { key: "ai", label: "AI Analysis", icon: Bot },
  { key: "trading", label: "Trading Terminal", icon: CandlestickChart },
  { key: "indicators", label: "Indicators Lab", icon: SlidersHorizontal },
  { key: "risk", label: "Risk Management", icon: ShieldCheck },
  { key: "backtest", label: "Backtesting", icon: History },
  { key: "alerts", label: "Alerts & Email", icon: Bell },
  { key: "logs", label: "System Logs", icon: AlertTriangle },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

export function TradingShell() {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const account = useStore((s) => s.account);
  const setAccount = useStore((s) => s.setAccount);
  const setQuote = useStore((s) => s.setQuote);
  const quotes = useStore((s) => s.quotes);
  const tradingCfg = useStore((s) => s.tradingCfg);
  const setTradingCfg = useStore((s) => s.setTradingCfg);
  const pushToast = useStore((s) => s.pushToast);
  // C1: reactive trades subscription for accurate Day P&L
  const trades = useStore((s) => s.trades);
  // H9: populate trades + riskCfg once in shell (sections read from store)
  const setTrades = useStore((s) => s.setTrades);
  const setRiskCfg = useStore((s) => s.setRiskCfg);
  // C2: visibility ref for pausing polls when tab is hidden
  const isVisibleRef = useRef(true);

  // Hydration fix: initialize as null, set after mount to avoid SSR/CSR mismatch
  const [clock, setClock] = useState<Date | null>(null);
  const [sessions, setSessions] = useState<{ label: string; active: boolean }[]>([]);
  const { theme, setTheme } = useTheme();

  // C2: Track document visibility — pause all polls when tab is hidden
  useEffect(() => {
    const onVis = () => { isVisibleRef.current = !document.hidden; };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Live market data polling (simulated ticks) — C2: skip when tab hidden
  useEffect(() => {
    let mounted = true;
    async function tick() {
      if (!isVisibleRef.current) return; // C2: skip when backgrounded
      try {
        const res = await fetch("/api/market");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        for (const q of data.quotes as any[]) {
          setQuote(q);
        }
      } catch {
        /* ignore */
      }
    }
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [setQuote]);

  // Clock + sessions — initialize on mount, then update every second
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock(now);
      setSessions(activeSessions(now));
    };
    updateClock(); // set immediately on mount
    const id = setInterval(updateClock, 1000);
    return () => clearInterval(id);
  }, []);

  // H9: Initial data load — populate trades + riskCfg into store so
  // sections don't re-fetch the same endpoints
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [acc, cfg, risk, tradeList] = await Promise.all([
          fetch("/api/config/account").then((r) => r.json()),
          fetch("/api/config/trading").then((r) => r.json()),
          fetch("/api/config/risk").then((r) => r.json()),
          fetch("/api/trade/list").then((r) => r.json()),
        ]);
        if (!mounted) return;
        if (acc?.account) setAccount(acc.account);
        if (cfg?.config) setTradingCfg(cfg.config);
        if (risk?.config) setRiskCfg(risk.config); // H9: populate store
        if (tradeList?.trades) setTrades(tradeList.trades); // H9: populate store
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setAccount, setTradingCfg, setRiskCfg, setTrades]);

  // Persist autoMode to backend whenever it changes (top-bar switch)
  const toggleAutoMode = useCallback(
    async (v: boolean) => {
      setTradingCfg({ autoMode: v });
      try {
        await fetch("/api/config/trading", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoMode: v }),
        });
        pushToast({
          title: v ? "AI Auto-Trade AKTIF" : "AI Auto-Trade OFF",
          description: v
            ? "Scheduler berjalan tiap 90s: analisa AI + eksekusi sinyal + trailing stop + auto-select indikator + auto-adjust risiko."
            : "Auto-trade dihentikan. Posisi terbuka tetap dipantau.",
        });
      } catch {
        /* ignore */
      }
    },
    [setTradingCfg, pushToast],
  );

  // Auto-trade scheduler: when autoMode is ON, fire /api/auto-trade/tick every 90s
  // C2: skip ticks when tab is hidden
  useEffect(() => {
    if (!tradingCfg.autoMode) return;
    let cancelled = false;
    const runTick = async () => {
      if (cancelled || !isVisibleRef.current) return; // C2: skip when backgrounded
      try {
        const res = await fetch("/api/auto-trade/tick", { method: "POST" });
        const data = await res.json();
        if (data?.result?.executed && data.result.trade) {
          pushToast({
            title: `AI Trade: ${data.result.trade.side} ${data.result.trade.symbol}`,
            description: `${data.result.trade.lotSize} lot @ ${data.result.trade.openPrice} | conf ${data.result.confidence}%`,
          });
        }
      } catch {
        /* ignore — next tick will retry */
      }
    };
    runTick();
    const id = setInterval(runTick, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tradingCfg.autoMode, pushToast]);

  // M14: use a stable selector that returns a number (avoids re-render on
  // every quote tick — the filter only runs when trades array reference changes)
  const openTradeCount = useStore((s) => s.trades.filter((t) => t.status === "OPEN").length);
  useEffect(() => {
    if (openTradeCount === 0) return;
    const id = setInterval(async () => {
      if (!isVisibleRef.current) return; // C2: skip when backgrounded
      try {
        await fetch("/api/trade/trail", { method: "POST" });
      } catch {
        /* ignore */
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [openTradeCount]);

  // H4: Global alert checker — runs every 10s regardless of which section is active
  useEffect(() => {
    const id = setInterval(async () => {
      if (!isVisibleRef.current) return;
      try {
        const res = await fetch("/api/alerts/check", { method: "POST" });
        const data = await res.json();
        if (data?.price?.triggered > 0 || data?.news?.matched > 0) {
          pushToast({
            title: data.price.triggered > 0 ? "Price Alert Triggered" : "News Alert Matched",
            description: `${data.price.triggered + data.news.matched} alert(s) fired.`,
          });
        }
      } catch {
        /* ignore */
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [pushToast]);

  // C1 FIX: use livePnl() to compute real floating P&L from current quotes
  const totalPnl = useMemo(() => {
    return trades
      .filter((t) => t.status === "OPEN")
      .reduce((s, t) => s + livePnl(t, quotes).pnl, 0);
  }, [trades, quotes]);

  const connectMt5 = useCallback(async () => {
    // Navigate the user to Settings → Broker/MT5 to enter credentials.
    // The connect endpoint requires account number + password + server.
    setSection("settings");
    pushToast({
      title: "Masukkan kredensial MT5",
      description: "Buka tab Broker / MT5 di Settings, isi nomor akun + password + server, lalu klik Sambungkan.",
    });
  }, [setSection, pushToast]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">FXQuant AI</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                FINEX Indonesia
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-3 scroll-thin" aria-label="Section navigation">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setSection(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="border-t border-sidebar-border p-3">
            <div className="rounded-lg bg-sidebar-accent/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  MT5 Bridge
                </span>
                <LiveDot active={account.mt5Connected} label={account.mt5Connected ? "Live" : "Off"} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {account.mt5Connected ? `Login ${account.login ?? "—"}` : "Belum terhubung"}
              </div>
              {!account.mt5Connected && (
                <Button size="sm" className="mt-2 w-full" onClick={connectMt5}>
                  Sambungkan MT5
                </Button>
              )}
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur md:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <TrendingUp className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold">FXQuant AI</span>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <Badge variant="outline" className="gap-1.5">
                <Gauge className="h-3 w-3" />
                {account.leverage}
              </Badge>
              <Badge variant="outline" className="gap-1.5">
                <LiveDot active={account.mt5Connected} />
                {account.mt5Connected ? "MT5 Live" : "MT5 Off"}
              </Badge>
            </div>

            <div className="ml-auto flex items-center gap-3 md:gap-4">
              <div className="hidden text-right sm:block">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Equity
                </div>
                <div className="tnum text-sm font-semibold">
                  ${account.equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="hidden text-right sm:block">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Day P&L
                </div>
                <div className={cn("tnum text-sm font-semibold", totalPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                </div>
              </div>

              <div className="text-right">
                <div className="tnum text-sm font-semibold">
                  {clock ? clock.toLocaleTimeString("id-ID", { hour12: false }) : "--:--:--"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {clock ? clock.toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" }) : ""}
                </div>
              </div>

              <div className="hidden items-center gap-1.5 lg:flex">
                {sessions
                  .filter((s) => s.active)
                  .slice(0, 2)
                  .map((s) => (
                    <Badge key={s.label} variant="secondary" className="gap-1">
                      <Activity className="h-3 w-3 text-emerald-400" />
                      {s.label.replace(" + ", "+")}
                    </Badge>
                  ))}
              </div>

              <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1">
                <Bot className="h-3.5 w-3.5 text-violet-400" />
                <span className="text-xs">AI Auto</span>
                <Switch
                  checked={tradingCfg.autoMode}
                  onCheckedChange={(v) => toggleAutoMode(v)}
                />
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                <Sun className="size-4 dark:hidden" />
                <Moon className="hidden size-4 dark:block" />
              </Button>
            </div>
          </header>

          {/* Mobile nav */}
          <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5 md:hidden scroll-thin" aria-label="Section navigation">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setSection(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Section content */}
          <main className="terminal-grid flex-1 px-4 py-5 md:px-6">
            <div className="mx-auto max-w-[1500px]">
              {section === "overview" && <OverviewSection />}
              {section === "ai" && <AiSection />}
              {section === "trading" && <TradingSection />}
              {section === "indicators" && <IndicatorsSection />}
              {section === "risk" && <RiskSection />}
              {section === "backtest" && <BacktestSection />}
              {section === "alerts" && <AlertsSection />}
              {section === "logs" && <LogsSection />}
              {section === "settings" && <SettingsSection />}
            </div>
          </main>

          {/* Footer */}
          <footer className="mt-auto border-t border-border bg-card/50 px-4 py-2.5 md:px-6">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <span>FXQuant AI Terminal</span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">FINEX Indonesia · Leverage 1:500</span>
              </div>
              <div className="flex items-center gap-3">
                <LiveDot label="Market feed simulated" />
                <span className="hidden sm:inline">Risk warning: trading forex berisiko tinggi</span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
