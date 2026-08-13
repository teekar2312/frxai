'use client';

import React, { useState, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Zap, RefreshCw, ArrowUpCircle, ArrowDownCircle, Play, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  type ForexPair, type TradingSignal, type StrategyName, type AiAnalysisResult,
  FOREX_PAIRS, PAIR_DISPLAY, STRATEGY_LABELS,
} from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';
import { fmtPrice, STRATEGY_DESCS } from './shared';

const AUTO_TRADE_CONFIDENCE_THRESHOLD = 60; // minimum confidence %

async function executeSignal(signal: TradingSignal, isMt5Live: boolean): Promise<{ success: boolean; error?: string; ticket?: number }> {
  if (isMt5Live) {
    const res = await fetch('/api/mt5/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pair: signal.pair,
        direction: signal.direction,
        lotSize: signal.lotSize,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        comment: `FRXAI-AUTO-${signal.strategy}`,
      }),
    });
    const data = await res.json();
    return { success: data.success, error: data.error, ticket: data.ticket };
  } else {
    const res = await fetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pair: signal.pair,
        direction: signal.direction,
        lotSize: signal.lotSize,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        strategy: signal.strategy,
      }),
    });
    if (res.ok) return { success: true };
    const data = await res.json();
    return { success: false, error: data.error };
  }
}

