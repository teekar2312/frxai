'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Brain, RefreshCw, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  type ForexPair, type AiAnalysisResult, type QuoteData,
  FOREX_PAIRS, PAIR_DISPLAY, STRATEGY_LABELS, MARKET_CONDITION_LABELS,
} from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';
import { fmtPrice } from './shared';

export function AiAnalysisPanel() {
  const {
    selectedPair, setSelectedPair, selectedTimeframe,
    quotes, aiAnalysis, setAiAnalysis, setMarketCondition,
  } = useTradingStore();

  const [analysisHistory, setAnalysisHistory] = useState<AiAnalysisResult[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  // AI-010: Track provider/model from last analysis response
  const [lastProvider, setLastProvider] = useState<string>('');
  const [lastModel, setLastModel] = useState<string>('');

  // Fetch analysis history
  // AUDIT-AI-05: Filter by selected pair for focused history
  const fetchAnalysisHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/analysis?pair=${selectedPair}`);
      if (res.ok) {
        const data = await res.json();
        setAnalysisHistory(data.analyses || []);
      }
    } catch {
      // silent
    }
  }, [selectedPair]);

  useEffect(() => {
    fetchAnalysisHistory();
  }, [fetchAnalysisHistory]);

  // Run AI Analysis
  const handleRunAnalysis = async () => {
    setAnalysisLoading(true);
    try {
      const quote = quotes[selectedPair];
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // FIX MKT-ANALYSIS-011: Send timeframe for calibrated analysis
        // FIX MKT-ANALYSIS-001: Server now builds marketData internally
        body: JSON.stringify({ pair: selectedPair, currentPrice: quote?.mid || 0, quote, timeframe: selectedTimeframe }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.analysis) {
          const result = data.analysis as AiAnalysisResult;
          setAiAnalysis(selectedPair, result);
          // FIX MKT-ANALYSIS-003: Update market condition in store
          if (result.marketCondition) {
            setMarketCondition(selectedPair, result.marketCondition);
          }
          // AI-010: Track which provider/model was used
          setLastProvider(data.aiProvider || 'zai');
          setLastModel(data.aiModel || 'default');
          toast.success(`AI Analysis complete for ${PAIR_DISPLAY[selectedPair]}`);
        }
        // FE-014: Refresh analysis history after new analysis
        fetchAnalysisHistory();
      } else {
        toast.error('Failed to run AI analysis');
      }
    } catch {
      toast.error('Network error running analysis');
    } finally {
      setAnalysisLoading(false);
    }
  };

  const currentAnalysis = aiAnalysis[selectedPair];

  return (
    <div className="space-y-4">
      {/* Pair selector & run button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select value={selectedPair} onValueChange={(v) => setSelectedPair(v as ForexPair)}>
          <SelectTrigger className="w-full sm:w-48 bg-zinc-800 border-zinc-700 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            {FOREX_PAIRS.map((p) => (
              <SelectItem key={p} value={p} className="text-zinc-200 focus:bg-zinc-700 focus:text-white">{PAIR_DISPLAY[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={handleRunAnalysis}
          disabled={analysisLoading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {analysisLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
          {lastProvider ? `Run Analysis (${lastProvider}/${lastModel})` : 'Run AI Analysis'}
        </Button>
      </div>

      {/* Analysis result */}
      {currentAnalysis ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Main analysis card */}
          <Card className="bg-zinc-900 border-zinc-800 p-4 lg:col-span-2">
            <CardHeader className="p-0 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm text-white">Analysis: {PAIR_DISPLAY[currentAnalysis.pair]}</CardTitle>
                <div className="flex items-center gap-2">
                  {/* AUDIT-AI-03: Show analysis age and expiry */}
                  {currentAnalysis.createdAt && (
                    <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500">
                      {new Date(currentAnalysis.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </Badge>
                  )}
                  <Badge className={`text-xs ${
                    currentAnalysis.recommendation === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' :
                    currentAnalysis.recommendation === 'SELL' ? 'bg-rose-500/20 text-rose-400' :
                    currentAnalysis.recommendation === 'HOLD' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-zinc-700 text-zinc-400'
                  }`}>
                    {currentAnalysis.recommendation === 'BUY' && <ArrowUpCircle className="w-3 h-3 mr-1" />}
                    {currentAnalysis.recommendation === 'SELL' && <ArrowDownCircle className="w-3 h-3 mr-1" />}
                    {currentAnalysis.recommendation}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 space-y-4">
              {/* Confidence gauge */}
              <div className="flex items-center gap-4">
                <div className="relative w-24 h-24">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#27272a" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke={currentAnalysis.confidence > 0.7 ? '#10b981' : currentAnalysis.confidence > 0.4 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="8"
                      strokeDasharray={`${currentAnalysis.confidence * 100 * 2.51} 251`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-white font-mono">{(currentAnalysis.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <div className="space-y-2 flex-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Market Condition</span>
                    <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-[10px]">{MARKET_CONDITION_LABELS[currentAnalysis.marketCondition]}</Badge>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Risk Level</span>
                    <Badge className={`text-[10px] ${currentAnalysis.riskLevel === 'low' ? 'bg-emerald-500/20 text-emerald-400' : currentAnalysis.riskLevel === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {currentAnalysis.riskLevel}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Best Strategy</span>
                    <span className="text-zinc-200">{STRATEGY_LABELS[currentAnalysis.bestStrategy]}</span>
                  </div>
                </div>
              </div>

              <Separator className="bg-zinc-800" />

              {/* Suggested levels */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {currentAnalysis.entryPrice && (
                  <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500">Entry</p>
                    <p className="text-sm font-mono text-white font-medium">{fmtPrice(currentAnalysis.pair, currentAnalysis.entryPrice)}</p>
                  </div>
                )}
                {currentAnalysis.stopLoss && (
                  <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500">Stop Loss</p>
                    <p className="text-sm font-mono text-rose-400 font-medium">{fmtPrice(currentAnalysis.pair, currentAnalysis.stopLoss)}</p>
                  </div>
                )}
                {currentAnalysis.takeProfit && (
                  <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500">Take Profit</p>
                    <p className="text-sm font-mono text-emerald-400 font-medium">{fmtPrice(currentAnalysis.pair, currentAnalysis.takeProfit)}</p>
                  </div>
                )}
                {currentAnalysis.lotSize && (
                  <div className="bg-zinc-800/50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-zinc-500">Lot Size</p>
                    <p className="text-sm font-mono text-white font-medium">{currentAnalysis.lotSize}</p>
                  </div>
                )}
              </div>

              {/* Reasoning */}
              <div>
                <p className="text-xs text-zinc-400 mb-1 font-medium">AI Reasoning</p>
                <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/30 rounded-lg p-3">{currentAnalysis.reasoning}</p>
              </div>

              {/* News impact */}
              {currentAnalysis.newsImpact && (
                <div>
                  <p className="text-xs text-zinc-400 mb-1 font-medium">News Impact</p>
                  <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/30 rounded-lg p-3">{currentAnalysis.newsImpact}</p>
                </div>
              )}

              {/* Indicators */}
              {currentAnalysis.indicators && currentAnalysis.indicators.length > 0 && (
                <div>
                  <p className="text-xs text-zinc-400 mb-2 font-medium">Recommended Indicators</p>
                  <div className="flex flex-wrap gap-1.5">
                    {currentAnalysis.indicators.map((ind) => (
                      <Badge key={ind.name} variant="outline" className={`text-[10px] border-zinc-700 ${ind.signal === 'bullish' ? 'text-emerald-400' : ind.signal === 'bearish' ? 'text-rose-400' : 'text-zinc-400'}`}>
                        {ind.name}: {ind.signal} ({ind.value != null ? ind.value.toFixed(2) : 'N/A'})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Analysis history */}
          <Card className="bg-zinc-900 border-zinc-800 p-4">
            <CardHeader className="p-0 pb-3">
              <CardTitle className="text-sm text-white">Analysis History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-96">
                {analysisHistory.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-4">No analysis history</p>
                ) : (
                  <div className="space-y-2">
                    {analysisHistory.slice(0, 20).map((a) => (
                      <div key={a.id || `${a.pair}-${a.createdAt}`} className="bg-zinc-800/50 rounded-lg p-2.5 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-zinc-200">{PAIR_DISPLAY[a.pair]}</span>
                          <Badge className={`text-[10px] ${a.recommendation === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : a.recommendation === 'SELL' ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-700 text-zinc-400'}`}>
                            {a.recommendation}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-zinc-500">
                          <span>{STRATEGY_LABELS[a.bestStrategy]}</span>
                          <span>{a.confidence.toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="bg-zinc-900 border-zinc-800 p-8">
          <div className="text-center">
            <Brain className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
            <h3 className="text-sm text-zinc-400 mb-1">No Analysis Available</h3>
            <p className="text-xs text-zinc-500">Select a pair and run AI analysis to get trading recommendations.</p>
          </div>
        </Card>
      )}

      {/* REG-013: AI Disclaimer */}
      <div className="mt-4 p-3 bg-zinc-800/30 rounded-lg border border-zinc-700/30">
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          ⚠️ Sinyal yang dihasilkan oleh AI adalah untuk tujuan informasi saja dan bukan merupakan saran investasi.
          Kinerja masa lalu tidak menjamin hasil di masa depan. Pastikan Anda memahami risiko sebelum mengambil keputusan trading.
        </p>
      </div>
    </div>
  );
}
