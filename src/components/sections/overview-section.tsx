"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Bot,
  Clock,
  LayoutDashboard,
  Loader2,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { useStore } from "@/lib/store";
import { PAIRS, SESSIONS } from "@/lib/constants";
import { activeSessions, equityCurve } from "@/lib/market";
import type { LogRow, Pair, Quote, TradeRow } from "@/lib/types";

import {
  EmptyState,
  LiveDot,
  Panel,
  Pill,
  SectionHeader,
  StatCard,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const fmtUsd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const meta = (s: Pair) => PAIRS.find((p) => p.symbol === s)!;
const fmtPrice = (s: Pair, v: number | null | undefined) =>
  v == null ? "—" : v.toFixed(meta(s).digits);
const pipValue = (_s: Pair) => 10; // $10/pip/lot for all pairs (FX & XAUUSD)

function livePnl(trade: TradeRow, quotes: Record<Pair, Quote>) {
  const q = quotes[trade.symbol];
  if (!q) return { pips: trade.pips ?? 0, pnl: trade.pnl ?? 0 };
  const m = meta(trade.symbol);
  const pipsRaw =
    trade.side === "BUY"
      ? (q.bid - trade.openPrice) / m.pipSize
      : (trade.openPrice - q.ask) / m.pipSize;
  const pips = +pipsRaw.toFixed(1);
  const pnl = +(pips * pipValue(trade.symbol) * trade.lotSize).toFixed(2);
  return { pips, pnl };
}

const LOG_LEVEL_TONE: Record<
  LogRow["level"],
  "default" | "up" | "down" | "warn" | "accent"
> = {
  INFO: "default",
  WARN: "warn",
  ERROR: "down",
  TRADE: "up",
  AI: "accent",
};

export function OverviewSection() {
  const account = useStore((s) => s.account);
  const quotes = useStore((s) => s.quotes);
  const trades = useStore((s) => s.trades);
  const setTrades = useStore((s) => s.setTrades);
  const upsertTrade = useStore((s) => s.upsertTrade);
  const addLog = useStore((s) => s.addLog);

  const [curve, setCurve] = useState<{ t: number; v: number }[]>([]);
  const [sessions, setSessions] = useState(activeSessions());
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [closing, setClosing] = useState<string | null>(null);

  // Generate equity curve once on mount (and when balance materially changes)
  useEffect(() => {
    setCurve(equityCurve(60, account.balance));
  }, [account.balance]);

  // Tick sessions every second
  useEffect(() => {
    const id = setInterval(() => setSessions(activeSessions()), 1000);
    return () => clearInterval(id);
  }, []);

  // Initial fetch trades + logs (fetch list once; P&L computed client-side)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [tl, lg] = await Promise.all([
          fetch("/api/trade/list").then((r) => r.json()),
          fetch("/api/logs?limit=8").then((r) => r.json()),
        ]);
        if (!mounted) return;
        if (tl?.trades) setTrades(tl.trades as TradeRow[]);
        if (lg?.logs) setLogs(lg.logs as LogRow[]);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setTrades]);

  const openTrades = useMemo(
    () => trades.filter((t) => t.status === "OPEN"),
    [trades],
  );

  const dayPnl = useMemo(
    () => openTrades.reduce((sum, t) => sum + livePnl(t, quotes).pnl, 0),
    [openTrades, quotes],
  );

  const handleClose = useCallback(
    async (id: string) => {
      setClosing(id);
      try {
        const res = await fetch("/api/trade/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Gagal menutup posisi");
        const closed = data.trade as TradeRow;
        upsertTrade(closed);
        addLog({
          id: Math.random().toString(36).slice(2),
          level: "TRADE",
          source: "DASHBOARD",
          message: `Posisi ${closed.symbol} ditutup @ ${closed.closePrice} | PnL ${closed.pnl >= 0 ? "+" : ""}${closed.pnl}`,
          createdAt: new Date().toISOString(),
        });
        toast.success("Posisi ditutup", {
          description: `PnL: ${closed.pnl >= 0 ? "+" : ""}$${closed.pnl.toFixed(2)}`,
        });
      } catch (e) {
        toast.error("Gagal menutup posisi", {
          description: e instanceof Error ? e.message : undefined,
        });
      } finally {
        setClosing(null);
      }
    },
    [upsertTrade, addLog],
  );

  const isWeekend = (() => {
    const d = new Date().getUTCDay();
    return d === 0 || d === 6;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      <SectionHeader
        title="Dashboard Operasional"
        description="Pemantauan real-time akun FINEX Indonesia: equity, market, sesi trading & posisi terbuka."
        icon={<LayoutDashboard className="h-5 w-5" />}
        actions={
          <LiveDot
            active={account.mt5Connected}
            label={account.mt5Connected ? "MT5 Live" : "MT5 Off"}
          />
        }
      />

      {/* Top stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Balance"
          value={<span className="tnum">{fmtUsd(account.balance)}</span>}
          sub={`${account.currency} · ${account.broker}`}
          tone="default"
          icon={<Wallet className="h-4 w-4" />}
        />
        <StatCard
          label="Equity"
          value={<span className="tnum">{fmtUsd(account.equity)}</span>}
          sub={`Margin terpakai: ${fmtUsd(account.margin)}`}
          tone={account.equity >= account.balance ? "up" : "down"}
          icon={<BadgeDollarSign className="h-4 w-4" />}
        />
        <StatCard
          label="Free Margin"
          value={<span className="tnum">{fmtUsd(account.freeMargin)}</span>}
          sub={
            account.marginLevel > 0
              ? `Level: ${account.marginLevel.toFixed(1)}%`
              : "Level: —"
          }
          tone="accent"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Day P&L"
          value={
            <span
              className={cn(
                "tnum",
                dayPnl >= 0 ? "text-emerald-400" : "text-rose-400",
              )}
            >
              {dayPnl >= 0 ? "+" : ""}
              {fmtUsd(dayPnl)}
            </span>
          }
          sub={`${openTrades.length} posisi terbuka`}
          tone={dayPnl >= 0 ? "up" : "down"}
          icon={
            dayPnl >= 0 ? (
              <ArrowUpRight className="h-4 w-4" />
            ) : (
              <ArrowDownRight className="h-4 w-4" />
            )
          }
        />
      </div>

      {/* Equity curve + Market watch */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel
          title="Equity Curve"
          description="Perjalanan equity 60 jam terakhir"
          className="lg:col-span-2"
          bodyClassName="p-2 sm:p-4"
        >
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={curve}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: "oklch(0.7 0.015 155)" }}
                  tickFormatter={(t) =>
                    new Date(t).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  }
                  minTickGap={40}
                  stroke="rgba(255,255,255,0.1)"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "oklch(0.7 0.015 155)" }}
                  tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(1)}k`}
                  width={50}
                  stroke="rgba(255,255,255,0.1)"
                />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.205 0.014 165)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(t) =>
                    new Date(Number(t)).toLocaleString("id-ID")
                  }
                  formatter={(v) => [fmtUsd(Number(v)), "Equity"]}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="#34d399"
                  strokeWidth={2}
                  fill="url(#eqGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Market Watch" description="Harga live · 4 pair utama">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Symbol</TableHead>
                <TableHead className="text-xs text-right">Bid / Ask</TableHead>
                <TableHead className="text-xs text-right">Spread</TableHead>
                <TableHead className="text-xs text-right">Chg%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PAIRS.map((p) => {
                const q = quotes[p.symbol];
                if (!q) {
                  return (
                    <TableRow key={p.symbol}>
                      <TableCell className="font-medium">{p.symbol}</TableCell>
                      <TableCell
                        className="text-right text-xs text-muted-foreground"
                        colSpan={3}
                      >
                        menunggu data…
                      </TableCell>
                    </TableRow>
                  );
                }
                return (
                  <TableRow key={p.symbol}>
                    <TableCell>
                      <div className="font-medium">{p.symbol}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.label}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="tnum text-xs">
                        <span className="text-rose-400">
                          {q.bid.toFixed(p.digits)}
                        </span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-emerald-400">
                          {q.ask.toFixed(p.digits)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tnum text-xs">
                      {q.spreadPips.toFixed(1)}p
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tnum text-xs font-medium",
                        q.changePct >= 0
                          ? "text-emerald-400"
                          : "text-rose-400",
                      )}
                    >
                      {q.changePct >= 0 ? "+" : ""}
                      {q.changePct.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      </div>

      {/* Trading sessions */}
      <Panel
        title="Sesi Trading Aktif"
        description="Sesi pasar forex berdasarkan waktu UTC"
        actions={
          isWeekend ? (
            <Pill tone="warn">
              <AlertTriangle className="h-3 w-3" /> Weekend — pasar tipis
            </Pill>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {SESSIONS.map((s, i) => {
            const active = sessions[i]?.active ?? false;
            return (
              <div
                key={s.value}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  active
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border bg-secondary/30 opacity-60",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium leading-tight">
                    {s.label}
                  </span>
                  <LiveDot active={active} />
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground tnum">
                  {String(s.utcStart).padStart(2, "0")}:00 –{" "}
                  {String(s.utcEnd).padStart(2, "0")}:00 UTC
                </div>
                <div className="mt-2">
                  {active ? (
                    <Pill tone="up">
                      <Activity className="h-3 w-3" /> Aktif
                    </Pill>
                  ) : (
                    <Pill>Tutup</Pill>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Open positions */}
      <Panel
        title="Posisi Terbuka"
        description={`${openTrades.length} posisi aktif · P&L dihitung live dari harga market`}
      >
        {openTrades.length === 0 ? (
          <EmptyState
            icon={<Bot className="h-8 w-8" />}
            title="Belum ada posisi terbuka"
            description="Posisi manual maupun AI akan muncul di sini secara real-time."
          />
        ) : (
          <ScrollArea className="max-h-96 scroll-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Symbol</TableHead>
                  <TableHead className="text-xs">Side</TableHead>
                  <TableHead className="text-xs text-right">Lot</TableHead>
                  <TableHead className="text-xs text-right">Entry</TableHead>
                  <TableHead className="text-xs text-right">SL</TableHead>
                  <TableHead className="text-xs text-right">TP</TableHead>
                  <TableHead className="text-xs text-right">P&L</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openTrades.map((t) => {
                  const { pips, pnl } = livePnl(t, quotes);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.symbol}</TableCell>
                      <TableCell>
                        {t.side === "BUY" ? (
                          <Pill tone="up">
                            <ArrowUpRight className="h-3 w-3" /> BUY
                          </Pill>
                        ) : (
                          <Pill tone="down">
                            <ArrowDownRight className="h-3 w-3" /> SELL
                          </Pill>
                        )}
                      </TableCell>
                      <TableCell className="text-right tnum text-xs">
                        {t.lotSize.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tnum text-xs">
                        {fmtPrice(t.symbol, t.openPrice)}
                      </TableCell>
                      <TableCell className="text-right tnum text-xs">
                        {fmtPrice(t.symbol, t.stopLoss)}
                      </TableCell>
                      <TableCell className="text-right tnum text-xs">
                        {fmtPrice(t.symbol, t.takeProfit)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tnum text-xs font-medium",
                          pnl >= 0 ? "text-emerald-400" : "text-rose-400",
                        )}
                      >
                        {pnl >= 0 ? "+" : ""}
                        {fmtUsd(pnl)}
                        <div className="text-[10px] opacity-70">
                          {pips >= 0 ? "+" : ""}
                          {pips}p
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={closing === t.id}
                          onClick={() => handleClose(t.id)}
                        >
                          {closing === t.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          Tutup
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </Panel>

      {/* Recent activity */}
      <Panel
        title="Aktivitas Terbaru"
        description="8 log terakhir dari sistem"
      >
        {logs.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-8 w-8" />}
            title="Belum ada aktivitas"
            description="Log trade, AI, dan sistem akan muncul di sini."
          />
        ) : (
          <ol className="relative space-y-3 border-l border-border pl-4">
            {logs.map((l) => (
              <li key={l.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-card",
                    l.level === "ERROR"
                      ? "bg-rose-500"
                      : l.level === "WARN"
                        ? "bg-amber-500"
                        : l.level === "TRADE"
                          ? "bg-emerald-500"
                          : l.level === "AI"
                            ? "bg-violet-500"
                            : "bg-muted-foreground",
                  )}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={LOG_LEVEL_TONE[l.level]}>{l.level}</Pill>
                  <span className="text-[11px] text-muted-foreground">
                    {l.source}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground tnum">
                    {new Date(l.createdAt).toLocaleTimeString("id-ID", {
                      hour12: false,
                    })}
                  </span>
                </div>
                <p className="mt-1 text-sm">{l.message}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </motion.div>
  );
}

export default OverviewSection;