export function TradingSignalsPanel() {
  const { quotes, signals, setSignals, setAiAnalysis, isAutoTrading, tradingMode, mt5ConnectionStatus, mt5Positions } = useTradingStore();
  const isMt5Live = tradingMode === 'mt5_live' && mt5ConnectionStatus === 'connected';

  const [signalFilter, setSignalFilter] = useState<{ pair: string; strategy: string; direction: string }>({ pair: 'all', strategy: 'all', direction: 'all' });
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [autoTradeResults, setAutoTradeResults] = useState<Record<number, { success: boolean; ticket?: number; error?: string }>>({});
  const [autoTrading, setAutoTrading] = useState(false);
  const executedSignalIds = useRef(new Set<string>());

  // C1: Confirmation dialog state for auto-trading MT5 orders
  const [pendingAutoSignals, setPendingAutoSignals] = useState<TradingSignal[] | null>(null);
  const [autoTradeConfirmed, setAutoTradeConfirmed] = useState(false);

  // Generate signals for all pairs
  const handleGenerateSignals = async () => {
    setSignalsLoading(true);
    executedSignalIds.current.clear();
    setAutoTradeResults({});
    try {
      const allSignals: TradingSignal[] = [];
      for (const pair of FOREX_PAIRS) {
        const res = await fetch('/api/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pair, currentPrice: quotes[pair]?.mid || 0, quote: quotes[pair], generateSignals: true }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.analysis) {
            setAiAnalysis(pair, data.analysis as AiAnalysisResult);
          }
          if (data.signals) {
            allSignals.push(...(data.signals as TradingSignal[]));
          }
        }
      }
      setSignals(allSignals);
      toast.success(`Generated ${allSignals.length} signals across all pairs`);

      // Auto-trading: check eligibility and show confirmation if MT5 live
      if (isAutoTrading && allSignals.length > 0) {
        const eligible = allSignals.filter(
          (s) => s.confidence >= AUTO_TRADE_CONFIDENCE_THRESHOLD && !executedSignalIds.current.has(s.id)
        );

        if (eligible.length === 0) {
          if (allSignals.length > 0) {
            toast.info(`No signals above ${AUTO_TRADE_CONFIDENCE_THRESHOLD}% confidence threshold for auto-trading`);
          }
          return;
        }

        // H5: Risk management pre-check before auto-trading
        if (isMt5Live) {
          const currentMt5Positions = mt5Positions.length;
          const totalRiskAmount = eligible.reduce((sum, s) => sum + (Math.abs(s.entryPrice - s.stopLoss) * s.lotSize * 10000), 0);
          const riskWarning = [];

          if (currentMt5Positions + eligible.length > 50) {
            riskWarning.push(`${currentMt5Positions + eligible.length} total positions (current: ${currentMt5Positions} + new: ${eligible.length})`);
          }
          if (totalRiskAmount > 5000) {
            riskWarning.push(`Total risk exposure: $${totalRiskAmount.toFixed(2)}`);
          }

          if (riskWarning.length > 0) {
            toast.warning(`Risk alert: ${riskWarning.join('; ')}`);
          }

          // C1: Show confirmation dialog for MT5 auto-trading
          setPendingAutoSignals(eligible);
          return;
        }

        // Simulation: execute directly
        await autoExecuteSignals(eligible);
      }
    } catch {
      toast.error('Failed to generate signals');
    } finally {
      setSignalsLoading(false);
    }
  };

  // Execute confirmed auto-trading
  const handleAutoTradeConfirm = async () => {
    if (!pendingAutoSignals) return;
    const signalsToExecute = pendingAutoSignals;
    setAutoTradeConfirmed(true);
    setPendingAutoSignals(null);
    await autoExecuteSignals(signalsToExecute);
    setAutoTradeConfirmed(false);
  };

  // Auto-execute signals
  const autoExecuteSignals = async (eligible: TradingSignal[]) => {
    setAutoTrading(true);
    toast.info(`Auto-trading: executing ${eligible.length} signal(s)...`);

    const results: Record<number, { success: boolean; ticket?: number; error?: string }> = {};
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < eligible.length; i++) {
      const signal = eligible[i];
      executedSignalIds.current.add(signal.id);
      // M-13: Prevent unbounded growth
      if (executedSignalIds.current.size > 500) {
        const arr = [...executedSignalIds.current];
        executedSignalIds.current = new Set(arr.slice(-200));
      }

      try {
        const result = await executeSignal(signal, isMt5Live);
        results[i] = result;
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        results[i] = { success: false, error: 'Network error' };
        failCount++;
      }

      // Small delay between orders to avoid rate limiting
      if (i < eligible.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    setAutoTradeResults(results);
    setAutoTrading(false);

    const mode = isMt5Live ? 'MT5' : 'Simulation';
    if (failCount === 0) {
      toast.success(`Auto-trading (${mode}): ${successCount}/${eligible.length} orders executed`);
    } else {
      toast.warning(`Auto-trading (${mode}): ${successCount} OK, ${failCount} failed`);
    }
  };

  const filteredSignals = useMemo(() => {
    return signals.filter((s) => {
      if (signalFilter.pair !== 'all' && s.pair !== signalFilter.pair) return false;
      if (signalFilter.strategy !== 'all' && s.strategy !== signalFilter.strategy) return false;
      if (signalFilter.direction !== 'all' && s.direction !== signalFilter.direction) return false;
      return true;
    });
  }, [signals, signalFilter]);

  return (
    <div className="space-y-4">
      {/* Header with generate button and filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Button
          onClick={handleGenerateSignals}
          disabled={signalsLoading || autoTrading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {signalsLoading || autoTrading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Generate Signals
        </Button>
        {isAutoTrading && (
          <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-1">
            <Play className="w-3 h-3 mr-1" /> Auto-Trade ON (≥{AUTO_TRADE_CONFIDENCE_THRESHOLD}%)
          </Badge>
        )}
        {isMt5Live && (
          <Badge className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-1">MT5</Badge>
        )}
        <div className="flex gap-2 flex-wrap">
          <Select value={signalFilter.pair} onValueChange={(v) => setSignalFilter(f => ({ ...f, pair: v }))}>
            <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
              <SelectValue placeholder="All Pairs" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="all" className="text-zinc-200">All Pairs</SelectItem>
              {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={signalFilter.direction} onValueChange={(v) => setSignalFilter(f => ({ ...f, direction: v }))}>
            <SelectTrigger className="w-28 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="all" className="text-zinc-200">All</SelectItem>
              <SelectItem value="BUY" className="text-emerald-400">BUY</SelectItem>
              <SelectItem value="SELL" className="text-rose-400">SELL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Auto-trading progress */}
      {autoTrading && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin shrink-0" />
          <div>
            <p className="text-xs font-medium text-emerald-400">Auto-Trading in Progress{isMt5Live ? ' (MT5 Live)' : ' (Simulation)'}</p>
            <p className="text-[10px] text-emerald-400/70">Executing signals with ≥{AUTO_TRADE_CONFIDENCE_THRESHOLD}% confidence...</p>
          </div>
        </div>
      )}

      {/* Signal cards */}
      {filteredSignals.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800 p-8">
          <div className="text-center">
            <Zap className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
            <h3 className="text-sm text-zinc-400 mb-1">No Active Signals</h3>
            <p className="text-xs text-zinc-500">Click &quot;Generate Signals&quot; to analyze all pairs and generate trading signals.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredSignals.map((signal, i) => {
            const autoResult = autoTradeResults[i];
            return (
              <Card key={i} className={`bg-zinc-900 border-zinc-800 p-4 ${autoResult ? (autoResult.success ? 'border-emerald-500/30' : 'border-rose-500/30') : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{PAIR_DISPLAY[signal.pair]}</span>
                    <Badge className={`text-[10px] ${signal.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {signal.direction === 'BUY' ? <ArrowUpCircle className="w-3 h-3 mr-0.5" /> : <ArrowDownCircle className="w-3 h-3 mr-0.5" />}
                      {signal.direction}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {autoResult && (
                      autoResult.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" title={autoResult.ticket ? `Ticket #${autoResult.ticket}` : 'Executed'} />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-400" title={autoResult.error || 'Failed'} />
                      )
                    )}
                    <Badge variant="outline" className={`text-[10px] border-zinc-700 ${signal.confidence >= AUTO_TRADE_CONFIDENCE_THRESHOLD && isAutoTrading ? 'text-emerald-400 border-emerald-500/30' : 'text-zinc-400'}`}>
                      {signal.confidence.toFixed(0)}%
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Strategy</span>
                    <span className="text-zinc-300">{STRATEGY_LABELS[signal.strategy]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Entry</span>
                    <span className="text-white font-mono">{fmtPrice(signal.pair, signal.entryPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">SL</span>
                    <span className="text-rose-400 font-mono">{fmtPrice(signal.pair, signal.stopLoss)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">TP</span>
                    <span className="text-emerald-400 font-mono">{fmtPrice(signal.pair, signal.takeProfit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Lot Size</span>
                    <span className="text-zinc-300 font-mono">{signal.lotSize}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Strategy reference */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Strategy Reference</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(Object.entries(STRATEGY_DESCS) as [StrategyName, string][]).map(([key, desc]) => (
              <div key={key} className="bg-zinc-800/50 rounded-lg p-3">
                <p className="text-xs font-medium text-zinc-200 mb-1">{STRATEGY_LABELS[key]}</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* C1: Auto-Trade Confirmation Dialog for MT5 */}
      <AlertDialog open={!!pendingAutoSignals} onOpenChange={(open) => { if (!open) setPendingAutoSignals(null); }}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Confirm Auto-Trading on MT5
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {pendingAutoSignals && (
                <>
                  <p className="mb-3">This will execute <strong className="text-amber-400">{pendingAutoSignals.length} real-money order(s)</strong> on MetaTrader 5. Please review the signals below.</p>
                  <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                    {pendingAutoSignals.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300">{PAIR_DISPLAY[s.pair]} <span className={s.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>{s.direction}</span></span>
                        <span className="text-zinc-400">{s.lotSize} lots · {s.confidence.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 text-zinc-300 hover:bg-zinc-800" onClick={() => setPendingAutoSignals(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAutoTradeConfirm}
              disabled={autoTradeConfirmed}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {autoTradeConfirmed ? <><RefreshCw className="w-4 h-4 animate-spin mr-1" /> Executing...</> : 'Confirm All Orders'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
