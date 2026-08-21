'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Target, ShieldAlert, Activity,
  Trophy, AlertTriangle, Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { TradeAnalytics } from '@/lib/trading-types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, Cell,
} from 'recharts';

// ============================================================
// Types
// ============================================================

type Period = '7d' | '30d' | '90d' | 'all';

// ============================================================
// Constants
// ============================================================

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: '7 Hari' },
  { value: '30d', label: '30 Hari' },
  { value: '90d', label: '90 Hari' },
  { value: 'all', label: 'Semua' },
];

// ============================================================
// Helpers
// ============================================================

function formatCurrency(val: number): string {
  const abs = Math.abs(val);
  const sign = val >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

// ============================================================
// Custom Tooltip
// ============================================================

function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name ?? ''}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
}

// ============================================================
// KPI Card
// ============================================================

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-xl font-bold text-zinc-100">{value}</p>
        {sub && <p className={`text-xs mt-1 ${color}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Skeleton Loaders
// ============================================================

function KpiSkeleton() {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-3 w-20 bg-zinc-800" />
        <Skeleton className="h-7 w-24 bg-zinc-800" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-32 bg-zinc-800" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-48 w-full bg-zinc-800 rounded" />
      </CardContent>
    </Card>
  );
}

// ============================================================
// Main Component
// ============================================================

export function TradeAnalyticsPanel() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<TradeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trade-analytics?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.analytics ?? null);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Derived chart data
  const pnlByPairData = data
    ? Object.entries(data.pnlByPair).map(([pair, pnl]) => ({ pair, pnl }))
    : [];

  const winRateByPairData = data
    ? Object.entries(data.winRateByPair).map(([pair, winRate]) => ({
        pair,
        winRate: Number((winRate * 100).toFixed(1)),
        lossRate: Number(((1 - winRate) * 100).toFixed(1)),
      }))
    : [];

  const equityCurveData = data?.equityCurve ?? [];
  const pnlByHourData = data?.pnlByHour ?? [];
  const pnlByDayData = data?.pnlByDay ?? [];

  const pnlColor = (data?.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const bestPair = data?.bestPair ?? '-';
  const worstPair = data?.worstPair ?? '-';

  return (
    <div className="space-y-6">
      {/* Header + Period Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-zinc-400" />
          <h2 className="text-lg font-semibold text-zinc-100">Analisis Performa Trading</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-300 hover:text-white h-8 text-xs gap-1.5"
            onClick={() => window.open('/api/export?type=positions&format=csv', '_blank')}
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {PERIODS.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setPeriod(p.value)}
              className={`text-xs h-7 px-3 ${
                period === p.value
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {p.label}
            </Button>
          ))}
        </div>
        </div>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            icon={Activity}
            label="Total Trades"
            value={String(data?.totalTrades ?? 0)}
            color="text-zinc-300"
          />
          <KpiCard
            icon={Target}
            label="Win Rate"
            value={`${((data?.winRate ?? 0) * 100).toFixed(1)}%`}
            sub={data && data.winRate >= 0.5 ? 'Baik' : 'Perlu perbaikan'}
            color={data && data.winRate >= 0.5 ? 'text-emerald-400' : 'text-rose-400'}
          />
          <KpiCard
            icon={data && data.totalPnl >= 0 ? TrendingUp : TrendingDown}
            label="Total P&L"
            value={formatCurrency(data?.totalPnl ?? 0)}
            color={pnlColor}
          />
          <KpiCard
            icon={Trophy}
            label="Profit Factor"
            value={(data?.profitFactor ?? 0).toFixed(2)}
            sub={data && (data.profitFactor ?? 0) >= 1.5 ? 'Menguntungkan' : 'Kurang ideal'}
            color={data && (data.profitFactor ?? 0) >= 1.5 ? 'text-emerald-400' : 'text-amber-400'}
          />
          <KpiCard
            icon={AlertTriangle}
            label="Max Drawdown"
            value={`${((data?.maxDrawdown ?? 0) * 100).toFixed(1)}%`}
            sub={data && data.maxDrawdown <= 0.1 ? 'Rendah' : 'Perlu perhatian'}
            color={data && data.maxDrawdown <= 0.1 ? 'text-emerald-400' : 'text-rose-400'}
          />
          <KpiCard
            icon={ShieldAlert}
            label="Sharpe Ratio"
            value={(data?.sharpeRatio ?? 0).toFixed(2)}
            sub={data && (data.sharpeRatio ?? 0) >= 1 ? 'Bagus' : 'Kurang'}
            color={data && (data.sharpeRatio ?? 0) >= 1 ? 'text-emerald-400' : 'text-amber-400'}
          />
        </div>
      )}

      {/* Best / Worst Pair Indicators */}
      {!loading && data && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
            <Trophy className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-zinc-500">Pasangan Terbaik:</span>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs">
              {bestPair}
            </Badge>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span className="text-xs text-zinc-500">Pasangan Terburuk:</span>
            <Badge variant="outline" className="border-rose-500/30 text-rose-400 text-xs">
              {worstPair}
            </Badge>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L by Pair */}
        {loading ? (
          <ChartSkeleton />
        ) : pnlByPairData.length > 0 ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-300">P&L per Pasangan</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={pnlByPairData} layout="vertical" margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} />
                  <YAxis type="category" dataKey="pair" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={70} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="pnl" name="P&L" radius={[0, 4, 4, 0]}>
                    {pnlByPairData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}

        {/* Win Rate by Pair */}
        {loading ? (
          <ChartSkeleton />
        ) : winRateByPairData.length > 0 ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-300">Win Rate per Pasangan</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={winRateByPairData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="pair" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} domain={[0, 100]} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="winRate" name="Win %" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="lossRate" name="Loss %" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Equity Curve */}
      {loading ? (
        <ChartSkeleton />
      ) : equityCurveData.length > 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-300">Kurva Ekuitas</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={equityCurveData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip content={<DarkTooltip />} />
                <ReferenceLine y={equityCurveData[0]?.equity} stroke="#52525b" strokeDasharray="5 5" />
                <Line
                  type="monotone"
                  dataKey="equity"
                  name="Ekuitas"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L by Hour */}
        {loading ? (
          <ChartSkeleton />
        ) : pnlByHourData.length > 0 ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-300">P&L per Jam (0-23)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pnlByHourData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="hour" tick={{ fill: '#71717a', fontSize: 10 }} tickFormatter={(v: number) => `${v}:00`} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} />
                  <Tooltip content={<DarkTooltip />} />
                  <ReferenceLine y={0} stroke="#52525b" />
                  <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                    {pnlByHourData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}

        {/* P&L by Day */}
        {loading ? (
          <ChartSkeleton />
        ) : pnlByDayData.length > 0 ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-300">P&L Harian (30 Hari Terakhir)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pnlByDayData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 9 }} tickFormatter={(v: string) => v.slice(8)} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} />
                  <Tooltip content={<DarkTooltip />} />
                  <ReferenceLine y={0} stroke="#52525b" />
                  <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                    {pnlByDayData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Empty state */}
      {!loading && data && pnlByPairData.length === 0 && equityCurveData.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <BarChart3 className="w-12 h-12 mb-3" />
          <p className="text-sm">Belum ada data trading untuk periode ini</p>
          <p className="text-xs text-zinc-600 mt-1">Mulai trading untuk melihat analisis performa</p>
        </div>
      )}
    </div>
  );
}
