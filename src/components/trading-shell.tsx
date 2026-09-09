"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { OverviewSection } from "@/components/sections/overview-section";
import { AiSection } from "@/components/sections/ai-section";
import { TradingSection } from "@/components/sections/trading-section";
import { IndicatorsSection } from "@/components/sections/indicators-section";
import { RiskSection } from "@/components/sections/risk-section";
import { BacktestSection } from "@/components/sections/backtest-section";
import { AlertsSection } from "@/components/sections/alerts-section";
import { LogsSection } from "@/components/sections/logs-section";
import { SettingsSection } from "@/components/sections/settings-section";
import { useTheme } from "next-themes";
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

  const [clock, setClock] = useState(new Date());
  const [sessions, setSessions] = useState(activeSessions());
  const { theme, setTheme } = useTheme();

  // Live market data polling (simulated ticks)
  useEffect(() => {
    let mounted = true;
    async function tick() {
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

  // Clock + sessions
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setClock(now);
      setSessions(activeSessions(now));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Initial data load
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [acc, cfg, risk, keys] = await Promise.all([
          fetch("/api/config/account").then((r) => r.json()),
          fetch("/api/config/trading").then((r) => r.json()),
          fetch("/api/config/risk").then((r) => r.json()),
          fetch("/api/config/keys").then((r) => r.json()),
        ]);
        if (!mounted) return;
        if (acc?.account) setAccount(acc.account);
        if (cfg?.config) setTradingCfg(cfg.config);
        // risk & keys handled inside their sections
        void risk;
        void keys;
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setAccount, setTradingCfg]);

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
  useEffect(() => {
    if (!tradingCfg.autoMode) return;
    let cancelled = false;
    const runTick = async () => {
      if (cancelled) return;
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
    // Fire one immediately, then every 90s
    runTick();
    const id = setInterval(runTick, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tradingCfg.autoMode, pushToast]);

  // Trailing-stop poller: every 5s, run trailing pass when there are open trades
  const openTradeCount = useStore((s) => s.trades.filter((t) => t.status === "OPEN").length);
  useEffect(() => {
    if (openTradeCount === 0) return;
    const id = setInterval(async () => {
      try {
        await fetch("/api/trade/trail", { method: "POST" });
      } catch {
        /* ignore */
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [openTradeCount]);

  const totalPnl = useMemo(() => {
    const trades = useStore.getState().trades.filter((t) => t.status === "OPEN");
    return trades.reduce((s, t) => s + (t.pnl || 0), 0);
  }, [quotes]);

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

          <nav className="flex-1 space-y-1 overflow-y-auto p-3 scroll-thin">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setSection(item.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
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
                <div className="tnum text-sm font-semibold tabular-nums">
                  {clock.toLocaleTimeString("id-ID", { hour12: false })}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {clock.toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" })}
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
                aria-label="Toggle theme"
              >
                <Sun className="h-4 w-4 dark:hidden" />
                <Moon className="hidden h-4 w-4 dark:block" />
              </Button>
            </div>
          </header>

          {/* Mobile nav */}
          <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5 md:hidden scroll-thin">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setSection(item.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
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
                <LiveDot active label="Market feed simulated" />
                <span className="hidden sm:inline">Risk warning: trading forex berisiko tinggi</span>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
