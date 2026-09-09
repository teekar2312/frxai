"use client";

import { useEffect, useState, type ReactNode } from "react";
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

const STRATEGIES = [
  "EMA Crossover",
  "Momentum Breakout",
  "Mean Reversion",
  "AI Hybrid",
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

  useEffect(() => {
    fetch("/api/backtest/list")
      .then((r) => r.json())
      .then((d) => setBacktests((d.backtests as BacktestRow[]) ?? []))
      .catch(() => toast.error("Gagal memuat riwayat backtest"));
  }, [setBacktests]);

  async function run() {
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
      if (!res.ok) throw new Error("Backtest gagal");
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

  const chartData =
    result?.equityCurve.map((p) => ({ x: p.i, y: p.v })) ?? [];
  const net = result?.backtest.netProfit ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Backtesting Strategi"
        description="Uji strategi pada data historis dengan simulasi tick-by-tick. Hasil tersimpan untuk evaluasi."
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

            <Field label="Modal Awal ($)">
              <Input
                type="number"
                value={initialCapital}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
                className="tnum"
              />
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Risk per Trade
                </Label>
                <span className="text-xs tnum text-foreground">
                  {riskPerTrade.toFixed(2)}%
                </span>
              </div>
              <Slider
                value={[riskPerTrade]}
                min={0.5}
                max={2}
                step={0.1}
                onValueChange={(v) => setRiskPerTrade(v[0])}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Risk : Reward Ratio
                </Label>
                <span className="text-xs tnum text-foreground">
                  1 : {rrRatio.toFixed(1)}
                </span>
              </div>
              <Slider
                value={[rrRatio]}
                min={1}
                max={3}
                step={0.1}
                onValueChange={(v) => setRrRatio(v[0])}
              />
            </div>

            <Button onClick={run} disabled={running} className="w-full">
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {running ? "Menjalankan..." : "Jalankan Backtest"}
            </Button>
          </div>
        </Panel>

        {/* Result */}
        <Panel
          title="Hasil Backtest"
          description={
            result
              ? `${result.backtest.symbol} ${result.backtest.timeframe} — ${result.backtest.strategy}`
              : "Belum ada hasil"
          }
        >
          {!result ? (
            <EmptyState
              icon={<History className="size-10" />}
              title="Belum ada hasil backtest"
              description="Konfigurasikan parameter lalu jalankan simulasi."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard
                  label="Net Profit"
                  value={`$${net.toFixed(2)}`}
                  tone={net >= 0 ? "up" : "down"}
                  icon={<TrendingUp className="size-4" />}
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
                  tone="down"
                  icon={<TrendingDown className="size-4" />}
                />
                <StatCard
                  label="Final Capital"
                  value={`$${result.backtest.finalCapital.toFixed(2)}`}
                  tone="accent"
                  icon={<Wallet className="size-4" />}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Equity Curve
                  </span>
                  <span
                    className={cn(
                      "text-xs tnum",
                      net >= 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {net >= 0 ? "+" : ""}
                    {(
                      (net / result.backtest.initialCapital) *
                      100
                    ).toFixed(2)}
                    %
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart
                    data={chartData}
                    margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="#10b981"
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="100%"
                          stopColor="#10b981"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <XAxis
                      dataKey="x"
                      stroke="rgba(255,255,255,0.3)"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="rgba(255,255,255,0.3)"
                      fontSize={10}
                      tickLine={false}
                      width={64}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(20,20,25,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                      formatter={(v: number) => [
                        `$${v.toFixed(2)}`,
                        "Equity",
                      ]}
                      labelFormatter={(l) => `Bar #${l}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="y"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#eqGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
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
            description="Backtest yang dijalankan akan muncul di sini."
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
                    className="cursor-pointer"
                    onClick={() =>
                      toast.info(`${b.symbol} • ${b.strategy}`, {
                        description: `${b.totalTrades} trades • ${b.winRate.toFixed(1)}% win • PF ${b.profitFactor.toFixed(2)}`,
                      })
                    }
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
