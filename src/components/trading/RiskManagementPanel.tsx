'use client';

import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Shield, Crosshair, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  type RiskCalculation, type ForexPair,
  FOREX_PAIRS, PAIR_DISPLAY, FINEX_CONFIG,
} from '@/lib/trading-types';
import type { TradingConfig } from './shared';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useTradingStore } from '@/lib/trading-store';
import { type Position } from './shared';

export function RiskManagementPanel() {
  const { accountBalance: _accountBalance, todayRiskUsed } = useTradingStore();

  const [positions, setPositions] = useState<Position[]>([]);
  const [_positionsLoading, setPositionsLoading] = useState(true);
  const [riskCalc, setRiskCalc] = useState<RiskCalculation | null>(null);
  const [riskForm, setRiskForm] = useState({ accountBalance: 10000, pair: 'EURUSD' as ForexPair, stopLossPips: 10, riskPerTrade: 1 });
  const [fetchedConfig, setFetchedConfig] = useState<TradingConfig | null>(null);

  // Fetch config from API
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          if (data.config) setFetchedConfig(data.config as TradingConfig);
        }
      } catch {
        // silent - fallback to FINEX_CONFIG
      }
    };
    load();
  }, []);

  // Fetch positions
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/positions?status=open');
        if (res.ok) {
          const data = await res.json();
          setPositions((data.positions || []) as Position[]);
        }
      } catch {
        // silent
      } finally {
        setPositionsLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  // Calculate risk
  const handleCalculateRisk = async () => {
    try {
      const res = await fetch('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(riskForm),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.risk) {
          setRiskCalc(data.risk as RiskCalculation);
        }
      }
    } catch {
      toast.error('Risk calculation failed');
    }
  };

  const dailyRiskLimit = fetchedConfig?.dailyRiskLimit ?? 3;
  const dailyRiskThreshold = dailyRiskLimit * (2 / 3); // warn at ~67%

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risk calculator */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> Risk Calculator
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">Pair</Label>
                <Select value={riskForm.pair} onValueChange={(v) => setRiskForm(f => ({ ...f, pair: v as ForexPair }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">Balance ($) <span className="text-zinc-600">• server overrides</span></Label>
                <Input type="number" value={riskForm.accountBalance}
                  onChange={(e) => setRiskForm(f => ({ ...f, accountBalance: parseFloat(e.target.value) || 0 }))}
                  className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">Risk %</Label>
                <Input type="number" step="0.1" value={riskForm.riskPerTrade}
                  onChange={(e) => setRiskForm(f => ({ ...f, riskPerTrade: parseFloat(e.target.value) || 0 }))}
                  className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-400 text-xs">SL (pips)</Label>
                <Input type="number" value={riskForm.stopLossPips}
                  onChange={(e) => setRiskForm(f => ({ ...f, stopLossPips: parseInt(e.target.value) || 0 }))}
                  className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
            </div>
            <Button onClick={handleCalculateRisk} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
              <Crosshair className="w-4 h-4" /> Calculate
            </Button>

            {riskCalc && (
              <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
                <h4 className="text-xs font-medium text-white mb-2">Results</h4>
                {[
                  { label: 'Recommended Lot Size', value: String(riskCalc.lotSize), color: 'text-emerald-400' },
                  { label: 'Pip Value', value: `$${riskCalc.pipValue.toFixed(2)}`, color: 'text-white' },
                  { label: 'Risk Amount', value: `$${riskCalc.riskAmount.toFixed(2)}`, color: 'text-amber-400' },
                  { label: 'Potential Loss', value: `$${riskCalc.potentialLoss.toFixed(2)}`, color: 'text-rose-400' },
                  { label: 'Potential Profit', value: `$${riskCalc.potentialProfit.toFixed(2)}`, color: 'text-emerald-400' },
                  { label: 'R:R Ratio', value: `1:${riskCalc.riskRewardRatio.toFixed(1)}`, color: 'text-white' },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between text-xs">
                    <span className="text-zinc-400">{item.label}</span>
                    <span className={`font-mono font-medium ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* FINEX Indonesia specs */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white">FINEX Indonesia Specifications</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="bg-zinc-800/50 rounded-lg p-4 space-y-2">
              {[
                { label: 'Leverage', value: `1:${fetchedConfig?.leverage ?? FINEX_CONFIG.leverage}` },
                { label: 'Spread', value: `${fetchedConfig?.spreadPip ?? FINEX_CONFIG.spreadPip} pip` },
                { label: 'Commission', value: `$${fetchedConfig?.commissionPerLot ?? FINEX_CONFIG.commissionPerLot}/lot` },
                { label: 'Min Lot', value: String(FINEX_CONFIG.minLot) },
                { label: 'Max Lot/Order', value: String(FINEX_CONFIG.maxLotPerOrder) },
                { label: 'Max Open Positions', value: String(fetchedConfig?.maxOpenPositions ?? FINEX_CONFIG.maxOpenPositions) },
                { label: 'Margin Call Level', value: `${fetchedConfig?.marginCallLevel ?? FINEX_CONFIG.marginCallLevel}%` },
                { label: 'Stop Out Level', value: `${fetchedConfig?.stopOutLevel ?? FINEX_CONFIG.stopOutLevel}%` },
              ].map((item) => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-zinc-400">{item.label}</span>
                  <span className="text-zinc-200 font-mono">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Money management rules — RISK-009: Use dynamic config values */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Shield className="w-4 h-4" /> Money Management Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Risk/Trade', value: `${fetchedConfig?.riskPerTrade ?? 0.75}%` },
              { label: 'SL Range', value: `${fetchedConfig?.stopLossMin ?? 5}-${fetchedConfig?.stopLossMax ?? 15} pips` },
              { label: 'R:R Ratio', value: `1:${fetchedConfig?.riskRewardRatio ?? 1.5}` },
              { label: 'Max Positions', value: String(fetchedConfig?.maxOpenPositions ?? 3) },
              { label: 'Daily Risk Limit', value: `${fetchedConfig?.dailyRiskLimit ?? 2.5}%` },
              { label: 'Daily Target', value: `${fetchedConfig?.dailyTargetMin ?? 1}-${fetchedConfig?.dailyTargetMax ?? 3}%` },
            ].map((rule) => (
              <div key={rule.label} className="bg-zinc-800/50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-zinc-500 mb-1">{rule.label}</p>
                <p className="text-sm font-mono font-bold text-emerald-400">{rule.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Daily risk usage */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Daily Risk Usage</CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-400">Risk Used Today</span>
            <span className={`font-mono font-medium ${todayRiskUsed > dailyRiskThreshold ? 'text-rose-400' : todayRiskUsed > dailyRiskThreshold / 2 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {todayRiskUsed.toFixed(2)}% / {dailyRiskLimit.toFixed(2)}%
            </span>
          </div>
          <Progress value={Math.min(todayRiskUsed / dailyRiskLimit * 100, 100)} className="h-3 bg-zinc-800" />
          <Alert className={`${todayRiskUsed > dailyRiskThreshold ? 'border-rose-500/30 bg-rose-500/5' : 'border-zinc-700 bg-zinc-800/30'}`}>
            {todayRiskUsed > dailyRiskThreshold ? <AlertTriangle className="w-4 h-4 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <AlertTitle className={`text-xs ${todayRiskUsed > dailyRiskThreshold ? 'text-rose-400' : 'text-emerald-400'}`}>
              {todayRiskUsed > dailyRiskThreshold ? 'Daily Risk Limit Approaching' : 'Risk Level Healthy'}
            </AlertTitle>
            <AlertDescription className="text-xs text-zinc-400">
              {todayRiskUsed > dailyRiskThreshold
                ? 'You are approaching your daily risk limit. Consider closing some positions or waiting.'
                : 'Your current risk usage is within safe limits.'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Risk per pair breakdown */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Risk per Pair</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                <TableHead className="text-[10px] text-zinc-500">Positions</TableHead>
                <TableHead className="text-[10px] text-zinc-500 text-right">Total Lots</TableHead>
                <TableHead className="text-[10px] text-zinc-500 text-right">Total P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FOREX_PAIRS.map((pair) => {
                const pairPos = positions.filter(p => p.pair === pair);
                const pairPnl = pairPos.reduce((s, p) => s + (p.pnl || 0), 0);
                const pairLots = pairPos.reduce((s, p) => s + p.lotSize, 0);
                return (
                  <TableRow key={pair} className="border-zinc-800/50">
                    <TableCell className="text-xs text-zinc-200 font-mono font-medium">{PAIR_DISPLAY[pair]}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{pairPos.length}</TableCell>
                    <TableCell className="text-xs text-zinc-300 font-mono text-right">{pairLots.toFixed(2)}</TableCell>
                    <TableCell className={`text-xs font-mono text-right ${pairPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {pairPnl >= 0 ? '+' : ''}{pairPnl.toFixed(2)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
