'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Play, RefreshCw, BarChart3, Trash2 } from 'lucide-react';
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  type ForexPair, type StrategyName, type BacktestResult,
  FOREX_PAIRS, PAIR_DISPLAY, STRATEGY_LABELS, TIMEFRAMES,
} from '@/lib/trading-types';

export function BacktestingPanel() {
  const [backtestConfig, setBacktestConfig] = useState({
    pair: 'EURUSD' as ForexPair,
    strategy: 'EMA_CROSSOVER' as StrategyName,
    timeframe: 'H1',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    initialBalance: 10000,
    riskPerTrade: 1,
    stopLossPips: 10,
    takeProfitPips: 15,
    maxPositions: 3,
  });
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestHistory, setBacktestHistory] = useState<BacktestResult[]>([]);
  const [backtestEquity, setBacktestEquity] = useState<{ time: string; equity: number }[]>([]);

  // Fetch backtest history
  const fetchBacktestHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/backtest?history=true');
      if (res.ok) {
        const data = await res.json();
        setBacktestHistory(data.results || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchBacktestHistory();
  }, [fetchBacktestHistory]);

  // Run backtest
  const handleRunBacktest = async () => {
    setBacktestLoading(true);
    setBacktestResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backtestConfig),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.result) {
          setBacktestResult(data.result as BacktestResult);
          setBacktestEquity(data.equityCurve || []);
          toast.success(`Backtest complete: ${data.result.totalTrades} trades, ${data.result.winRate}% win rate`);
          fetchBacktestHistory();
        }
      } else {
        const data = await res.json();
        toast.error(data.error || 'Backtest failed');
      }
    } catch {
      toast.error('Network error running backtest');
    } finally {
      setBacktestLoading(false);
    }
  };

  // Delete backtest
  const handleDeleteBacktest = async (id: string) => {
    try {
      await fetch(`/api/backtest?id=${id}`, { method: 'DELETE' });
      toast.success('Backtest deleted');
      fetchBacktestHistory();
    } catch {
      toast.error('Failed to delete backtest');
    }
  };

  return (
    <div className="space-y-4">
      {/* Configuration form */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Backtest Configuration</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Pair</Label>
              <Select value={backtestConfig.pair} onValueChange={(v) => setBacktestConfig(c => ({ ...c, pair: v as ForexPair }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Strategy</Label>
              <Select value={backtestConfig.strategy} onValueChange={(v) => setBacktestConfig(c => ({ ...c, strategy: v as StrategyName }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {(Object.entries(STRATEGY_LABELS) as [StrategyName, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-zinc-200">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Timeframe</Label>
              <Select value={backtestConfig.timeframe} onValueChange={(v) => setBacktestConfig(c => ({ ...c, timeframe: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {TIMEFRAMES.map(tf => <SelectItem key={tf} value={tf} className="text-zinc-200">{tf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Initial Balance</Label>
              <Input type="number" value={backtestConfig.initialBalance}
                onChange={(e) => setBacktestConfig(c => ({ ...c, initialBalance: parseFloat(e.target.value) || 10000 }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Start Date</Label>
              <Input type="date" value={backtestConfig.startDate}
                onChange={(e) => setBacktestConfig(c => ({ ...c, startDate: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">End Date</Label>
              <Input type="date" value={backtestConfig.endDate}
                onChange={(e) => setBacktestConfig(c => ({ ...c, endDate: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">SL (pips)</Label>
              <Input type="number" step="0.1" value={backtestConfig.stopLossPips}
                onChange={(e) => setBacktestConfig(c => ({ ...c, stopLossPips: parseFloat(e.target.value) || 10 }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">TP (pips)</Label>
              <Input type="number" step="0.1" value={backtestConfig.takeProfitPips}
                onChange={(e) => setBacktestConfig(c => ({ ...c, takeProfitPips: parseFloat(e.target.value) || 15 }))}
                className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs" />
            </div>
          </div>
          <Button onClick={handleRunBacktest} disabled={backtestLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {backtestLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Backtest
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {backtestResult && (
        <>
          <Card className="bg-zinc-900 border-zinc-800 p-4">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4" /> Backtest Results — {PAIR_DISPLAY[backtestResult.pair]} / {STRATEGY_LABELS[backtestResult.strategy]}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
                {[
                  { label: 'Total Trades', value: String(backtestResult.totalTrades), color: 'text-white' },
                  { label: 'Win Rate', value: `${backtestResult.winRate.toFixed(1)}%`, color: backtestResult.winRate > 50 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Total P&L', value: `$${backtestResult.totalPnl.toFixed(2)}`, color: backtestResult.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Max Drawdown', value: `${backtestResult.maxDrawdown.toFixed(2)}%`, color: 'text-rose-400' },
                  { label: 'Sharpe Ratio', value: backtestResult.sharpeRatio?.toFixed(2) || 'N/A', color: 'text-white' },
                  { label: 'Profit Factor', value: backtestResult.profitFactor?.toFixed(2) || 'N/A', color: (backtestResult.profitFactor || 0) > 1 ? 'text-emerald-400' : 'text-rose-400' },
                  { label: 'Avg Win', value: backtestResult.avgWin ? `$${backtestResult.avgWin.toFixed(2)}` : 'N/A', color: 'text-emerald-400' },
                  { label: 'Avg Loss', value: backtestResult.avgLoss ? `$${backtestResult.avgLoss.toFixed(2)}` : 'N/A', color: 'text-rose-400' },
                ].map((item) => (
                  <div key={item.label} className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500 mb-0.5">{item.label}</p>
                    <p className={`text-xs font-mono font-bold ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              {backtestResult.maxConsecutiveWins != null && backtestResult.maxConsecutiveLosses != null && (
                <div className="flex gap-4 text-xs text-zinc-400">
                  <span>Max Consecutive Wins: <span className="text-emerald-400 font-mono font-medium">{backtestResult.maxConsecutiveWins}</span></span>
                  <span>Max Consecutive Losses: <span className="text-rose-400 font-mono font-medium">{backtestResult.maxConsecutiveLosses}</span></span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Equity curve */}
          {backtestEquity.length > 0 && (
            <Card className="bg-zinc-900 border-zinc-800 p-4">
              <CardHeader className="p-0 pb-3">
                <CardTitle className="text-sm text-white">Equity Curve</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="h-64">
                  <figure aria-label="Grafik ekuitas backtesting">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={backtestEquity}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: '#71717a' }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9, fill: '#71717a' }} domain={['auto', 'auto']} />
                        <RTooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', fontSize: 11 }} />
                        <ReferenceLine y={backtestConfig.initialBalance} stroke="#71717a" strokeDasharray="3 3" />
                        <Area type="monotone" dataKey="equity" stroke="#10b981" fill="#10b98120" strokeWidth={1.5} />
                      </AreaChart>
                    </ResponsiveContainer>
                    <figcaption className="sr-only">Grafik kurva ekuitas dari hasil backtesting</figcaption>
                  </figure>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Backtest history */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Past Backtest Results</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {backtestHistory.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">No past backtest results</p>
          ) : (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Strategy</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Trades</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Win Rate</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">P&L</TableHead>
                    <TableHead className="text-[10px] text-zinc-500">Drawdown</TableHead>
                    <TableHead className="text-[10px] text-zinc-500 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backtestHistory.map((bt) => (
                    <TableRow key={bt.id} className="border-zinc-800/50">
                      <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[bt.pair]}</TableCell>
                      <TableCell className="text-xs text-zinc-300">{STRATEGY_LABELS[bt.strategy]}</TableCell>
                      <TableCell className="text-xs text-zinc-400 font-mono">{bt.totalTrades}</TableCell>
                      <TableCell className={`text-xs font-mono ${bt.winRate > 50 ? 'text-emerald-400' : 'text-rose-400'}`}>{bt.winRate.toFixed(1)}%</TableCell>
                      <TableCell className={`text-xs font-mono ${bt.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${bt.totalPnl.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-rose-400 font-mono">{bt.maxDrawdown.toFixed(2)}%</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => handleDeleteBacktest(bt.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
