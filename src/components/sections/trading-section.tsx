"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart,
  Gauge,
  Info,
  Layers,
  Loader2,
  Percent,
  Send,
  Shield,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { useStore } from "@/lib/store";
import { PAIRS } from "@/lib/constants";
import type { Pair, Quote, RiskConfig, Side, TradeRow } from "@/lib/types";

import {
  EmptyState,
  LiveDot,
  Panel,
  Pill,
  SectionHeader,
  StatCard,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
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
  if (trade.status === "CLOSED")
    return { pips: trade.pips ?? 0, pnl: trade.pnl ?? 0 };
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

interface OrderForm {
  symbol: Pair;
  side: Side;
  lotSize: number;
  slPips: number;
  tpPips: number;
  trailingStop: boolean;
  trailingPips: number;
}

export function TradingSection() {
  const account = useStore((s) => s.account);
  const quotes = useStore((s) => s.quotes);
  const trades = useStore((s) => s.trades);
  const setTrades = useStore((s) => s.setTrades);
  const upsertTrade = useStore((s) => s.upsertTrade);
  const addLog = useStore((s) => s.addLog);
  const tradingCfg = useStore((s) => s.tradingCfg);
  const setTradingCfg = useStore((s) => s.setTradingCfg);
  const riskCfg = useStore((s) => s.riskCfg);
  const setRiskCfg = useStore((s) => s.setRiskCfg);

  const [form, setForm] = useState<OrderForm>({
    symbol: "EURUSD",
    side: "BUY",
    lotSize: 0.01,
    slPips: 8,
    tpPips: 12,
    trailingStop: false,
    trailingPips: 10,
  });
  const [placing, setPlacing] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  // Fetch risk config on mount (use for SL bounds & rrRatio)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/config/risk");
        const data = await res.json();
        if (!mounted || !data?.config) return;
        const cfg = data.config as RiskConfig;
        setRiskCfg(cfg);
        // align SL default to within bounds
        setForm((f) => ({
          ...f,
          slPips: Math.min(
            Math.max(f.slPips, cfg.stopLossPipsMin),
            cfg.stopLossPipsMax,
          ),
          tpPips: +(
            Math.min(Math.max(f.slPips, cfg.stopLossPipsMin), cfg.stopLossPipsMax) *
            cfg.rrRatio
          ).toFixed(1),
        }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setRiskCfg]);

  // Fetch trade list on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/trade/list");
        const data = await res.json();
        if (!mounted || !data?.trades) return;
        setTrades(data.trades as TradeRow[]);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setTrades]);

  const sortedTrades = useMemo(() => {
    return [...trades].sort((a, b) => {
      if (a.status === b.status) {
        return (
          new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
        );
      }
      return a.status === "OPEN" ? -1 : 1;
    });
  }, [trades]);

  const openCount = useMemo(
    () => trades.filter((t) => t.status === "OPEN").length,
    [trades],
  );

  // Computed risk metrics for the form
  const riskUsd = account.balance * (riskCfg.riskPerTrade / 100);
  const rr = form.slPips > 0 ? form.tpPips / form.slPips : 0;
  const rewardUsd = riskUsd * rr;

  const handleSlChange = useCallback(
    (val: number[]) => {
      const sl = val[0];
      setForm((f) => ({
        ...f,
        slPips: sl,
        tpPips: +(sl * riskCfg.rrRatio).toFixed(1),
      }));
    },
    [riskCfg.rrRatio],
  );

  const handlePlace = useCallback(async () => {
    if (!account.mt5Connected) {
      toast.error("MT5 belum terhubung", {
        description: "Sambungkan bridge MT5 sebelum menempatkan order.",
      });
      return;
    }
    setPlacing(true);
    try {
      const res = await fetch("/api/trade/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol,
          side: form.side,
          lotSize: form.lotSize,
          stopLossPips: form.slPips,
          takeProfitPips: form.tpPips,
          trailingStop: form.trailingStop,
          trailingPips: form.trailingStop ? form.trailingPips : undefined,
          source: "MANUAL",
          strategy: "Manual Order",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menempatkan order");
      const t = data.trade as TradeRow;
      upsertTrade(t);
      addLog({
        id: Math.random().toString(36).slice(2),
        level: "TRADE",
        source: "TERMINAL",
        message: `OPEN ${t.side} ${t.symbol} ${t.lotSize} lot @ ${t.openPrice} | SL ${t.slPips}p TP ${t.tpPips}p`,
        createdAt: new Date().toISOString(),
      });
      toast.success("Order terkirim", {
        description: `${t.side} ${t.symbol} ${t.lotSize} lot @ ${t.openPrice}`,
      });
    } catch (e) {
      toast.error("Gagal menempatkan order", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPlacing(false);
    }
  }, [account.mt5Connected, form, upsertTrade, addLog]);

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
          source: "TERMINAL",
          message: `CLOSE ${closed.symbol} ${closed.lotSize} lot @ ${closed.closePrice} | PnL ${closed.pnl >= 0 ? "+" : ""}${closed.pnl}`,
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

  const mt5Disabled = !account.mt5Connected;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      <SectionHeader
        title="Trading Terminal"
        description="Eksekusi order manual, manajemen posisi & trailing stop otomatis."
        icon={<CandlestickChart className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="gap-1.5">
              <LiveDot active={account.mt5Connected} />
              {account.mt5Connected ? "MT5 Live" : "MT5 Off"}
            </Badge>
            <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
              <span className="text-xs font-medium text-violet-400">AI Auto Trade</span>
              <Switch
                checked={tradingCfg.autoMode}
                onCheckedChange={(v) => setTradingCfg({ autoMode: v })}
              />
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Order Manual */}
        <Panel
          title="Order Manual"
          description="Form penempatan order market"
          className="lg:col-span-1"
        >
          <div className="space-y-4">
            {/* Symbol */}
            <div className="space-y-1.5">
              <Label htmlFor="ord-symbol">Symbol</Label>
              <Select
                value={form.symbol}
                onValueChange={(v) => setForm((f) => ({ ...f, symbol: v as Pair }))}
              >
                <SelectTrigger id="ord-symbol" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAIRS.map((p) => (
                    <SelectItem key={p.symbol} value={p.symbol}>
                      <span className="font-medium">{p.symbol}</span>
                      <span className="text-xs text-muted-foreground">
                        — {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Side toggle */}
            <div className="space-y-1.5">
              <Label>Side</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={form.side === "BUY" ? "default" : "outline"}
                  className={cn(
                    form.side === "BUY" &&
                      "border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-300",
                  )}
                  onClick={() => setForm((f) => ({ ...f, side: "BUY" }))}
                >
                  <ArrowUpRight className="h-4 w-4" /> BUY
                </Button>
                <Button
                  type="button"
                  variant={form.side === "SELL" ? "default" : "outline"}
                  className={cn(
                    form.side === "SELL" &&
                      "border-rose-500/40 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 hover:text-rose-300",
                  )}
                  onClick={() => setForm((f) => ({ ...f, side: "SELL" }))}
                >
                  <ArrowDownRight className="h-4 w-4" /> SELL
                </Button>
              </div>
            </div>

            {/* Lot size */}
            <div className="space-y-1.5">
              <Label htmlFor="ord-lot">Lot Size</Label>
              <Input
                id="ord-lot"
                type="number"
                min={0.01}
                step={0.01}
                value={form.lotSize}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    lotSize: Math.max(0.01, Number(e.target.value) || 0.01),
                  }))
                }
                className="tnum"
              />
            </div>

            {/* Stop Loss slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Stop Loss (pips)</Label>
                <span className="tnum text-xs font-medium text-rose-400">
                  {form.slPips}p
                </span>
              </div>
              <Slider
                value={[form.slPips]}
                min={riskCfg.stopLossPipsMin}
                max={riskCfg.stopLossPipsMax}
                step={1}
                onValueChange={handleSlChange}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground tnum">
                <span>min {riskCfg.stopLossPipsMin}p</span>
                <span>max {riskCfg.stopLossPipsMax}p</span>
              </div>
            </div>

            {/* Take Profit input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ord-tp">Take Profit (pips)</Label>
                <span className="text-[10px] text-muted-foreground">
                  auto {riskCfg.rrRatio}× SL
                </span>
              </div>
              <Input
                id="ord-tp"
                type="number"
                min={1}
                step={0.1}
                value={form.tpPips}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    tpPips: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="tnum"
              />
            </div>

            {/* Trailing stop */}
            <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="ord-ts" className="cursor-pointer">
                  Trailing Stop
                </Label>
                <Switch
                  id="ord-ts"
                  checked={form.trailingStop}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, trailingStop: v }))
                  }
                />
              </div>
              {form.trailingStop && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Trailing pips
                    </span>
                    <span className="tnum text-xs font-medium">
                      {form.trailingPips}p
                    </span>
                  </div>
                  <Slider
                    value={[form.trailingPips]}
                    min={3}
                    max={30}
                    step={1}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, trailingPips: v[0] }))
                    }
                  />
                </div>
              )}
            </div>

            {/* Computed risk metrics */}
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card/60 p-3 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Risk $
                </div>
                <div className="tnum text-sm font-semibold text-rose-400">
                  {fmtUsd(riskUsd)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Reward $
                </div>
                <div className="tnum text-sm font-semibold text-emerald-400">
                  {fmtUsd(rewardUsd)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  R:R
                </div>
                <div className="tnum text-sm font-semibold text-violet-400">
                  1:{rr.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Place order */}
            <Button
              className="w-full"
              disabled={placing || mt5Disabled}
              onClick={handlePlace}
            >
              {placing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {form.side === "BUY" ? "Beli" : "Jual"} {form.symbol} ·{" "}
              {form.lotSize} lot
            </Button>
            {mt5Disabled && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Order dinonaktifkan. Sambungkan MT5 Bridge terlebih dahulu
                  melalui sidebar untuk mengaktifkan eksekusi.
                </span>
              </div>
            )}
          </div>
        </Panel>

        {/* Right: Positions & Management */}
        <div className="lg:col-span-2 space-y-4">
          {/* Trailing stop auto */}
          <Panel
            title="Trailing Stop Otomatis"
            description="Geser SL mengikuti harga secara real-time saat posisi profit"
            actions={
              <Switch
                checked={tradingCfg.trailingAuto}
                onCheckedChange={(v) => setTradingCfg({ trailingAuto: v })}
              />
            }
          >
            <p className="text-xs text-muted-foreground">
              Saat aktif, sistem akan menarik Stop Loss otomatis ke arah harga
              pasar sebesar <span className="tnum text-foreground">trailing pips</span>{" "}
              setiap kali posisi menyentuh level profit baru. Cocok untuk
              strategi trend-following pada sesi London & New York.
            </p>
          </Panel>

          {/* Positions table */}
          <Panel
            title="Posisi & Manajemen"
            description={`${trades.length} total · ${openCount} aktif · ${trades.length - openCount} tertutup`}
            bodyClassName="p-0"
          >
            <ScrollArea className="max-h-[28rem] scroll-thin">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="text-xs">Ticket</TableHead>
                    <TableHead className="text-xs">Symbol</TableHead>
                    <TableHead className="text-xs">Side</TableHead>
                    <TableHead className="text-xs text-right">Lot</TableHead>
                    <TableHead className="text-xs text-right">Entry</TableHead>
                    <TableHead className="text-xs text-right">Close</TableHead>
                    <TableHead className="text-xs text-right">SL</TableHead>
                    <TableHead className="text-xs text-right">TP</TableHead>
                    <TableHead className="text-xs text-right">P&L</TableHead>
                    <TableHead className="text-xs text-right">Pips</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTrades.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={13} className="py-8">
                        <EmptyState
                          icon={<Layers className="h-7 w-7" />}
                          title="Belum ada transaksi"
                          description="Order yang Anda tempatkan akan tampil di sini."
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedTrades.map((t) => {
                      const { pips, pnl } = livePnl(t, quotes);
                      const isOpen = t.status === "OPEN";
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="tnum text-[11px] text-muted-foreground">
                            #{t.ticket.slice(-6)}
                          </TableCell>
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
                            {fmtPrice(t.symbol, t.closePrice)}
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
                              pnl >= 0
                                ? "text-emerald-400"
                                : "text-rose-400",
                            )}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {fmtUsd(pnl)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tnum text-xs",
                              pips >= 0 ? "text-emerald-400" : "text-rose-400",
                            )}
                          >
                            {pips >= 0 ? "+" : ""}
                            {pips}p
                          </TableCell>
                          <TableCell>
                            {t.source === "AI" ? (
                              <Pill tone="accent">AI</Pill>
                            ) : (
                              <Pill>MANUAL</Pill>
                            )}
                          </TableCell>
                          <TableCell>
                            {isOpen ? (
                              <Pill tone="up">OPEN</Pill>
                            ) : (
                              <Pill>CLOSED</Pill>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {isOpen ? (
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
                            ) : (
                              <span className="text-[10px] text-muted-foreground tnum">
                                {new Date(t.closedAt ?? t.openedAt).toLocaleTimeString("id-ID", { hour12: false })}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </Panel>
        </div>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Open Positions"
          value={
            <span className="tnum">
              {openCount}
              <span className="text-base text-muted-foreground">
                {" "}
                / {riskCfg.maxOpenPositions}
              </span>
            </span>
          }
          sub={openCount >= riskCfg.maxOpenPositions ? "Limit tercapai" : "Aman"}
          tone={openCount >= riskCfg.maxOpenPositions ? "warn" : "default"}
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          label="Used Margin"
          value={<span className="tnum">{fmtUsd(account.margin)}</span>}
          sub={`Leverage ${account.leverage}`}
          tone="default"
          icon={<Gauge className="h-4 w-4" />}
        />
        <StatCard
          label="Margin Level"
          value={
            <span
              className={cn(
                "tnum",
                account.marginLevel > 0 && account.marginLevel < 50
                  ? "text-rose-400"
                  : account.marginLevel > 0 && account.marginLevel < 100
                    ? "text-amber-400"
                    : "",
              )}
            >
              {account.marginLevel > 0
                ? `${account.marginLevel.toFixed(1)}%`
                : "—"}
            </span>
          }
          sub="MC 50% · Stop Out 20%"
          tone={account.marginLevel > 0 && account.marginLevel < 50 ? "down" : "default"}
          icon={<Percent className="h-4 w-4" />}
        />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
        <Shield className="h-3.5 w-3.5 text-emerald-400" />
        Semua order tunduk pada aturan risiko: maksimal {riskCfg.maxOpenPositions}{" "}
        posisi terbuka & batas harian {riskCfg.dailyLossLimit}% (Anti-MC).
      </div>
    </motion.div>
  );
}

export default TradingSection;
