'use client';

import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Zap, RefreshCw, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  type ForexPair, type TradingSignal, type StrategyName, type AiAnalysisResult,
  FOREX_PAIRS, PAIR_DISPLAY, STRATEGY_LABELS,
} from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';
import { fmtPrice, STRATEGY_DESCS } from './shared';

export function TradingSignalsPanel() {
  const { quotes, signals, setSignals, setAiAnalysis } = useTradingStore();

  const [signalFilter, setSignalFilter] = useState<{ pair: string; strategy: string; direction: string }>({ pair: 'all', strategy: 'all', direction: 'all' });
  const [signalsLoading, setSignalsLoading] = useState(false);

  // Generate signals for all pairs
  const handleGenerateSignals = async () => {
    setSignalsLoading(true);
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
    } catch {
      toast.error('Failed to generate signals');
    } finally {
      setSignalsLoading(false);
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
          disabled={signalsLoading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {signalsLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Generate Signals
        </Button>
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
          {filteredSignals.map((signal, i) => (
            <Card key={i} className="bg-zinc-900 border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{PAIR_DISPLAY[signal.pair]}</span>
                  <Badge className={`text-[10px] ${signal.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                    {signal.direction === 'BUY' ? <ArrowUpCircle className="w-3 h-3 mr-0.5" /> : <ArrowDownCircle className="w-3 h-3 mr-0.5" />}
                    {signal.direction}
                  </Badge>
                </div>
                <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                  {signal.confidence.toFixed(0)}%
                </Badge>
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
          ))}
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
    </div>
  );
}
