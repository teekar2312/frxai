"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  History,
  Play,
  Loader2,
  TrendingUp,
  Percent,
  Scale,
  ListOrdered,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeader, Panel, EmptyState, StatCard } from "@/components/shared";
import { useStore } from "@/lib/store";
import { PAIRS, TIMEFRAMES } from "@/lib/constants";
import type { BacktestRow, Pair, Timeframe } from "@/lib/types";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

// H1: renamed "AI Hybrid" to "EMA + RSI Filter" (actually different now)
const STRATEGIES = [
  "EMA Crossover",
  "Momentum Breakout",
  "Mean Reversion",
  "EMA + RSI Filter",
];

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

interface RunResult {
  backtest: BacktestRow;
  equityCurve: { i: number; v: number }[];
}

export function BacktestSection() {
  const backtests = useStore((s) => s.backtests);
  const setBacktests = useStore((s) => s.setBacktests);

  const [symbol, setSymbol] = useState<Pair>("EURUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>("M15");
  const [strategy, setStrategy] = useState<string>(STRATEGIES[0]);
  const [fromDate, setFromDate] = useState<string>(() =>
    fmtDate(new Date(Date.now() - 30 * 86400000)),
  );
  const [toDate, setToDate] = useState<string>(() =>
    fmtDate(new Date()),
  );
  const [initialCapital, setInitialCapital] = useState<number>(10000);
  const [riskPerTrade, setRiskPerTrade] = useState<number>(1);
  const [rrRatio, setRrRatio] = useState<number>(1.5);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    fetch("/api/backtest/list")
      .then((r) => r.json())
      .then((d) => setBacktests((d.backtests as BacktestRow[]) ?? []))
      .catch(() => toast.error("Gagal memuat riwayat backtest"));
  }, [setBacktests]);

  async function run() {
    // M9: validate date range
    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      toast.error("Rentang tanggal tidak valid", {
        description: "Tanggal mulai harus sebelum tanggal akhir.",
      });
      return;
    }
    // M6: validate capital
    if (initialCapital <= 0) {
      toast.error("Modal awal harus > 0");
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe,
          strategy,
          fromDate,
          toDate,
          initialCapital,
          riskPerTrade,
          rrRatio,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Backtest gagal");
      }
      const data = (await res.json()) as RunResult;
      setResult(data);
      // refresh history list
      const lr = await fetch("/api/backtest/list");
      const ld = await lr.json();
      setBacktests((ld.backtests as BacktestRow[]) ?? []);
      toast.success("Backtest selesai", {
        description: `${data.backtest.totalTrades} trades, win ${data.backtest.winRate.toFixed(1)}%`,
      });
    } catch (e) {
      toast.error("Backtest gagal", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setRunning(false);
    }
  }

  // C1+H3: load backtest from history (fetch equity curve via /api/backtest/[id])
  async function loadFromHistory(b: BacktestRow) {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/backtest/${b.id}`);
      if (!res.ok) throw new Error("Gagal memuat backtest");
      const data = (await res.json()) as RunResult;
      setResult(data);
      toast.info(`Backtest dimuat: ${b.symbol} • ${b.strategy}`, {
        description: `${b.totalTrades} trades • ${b.winRate.toFixed(1)}% win • PF ${b.profitFactor.toFixed(2)}`,
      });
    } catch {
      toast.error("Gagal memuat equity curve dari riwayat");
    } finally {
      setLoadingHistory(false);
    }
  }

  // M5: memoize chart data
  const chartData = useMemo(
    () => result?.equityCurve.map((p) => ({ x: p.i, y: p.v })) ?? [],
    [result],
  );
  const net = result?.backtest.netProfit ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Backtesting Strategi"
        description="Uji strategi pada data simulasi (600 candle sintetis). Hasil tersimpan untuk evaluasi."
        icon={<History className="size-5" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Config */}
        <Panel title="Konfigurasi Backtest" description="Atur parameter simulasi">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pair">
                <Select value={symbol} onValueChange={(v) => setSymbol(v as Pair)}>
                  <SelectTrigger className="w-full">
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
              </Field>
              <Field label="Timeframe">
                <Select
                  value={timeframe}
                  onValueChange={(v) => setTimeframe(v as Timeframe)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Strategi">
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Dari Tanggal">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="tnum"
                />
              </Field>
              <Field label="Sampai Tanggal">
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="tnum"
                />
              </Field>
            </div>

            <Field label={`Modal Awal: $${initialCapital.toLocaleString("en-US")}`}>
              <Input
                type="number"
                min={1}
                step={100}
                value={initialCapital}
                onChange={(e) => setInitialCapital(Math.max(1, Number(e.target.value) || 0))}
                className="tnum"
              />
            </Field>

            <Field label={`Risk per Trade: ${riskPerTrade.toFixed(1)}%`}>
              <Slider
                value={[riskPerTrade]}
                min={0.5}
                max={2}
                step={0.1}
                onValueChange={(v) => setRiskPerTrade(v[0])}
              />
            </Field>

            <Field label={`Risk:Reward Ratio: 1:${rrRatio.toFixed(1)}`}>
              <Slider
                value={[rrRatio]}
                min={1}
                max={3}
                step={0.1}
                onValueChange={(v) => setRrRatio(v[0])}
              />
            </Field>

            <Button onClick={run} disabled={running} className="w-full">
              {running ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Menjalankan Backtest...
                </>
              ) : (
                <>
                  <Play className="size-4" />
                  Jalankan Backtest
                </>
              )}
            </Button>
          </div>
        </Panel>

        {/* Results */}
        <Panel title="Hasil Backtest" description="Statistik & equity curve">
          {result ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard
                  label="Net Profit"
                  value={
                    <span className={net >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {net >= 0 ? "+" : ""}${net.toFixed(2)}
                    </span>
                  }
                  icon={<TrendingUp className="size-4" />}
                  tone={net >= 0 ? "up" : "down"}
                />
                <StatCard
                  label="Win Rate"
                  value={`${result.backtest.winRate.toFixed(1)}%`}
                  icon={<Percent className="size-4" />}
                />
                <StatCard
                  label="Profit Factor"
                  value={result.backtest.profitFactor.toFixed(2)}
                  icon={<Scale className="size-4" />}
                />
                <StatCard
                  label="Total Trades"
                  value={result.backtest.totalTrades}
                  icon={<ListOrdered className="size-4" />}
                />
                <StatCard
                  label="Max Drawdown"
                  value={`${result.backtest.maxDrawdown.toFixed(1)}%`}
                  icon={<TrendingDown className="size-4" />}
                  tone="down"
                />
                <StatCard
                  label="Final Capital"
                  value={`$${result.backtest.finalCapital.toFixed(2)}`}
                  icon={<Wallet className="size-4" />}
                />
              </div>

              {/* Equity curve */}
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="x"
                      stroke="var(--border)"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--border)"
                      fontSize={10}
                      tickLine={false}
                      width={64}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, "Equity"]}
                      labelFormatter={(l) => `Bar #${l}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="y"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="url(#eqGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<History className="size-10" />}
              title="Belum ada hasil backtest"
              description="Konfigurasi parameter di kiri, lalu klik 'Jalankan Backtest' untuk melihat hasil."
            />
          )}
        </Panel>
      </div>

      {/* History */}
      <Panel
        title="Riwayat Backtest"
        description={`${backtests.length} backtest tersimpan`}
      >
        {backtests.length === 0 ? (
          <EmptyState
            icon={<History className="size-8" />}
            title="Belum ada riwayat"
            description="Jalankan backtest pertama Anda."
          />
        ) : (
          <div className="max-h-96 overflow-y-auto scroll-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>TF</TableHead>
                  <TableHead>Strategi</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win%</TableHead>
                  <TableHead className="text-right">PF</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                  <TableHead className="text-right">Tanggal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backtests.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => loadFromHistory(b)}
                  >
                    <TableCell className="font-medium">{b.symbol}</TableCell>
                    <TableCell>{b.timeframe}</TableCell>
                    <TableCell>{b.strategy}</TableCell>
                    <TableCell className="text-right tnum">
                      {b.totalTrades}
                    </TableCell>
                    <TableCell className="text-right tnum">
                      {b.winRate.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right tnum">
                      {b.profitFactor.toFixed(2)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tnum font-medium",
                        b.netProfit >= 0
                          ? "text-emerald-400"
                          : "text-rose-400",
                      )}
                    >
                      {b.netProfit >= 0 ? "+" : ""}${b.netProfit.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(b.createdAt).toLocaleDateString("id-ID")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
