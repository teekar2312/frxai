'use client';

import { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import {
  TrendingUp, TrendingDown, Clock, Brain, BarChart3, Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  type ForexPair,
  FOREX_PAIRS, PAIR_DISPLAY, STRATEGY_LABELS,
  TRADING_SESSIONS, OVERLAP_SESSIONS,
} from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';
import { type Position, fmtPrice, fmtChange } from './shared';

export function DashboardPanel() {
  const {
    selectedPair, setSelectedPair,
    quotes, news, aiAnalysis, marketConditions,
    accountBalance, openPositionsCount, dailyPnl, todayRiskUsed,
  } = useTradingStore();

  const [positions, setPositions] = useState<Position[]>([]);
  const [jakartaTime, setJakartaTime] = useState('');

  // Jakarta clock
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const jakarta = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      setJakartaTime(format(jakarta, 'HH:mm:ss'));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
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
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  // Session status
  const sessionStatus = useMemo(() => {
    const jakartaHour = parseInt(jakartaTime.split(':')[0] || '0', 10);
    const jakartaMin = parseInt(jakartaTime.split(':')[1] || '0', 10);
    const currentHour = jakartaHour + jakartaMin / 60;
    return TRADING_SESSIONS.map((s) => {
      let isActive = false;
      if (s.startHour <= s.endHour) {
        isActive = currentHour >= s.startHour && currentHour < s.endHour;
      } else {
        isActive = currentHour >= s.startHour || currentHour < s.endHour;
      }
      return { ...s, isActive };
    });
  }, [jakartaTime]);

  const overlapStatus = useMemo(() => {
    const jakartaHour = parseInt(jakartaTime.split(':')[0] || '0', 10);
    const jakartaMin = parseInt(jakartaTime.split(':')[1] || '0', 10);
    const currentHour = jakartaHour + jakartaMin / 60;
    return OVERLAP_SESSIONS.map((o) => ({
      ...o,
      isActive: currentHour >= o.startHour && currentHour < o.endHour,
    }));
  }, [jakartaTime]);

  const currentAnalysis = aiAnalysis[selectedPair];

  return (
    <div className="space-y-4">
      {/* Price cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {FOREX_PAIRS.map((pair) => {
          const q = quotes[pair];
          const isUp = q && q.change >= 0;
          const mc = marketConditions[pair];
          if (!q) {
            return (
              <Card key={pair} className="bg-zinc-900 border-zinc-800 p-4 gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-3 w-24" />
              </Card>
            );
          }
          return (
            <Card
              key={pair}
              className={`bg-zinc-900 border-zinc-800 p-4 cursor-pointer transition-all hover:border-zinc-600 ${selectedPair === pair ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : ''}`}
              onClick={() => setSelectedPair(pair)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">{PAIR_DISPLAY[pair]}</span>
                <Badge variant={isUp ? 'default' : 'destructive'} className={`text-[10px] ${isUp ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'}`}>
                  {isUp ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                  {fmtChange(q.change)}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-500">Bid</span>
                  <p className={`font-mono font-medium ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {fmtPrice(pair, q.bid)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500">Ask</span>
                  <p className={`font-mono font-medium ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {fmtPrice(pair, q.ask)}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-500">Spread</span>
                  <p className="font-mono text-zinc-300">{q.spread.toFixed(1)} pip</p>
                </div>
                <div>
                  <span className="text-zinc-500">Market</span>
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                    {mc === 'trending' ? '📈 Trending' : mc === 'range_bound' ? '↔️ Range' : mc === 'high_volatility' ? '⚡ Hi-Vol' : '😴 Low-Vol'}
                  </Badge>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Sessions & Quick AI Analysis row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Trading sessions */}
        <Card className="bg-zinc-900 border-zinc-800 p-4 lg:col-span-2">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Clock className="w-4 h-4" /> Trading Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {sessionStatus.map((s) => (
                <div key={s.name} className={`rounded-lg p-2.5 text-center border ${s.isActive ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-800/50 border-zinc-700/50'}`}>
                  <div className={`text-xs font-medium ${s.isActive ? 'text-emerald-400' : 'text-zinc-500'}`}>{s.name}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{String(s.startHour).padStart(2, '0')}:00-{String(s.endHour).padStart(2, '0')}:00 WIB</div>
                  <div className={`mt-1 inline-block w-2 h-2 rounded-full ${s.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                </div>
              ))}
            </div>
            {/* Overlap sessions */}
            <div className="flex gap-2 flex-wrap">
              {overlapStatus.map((o) => (
                <Badge key={o.name} variant={o.isActive ? 'default' : 'outline'} className={`text-[10px] ${o.isActive ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'border-zinc-700 text-zinc-500'}`}>
                  {o.isActive && '🔥 '}{o.name} {o.isActive ? 'ACTIVE' : ''}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick AI Analysis */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Brain className="w-4 h-4" /> Quick AI Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {currentAnalysis ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] ${currentAnalysis.recommendation === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : currentAnalysis.recommendation === 'SELL' ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-700 text-zinc-300'}`}>
                    {currentAnalysis.recommendation}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                    {STRATEGY_LABELS[currentAnalysis.bestStrategy]}
                  </Badge>
                </div>
                <div className="text-xs text-zinc-400">
                  <div className="flex justify-between mb-1">
                    <span>Confidence</span>
                    <span className="text-white font-mono">{currentAnalysis.confidence.toFixed(0)}%</span>
                  </div>
                  <Progress value={currentAnalysis.confidence} className="h-1.5 bg-zinc-800 [&>div]:bg-emerald-500" />
                </div>
                <p className="text-[11px] text-zinc-500 line-clamp-3">{currentAnalysis.reasoning}</p>
              </div>
            ) : (
              <div className="text-center py-4">
                <Brain className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No analysis yet. Go to AI Analysis tab to run.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* News & Positions row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* News feed */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Recent News
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-72">
              <div className="space-y-2">
                {news.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-4">No news available</p>
                ) : (
                  news.slice(0, 10).map((article) => (
                    <div key={article.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-zinc-800/50 transition-colors">
                      <Badge variant="outline" className={`text-[9px] shrink-0 mt-0.5 border-zinc-700 ${article.impact === 'high' ? 'text-rose-400' : article.impact === 'medium' ? 'text-amber-400' : 'text-zinc-500'}`}>
                        {article.impact}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-200 line-clamp-2 font-medium">{article.title}</p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">{article.source} · {format(new Date(article.publishedAt), 'HH:mm')}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Open positions summary */}
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Activity className="w-4 h-4" /> Open Positions
              <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-300 ml-auto">{positions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-72">
              {positions.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-4">No open positions</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Dir</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Lots</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.slice(0, 5).map((pos) => (
                      <TableRow key={pos.id} className="border-zinc-800/50">
                        <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[pos.pair]}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${pos.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {pos.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-300 font-mono">{pos.lotSize}</TableCell>
                        <TableCell className={`text-xs font-mono text-right ${(pos.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(pos.pnl || 0) >= 0 ? '+' : ''}{(pos.pnl || 0).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Daily performance summary */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Daily Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-zinc-500 mb-1">Total P&L</p>
              <p className={`text-lg font-mono font-bold ${dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {dailyPnl >= 0 ? '+' : ''}{dailyPnl.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 mb-1">Balance</p>
              <p className="text-lg font-mono font-bold text-white">${accountBalance.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 mb-1">Open Trades</p>
              <p className="text-lg font-mono font-bold text-white">{openPositionsCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 mb-1">Daily Risk Used</p>
              <div className="flex items-center gap-2">
                <p className="text-lg font-mono font-bold text-amber-400">{todayRiskUsed.toFixed(1)}%</p>
                <Progress value={Math.min(todayRiskUsed / 3 * 100, 100)} className="flex-1 h-1.5 bg-zinc-800 [&>div]:bg-amber-500" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
