'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Square, LineChart, Cable, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  type ForexPair, type TradingDirection, type StrategyName,
  FOREX_PAIRS, PAIR_DISPLAY, STRATEGY_LABELS,
} from '@/lib/trading-types';
import { useTradingStore } from '@/lib/trading-store';
import { type Position, type EquityPoint, type TradingConfig, fmtPrice } from './shared';

export function LiveTradingPanel() {
  const {
    accountBalance, isAutoTrading, toggleAutoTrading, setServerConfig,
    tradingMode, mt5ConnectionStatus, mt5AccountInfo, mt5Positions, serverConfig,
    setDailyPnl, setOpenPositionsCount,
  } = useTradingStore();

  const isMt5Live = tradingMode === 'mt5_live' && mt5ConnectionStatus === 'connected';
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);
  const [newTradeDialog, setNewTradeDialog] = useState(false);
  const [newTrade, setNewTrade] = useState({
    pair: 'EURUSD' as ForexPair,
    direction: 'BUY' as TradingDirection,
    lotSize: 0.01,
    stopLoss: 0,
    takeProfit: 0,
    strategy: 'EMA_CROSSOVER' as StrategyName,
  });
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(false);
  const [confirmOrder, setConfirmOrder] = useState<{
    pair: ForexPair;
    direction: TradingDirection;
    lotSize: number;
    stopLoss: number;
    takeProfit: number;
    strategy: StrategyName;
    trailingStop: boolean;
  } | null>(null);

  // AUDIT-TRADE-01: Fetch server config to sync autoTrading and accountBalance
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          if (data.config) {
            setServerConfig({
              autoTrading: data.config.autoTrading,
              avoidNewsTrading: data.config.avoidNewsTrading,
              maxOpenPositions: data.config.maxOpenPositions,
              dailyTargetMax: data.config.dailyTargetMax,
              accountBalance: data.config.accountBalance,
              leverage: data.config.leverage,
              trailingStopPips: data.config.trailingStopPips,
              autoTrailingStop: data.config.autoTrailingStop,
            });
          }
        }
      } catch {
        // non-critical
      }
    };
    loadConfig();
  }, [setServerConfig]);

  // L2: Sync simulation state to store (sidebar uses these values)
  useEffect(() => {
    if (isMt5Live) return;
    const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    setDailyPnl(totalPnl);
    setOpenPositionsCount(positions.length);
  }, [positions, isMt5Live, setDailyPnl, setOpenPositionsCount]);

  // Fetch positions and process trailing stops (for polling)
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
      // TS-01: Process trailing stops for simulation positions
      if (!isMt5Live) {
        fetch('/api/trailing-stop/process', { method: 'POST' }).catch(() => {});
      } else {
        // TS-03: Process trailing stops for MT5 live positions
        fetch('/api/mt5/trailing-stop', { method: 'POST' }).catch(() => {});
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [isMt5Live]);

  // AUDIT-TRADE-09: Populate equity history from positions data
  useEffect(() => {
    if (isMt5Live || positions.length === 0) return;
    const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    setEquityHistory(prev => {
      const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const entry: EquityPoint = { time: now, equity: parseFloat((accountBalance + totalPnl).toFixed(2)), balance: accountBalance };
      // Keep last 60 points
      const next = [...prev, entry];
      return next.length > 60 ? next.slice(-60) : next;
    });
  }, [positions, isMt5Live, accountBalance]);

  // Fetch positions (for manual refresh after actions)
  const refreshPositions = async () => {
    try {
      const res = await fetch('/api/positions?status=open');
      if (res.ok) {
        const data = await res.json();
        setPositions((data.positions || []) as Position[]);
      }
    } catch {
      // silent
    }
    setPositionsLoading(false);
  };

  // Execute MT5 order (called after confirmation)
  const executeMt5Order = async (order: typeof confirmOrder) => {
    if (!order) return;
    try {
      const res = await fetch('/api/mt5/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: order.pair,
          direction: order.direction,
          lotSize: order.lotSize,
          stopLoss: order.stopLoss || undefined,
          takeProfit: order.takeProfit || undefined,
          comment: `FINEX-${order.strategy}`,
        }),
      });
      const data = res.ok ? await res.json() : await res.json();
      if (res.ok && data.success) {
        toast.success(`MT5 ${order.direction} ${PAIR_DISPLAY[order.pair]} @ ${order.lotSize} lots (Ticket #${data.ticket})`);
        setNewTradeDialog(false);
      } else {
        toast.error(data.error || 'MT5 order failed');
      }
    } catch {
      toast.error('Network error sending MT5 order');
    }
  };

  // Open new trade
  const handleOpenTrade = async () => {
    try {
      if (isMt5Live) {
        // Show confirmation dialog for MT5 live orders
        setConfirmOrder({ ...newTrade, trailingStop: trailingStopEnabled });
        return;
      } else {
        // Simulation mode - local
        // AUDIT-TRADE-11: Send trailingStop pips value from config
        const trailingStopValue = trailingStopEnabled ? (serverConfig?.trailingStopPips ?? 10) : null;
        const res = await fetch('/api/positions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pair: newTrade.pair,
            direction: newTrade.direction,
            lotSize: newTrade.lotSize,
            stopLoss: newTrade.stopLoss || null,
            takeProfit: newTrade.takeProfit || null,
            strategy: newTrade.strategy,
            trailingStop: trailingStopValue,
          }),
        });
        if (res.ok) {
          toast.success(`${newTrade.direction} ${PAIR_DISPLAY[newTrade.pair]} @ ${newTrade.lotSize} lots`);
          setNewTradeDialog(false);
          refreshPositions();
        } else {
          const data = await res.json();
          toast.error(data.error || 'Failed to open trade');
        }
      }
    } catch {
      toast.error('Network error opening trade');
    }
  };

  // Close position
  const handleClosePosition = async (id: string) => {
    try {
      const res = await fetch('/api/positions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'close' }),
      });
      if (res.ok) {
        toast.success('Position closed');
        refreshPositions();
      }
    } catch {
      toast.error('Failed to close position');
    }
  };

  const totalPnl = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
  const CONTRACT_SIZE = 100000; // Standard lot size in units
  // AUDIT-TRADE-08: Read leverage from server config instead of hardcoding
  const leverage = serverConfig?.leverage ?? 100;
  const marginUsed = positions.reduce((sum, p) => sum + (p.lotSize * CONTRACT_SIZE / leverage), 0);
  const displayBalance = isMt5Live && mt5AccountInfo ? mt5AccountInfo.balance : accountBalance;
  const displayEquity = isMt5Live && mt5AccountInfo ? mt5AccountInfo.equity : (accountBalance + totalPnl);
  const displayMargin = isMt5Live && mt5AccountInfo ? mt5AccountInfo.margin : marginUsed;
  const displayFreeMargin = isMt5Live && mt5AccountInfo ? mt5AccountInfo.freeMargin : (displayEquity - marginUsed);
  const displayPnl = isMt5Live && mt5AccountInfo ? mt5AccountInfo.profit : totalPnl;
  const displayPositions = isMt5Live ? mt5Positions.length : positions.length;

  return (
    <div className="space-y-4">
      {/* MT5 Live mode banner */}
      {isMt5Live && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-center gap-3">
          <Cable className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-xs font-medium text-amber-400">MT5 Live Mode Active</p>
            <p className="text-[10px] text-amber-400/70">Orders are executed on MetaTrader 5. Account #{mt5AccountInfo?.login ?? '...'}</p>
          </div>
        </div>
      )}

      {/* Account summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Balance', value: `$${displayBalance.toLocaleString()}`, color: 'text-white' },
          { label: 'Equity', value: `$${displayEquity.toFixed(2)}`, color: 'text-white' },
          { label: 'Margin Used', value: `$${displayMargin.toFixed(2)}`, color: 'text-amber-400' },
          { label: 'Free Margin', value: `$${displayFreeMargin.toFixed(2)}`, color: displayFreeMargin > 0 ? 'text-emerald-400' : 'text-rose-400' },
          { label: 'Daily P&L', value: `${displayPnl >= 0 ? '+' : ''}${displayPnl.toFixed(2)}`, color: displayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400' },
          { label: 'Open Trades', value: String(displayPositions), color: 'text-white' },
        ].map((item) => (
          <Card key={item.label} className="bg-zinc-900 border-zinc-800 p-3">
            <p className="text-[10px] text-zinc-500 mb-1">{item.label}</p>
            <p className={`text-sm font-mono font-bold ${item.color}`}>{item.value}</p>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <Dialog open={newTradeDialog} onOpenChange={setNewTradeDialog}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-4 h-4" /> New Trade
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">New Trade</DialogTitle>
              <DialogDescription className="text-zinc-400">Open a new trading position</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Pair</Label>
                  <Select value={newTrade.pair} onValueChange={(v) => setNewTrade(t => ({ ...t, pair: v as ForexPair }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Direction</Label>
                  <Select value={newTrade.direction} onValueChange={(v) => setNewTrade(t => ({ ...t, direction: v as TradingDirection }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="BUY" className="text-emerald-400">BUY</SelectItem>
                      <SelectItem value="SELL" className="text-rose-400">SELL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Lot Size</Label>
                  <Input type="number" step="0.01" min="0.01" value={newTrade.lotSize}
                    onChange={(e) => setNewTrade(t => ({ ...t, lotSize: parseFloat(e.target.value) || 0.01 }))}
                    className="bg-zinc-800 border-zinc-700 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Strategy</Label>
                  <Select value={newTrade.strategy} onValueChange={(v) => setNewTrade(t => ({ ...t, strategy: v as StrategyName }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      {(Object.entries(STRATEGY_LABELS) as [StrategyName, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-zinc-200">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-zinc-300">Stop Loss (price)</Label>
                  <Input type="number" step="0.00001" value={newTrade.stopLoss || ''}
                    onChange={(e) => setNewTrade(t => ({ ...t, stopLoss: parseFloat(e.target.value) || 0 }))}
                    placeholder="Optional" className="bg-zinc-800 border-zinc-700 text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Take Profit (price)</Label>
                  <Input type="number" step="0.00001" value={newTrade.takeProfit || ''}
                    onChange={(e) => setNewTrade(t => ({ ...t, takeProfit: parseFloat(e.target.value) || 0 }))}
                    placeholder="Optional" className="bg-zinc-800 border-zinc-700 text-white" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={trailingStopEnabled} onCheckedChange={setTrailingStopEnabled} />
                <Label className="text-zinc-300 text-sm">Enable Trailing Stop</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewTradeDialog(false)} className="border-zinc-700 text-zinc-300">Cancel</Button>
              <Button onClick={handleOpenTrade} className={newTrade.direction === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}>
                Open {newTrade.direction}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex items-center gap-2">
          <Label className="text-zinc-400 text-xs">Auto Trading</Label>
          <Switch checked={isAutoTrading} onCheckedChange={toggleAutoTrading} />
        </div>
      </div>

      {/* Open positions table */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">
            Open Positions
            {isMt5Live && (
              <Badge className="text-[10px] bg-amber-500/20 text-amber-400 ml-2">MT5 LIVE</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {positionsLoading && !isMt5Live ? (
            <div className="space-y-2 py-8">
              <div className="flex items-center justify-center gap-2 text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Loading positions...</span>
              </div>
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-8 w-full bg-zinc-800" />
              ))}
            </div>
          ) : isMt5Live ? (
            mt5Positions.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">No open positions on MT5</p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500">Ticket</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Direction</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Lots</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Entry</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">SL</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">TP</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Trailing</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">P&L</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mt5Positions.map((pos) => (
                      <TableRow key={pos.ticket} className="border-zinc-800/50">
                        <TableCell className="text-xs text-zinc-400 font-mono">#{pos.ticket}</TableCell>
                        <TableCell className="text-xs text-zinc-200 font-mono">{pos.pair}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${pos.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {pos.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-300 font-mono">{pos.lotSize}</TableCell>
                        <TableCell className="text-xs text-zinc-300 font-mono">{pos.entryPrice}</TableCell>
                        <TableCell className="text-xs text-rose-400 font-mono">{pos.stopLoss ?? '-'}</TableCell>
                        <TableCell className="text-xs text-emerald-400 font-mono">{pos.takeProfit ?? '-'}</TableCell>
                        <TableCell>
                          <span className="text-xs text-zinc-500">{serverConfig?.autoTrailingStop ? `${serverConfig.trailingStopPips}p (auto)` : '-'}</span>
                        </TableCell>
                        <TableCell className={`text-xs font-mono text-right ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                            aria-label={`Tutup posisi ${pos.pair}`}
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/mt5/orders?ticket=${pos.ticket}`, { method: 'DELETE' });
                                const data = await res.json();
                                if (data.success) toast.success(`Closed ticket #${pos.ticket}`);
                                else toast.error(data.error || 'Failed to close');
                              } catch { toast.error('Network error'); }
                            }}>
                            <Square className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            positions.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">No open positions</p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Direction</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Lots</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Entry</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">SL</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">TP</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Trailing</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">P&L</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((pos) => (
                      <TableRow key={pos.id} className="border-zinc-800/50">
                        <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[pos.pair]}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${pos.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {pos.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-300 font-mono">{pos.lotSize}</TableCell>
                        <TableCell className="text-xs text-zinc-300 font-mono">{fmtPrice(pos.pair, pos.entryPrice)}</TableCell>
                        <TableCell className="text-xs text-rose-400 font-mono">{pos.stopLoss ? fmtPrice(pos.pair, pos.stopLoss) : '-'}</TableCell>
                        <TableCell className="text-xs text-emerald-400 font-mono">{pos.takeProfit ? fmtPrice(pos.pair, pos.takeProfit) : '-'}</TableCell>
                        <TableCell>
                          {pos.trailingStop ? (
                            <Badge className="text-[10px] bg-amber-500/20 text-amber-400">
                              {pos.trailingStop}p
                            </Badge>
                          ) : <span className="text-xs text-zinc-500">-</span>}
                        </TableCell>
                        <TableCell className={`text-xs font-mono text-right ${(pos.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(pos.pnl || 0) >= 0 ? '+' : ''}{(pos.pnl || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                            aria-label={`Tutup posisi ${pos.pair}`}
                            onClick={() => handleClosePosition(pos.id)}>
                            <Square className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* Equity chart */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Equity Chart</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-48 bg-zinc-800/30 rounded-lg flex items-center justify-center">
            {equityHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#71717a' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                  <RTooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', fontSize: 11 }} />
                  <Area type="monotone" dataKey="equity" stroke="#10b981" fill="#10b98120" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center">
                <LineChart className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">Equity data will appear here as trades are executed</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* MT5 Order Confirmation Dialog */}
      <AlertDialog open={confirmOrder !== null} onOpenChange={(open) => { if (!open) setConfirmOrder(null); }}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Confirm MT5 Order</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This order will be sent to MetaTrader 5 and executed with real funds. Please verify the details below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmOrder && (
            <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2 my-2">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Pair</span>
                <span className="text-white font-mono">{PAIR_DISPLAY[confirmOrder.pair]}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Direction</span>
                <Badge className={`text-[10px] ${confirmOrder.direction === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {confirmOrder.direction}
                </Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Lot Size</span>
                <span className="text-white font-mono">{confirmOrder.lotSize}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Stop Loss</span>
                <span className="text-rose-400 font-mono">{confirmOrder.stopLoss || 'None'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Take Profit</span>
                <span className="text-emerald-400 font-mono">{confirmOrder.takeProfit || 'None'}</span>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmOrder) {
                  executeMt5Order(confirmOrder);
                  setConfirmOrder(null);
                }
              }}
              className={confirmOrder?.direction === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}
            >
              Confirm {confirmOrder?.direction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
