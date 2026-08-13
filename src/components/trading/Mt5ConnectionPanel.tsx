'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Cable, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Server, Wifi, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useTradingStore } from '@/lib/trading-store';
import type { Mt5AccountInfo, Mt5Position } from '@/lib/trading-types';
import { fmtPrice } from './shared';

export function Mt5ConnectionPanel() {
  const {
    tradingMode, setTradingMode,
    mt5ConnectionStatus, setMt5ConnectionStatus,
    mt5AccountInfo, setMt5AccountInfo,
    mt5Positions, setMt5Positions,
  } = useTradingStore();

  const [bridgeReachable, setBridgeReachable] = useState(false);
  const [eaConnected, setEaConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uptime, setUptime] = useState(0);

  // Check MT5 bridge status
  const checkStatus = useCallback(async () => {
    try {
      setChecking(true);
      const res = await fetch('/api/mt5/connection');
      if (res.ok) {
        const data = await res.json();
        setBridgeReachable(data.bridgeReachable ?? false);
        setEaConnected(data.eaConnected ?? false);
        setUptime(data.uptime ?? 0);

        if (data.eaConnected) {
          setMt5ConnectionStatus('connected');
        } else if (data.bridgeReachable) {
          setMt5ConnectionStatus('disconnected');
        } else {
          setMt5ConnectionStatus('disconnected');
        }
      }
    } catch {
      setBridgeReachable(false);
      setEaConnected(false);
      setMt5ConnectionStatus('disconnected');
    } finally {
      setChecking(false);
    }
  }, [setMt5ConnectionStatus]);

  // Fetch MT5 account info
  const fetchAccountInfo = useCallback(async () => {
    if (mt5ConnectionStatus !== 'connected') return;
    try {
      const res = await fetch('/api/mt5/account');
      if (res.ok) {
        const data = await res.json();
        setMt5AccountInfo(data as Mt5AccountInfo);
      }
    } catch {
      // silent
    }
  }, [mt5ConnectionStatus, setMt5AccountInfo]);

  // Fetch MT5 positions
  const fetchMt5Positions = useCallback(async () => {
    if (mt5ConnectionStatus !== 'connected') return;
    try {
      const res = await fetch('/api/mt5/positions');
      if (res.ok) {
        const data = await res.json();
        setMt5Positions((data.positions ?? []) as Mt5Position[]);
      }
    } catch {
      // silent
    }
  }, [mt5ConnectionStatus, setMt5Positions]);

  // Enable MT5 mode
  const handleEnableMt5 = async () => {
    setMt5ConnectionStatus('connecting');
    setTradingMode('mt5_live');
    try {
      const res = await fetch('/api/mt5/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enable' }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.bridgeReachable) {
        toast.info('Bridge is running. Start the MT5 EA to connect.');
        setBridgeReachable(true);
        setMt5ConnectionStatus('disconnected');
      } else {
        toast.error('MT5 bridge is not running. Start it first.');
        setTradingMode('simulation');
        setMt5ConnectionStatus('disconnected');
      }
    } catch {
      toast.error('Cannot reach MT5 bridge service.');
      setTradingMode('simulation');
      setMt5ConnectionStatus('error');
    }
  };

  // Disable MT5 mode
  const handleDisableMt5 = () => {
    setTradingMode('simulation');
    setMt5ConnectionStatus('disconnected');
    setMt5AccountInfo(null);
    setMt5Positions([]);
    toast.success('Switched to Simulation mode');
  };

  // Auto-check status
  useEffect(() => {
    if (tradingMode === 'mt5_live') {
      checkStatus();
      const interval = setInterval(checkStatus, 10000);
      return () => clearInterval(interval);
    }
  }, [tradingMode, checkStatus]);

  // Auto-fetch account + positions when connected
  useEffect(() => {
    if (mt5ConnectionStatus === 'connected') {
      fetchAccountInfo();
      fetchMt5Positions();
      const interval = setInterval(() => {
        fetchAccountInfo();
        fetchMt5Positions();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [mt5ConnectionStatus, fetchAccountInfo, fetchMt5Positions]);

  const isMt5Live = tradingMode === 'mt5_live';
  const statusColor = mt5ConnectionStatus === 'connected' ? 'text-emerald-400'
    : mt5ConnectionStatus === 'connecting' ? 'text-amber-400'
    : mt5ConnectionStatus === 'error' ? 'text-rose-400'
    : 'text-zinc-500';

  const StatusIcon = mt5ConnectionStatus === 'connected' ? CheckCircle2
    : mt5ConnectionStatus === 'connecting' ? RefreshCw
    : mt5ConnectionStatus === 'error' ? AlertTriangle
    : XCircle;

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="space-y-4">
      {/* MT5 Mode Toggle */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Cable className="w-4 h-4" /> MT5 Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch
                checked={isMt5Live}
                onCheckedChange={(v) => v ? handleEnableMt5() : handleDisableMt5()}
              />
              <div>
                <Label className="text-zinc-200 text-sm">
                  {isMt5Live ? 'MT5 Live Mode' : 'Simulation Mode'}
                </Label>
                <p className="text-[11px] text-zinc-500">
                  {isMt5Live
                    ? 'Orders will be sent to MetaTrader 5'
                    : 'Orders are simulated locally'}
                </p>
              </div>
            </div>
            <Badge className={`text-[10px] ${isMt5Live ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-700 text-zinc-300'}`}>
              {isMt5Live ? 'LIVE' : 'SIM'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Connection Status */}
      {isMt5Live && (
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-white flex items-center gap-2">
                <Server className="w-4 h-4" /> Connection Status
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={checkStatus} disabled={checking}
                className="h-7 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800">
                <RefreshCw className={`w-3 h-3 mr-1 ${checking ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="space-y-3">
              {/* Status indicators */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="flex items-center gap-2 bg-zinc-800/50 rounded-lg p-3">
                  <StatusIcon className={`w-5 h-5 ${statusColor} ${mt5ConnectionStatus === 'connecting' ? 'animate-spin' : ''}`} />
                  <div>
                    <p className="text-xs text-zinc-400">EA Status</p>
                    <p className={`text-sm font-medium ${statusColor}`}>
                      {mt5ConnectionStatus === 'connected' ? 'Connected' :
                        mt5ConnectionStatus === 'connecting' ? 'Connecting...' :
                          mt5ConnectionStatus === 'error' ? 'Error' : 'Disconnected'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-zinc-800/50 rounded-lg p-3">
                  <Server className={`w-5 h-5 ${bridgeReachable ? 'text-emerald-400' : 'text-rose-400'}`} />
                  <div>
                    <p className="text-xs text-zinc-400">Bridge Service</p>
                    <p className={`text-sm font-medium ${bridgeReachable ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {bridgeReachable ? 'Running' : 'Offline'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-zinc-800/50 rounded-lg p-3">
                  <Zap className={`w-5 h-5 ${eaConnected ? 'text-emerald-400' : 'text-zinc-500'}`} />
                  <div>
                    <p className="text-xs text-zinc-400">Uptime</p>
                    <p className="text-sm font-medium text-zinc-300">{fmtUptime(uptime)}</p>
                  </div>
                </div>
              </div>

              {/* Setup instructions when not connected */}
              {!eaConnected && (
                <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-lg p-4">
                  <h4 className="text-xs font-medium text-amber-400 mb-2">Setup Instructions</h4>
                  <ol className="text-[11px] text-zinc-400 space-y-1.5 list-decimal list-inside">
                    <li>Start the MT5 Bridge: <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">cd mini-services/mt5-bridge && bun run dev</code></li>
                    <li>Copy <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">FRXAI_EA.mq5</code> to your MT5 Experts folder and compile in MetaEditor</li>
                    <li>Attach the EA to a chart — it connects via HTTP polling to <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">http://localhost:3004</code> automatically</li>
                    <li>Enable <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">Allow WebRequest</code> in MT5 for <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">http://localhost:3004</code></li>
                  </ol>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* MT5 Account Info */}
      {isMt5Live && mt5ConnectionStatus === 'connected' && mt5AccountInfo && (
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Wifi className="w-4 h-4" /> MT5 Account
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] text-zinc-500">Login</p>
                <p className="text-sm font-mono text-white">{mt5AccountInfo.login}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Name</p>
                <p className="text-sm text-zinc-300">{mt5AccountInfo.name}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Server</p>
                <p className="text-sm text-zinc-300">{mt5AccountInfo.server}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Leverage</p>
                <p className="text-sm font-mono text-white">1:{mt5AccountInfo.leverage}</p>
              </div>
              <Separator className="col-span-full bg-zinc-800" />
              <div>
                <p className="text-[10px] text-zinc-500">Balance</p>
                <p className="text-sm font-mono text-white">{mt5AccountInfo.currency} {mt5AccountInfo.balance.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Equity</p>
                <p className="text-sm font-mono text-emerald-400">{mt5AccountInfo.currency} {mt5AccountInfo.equity.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Margin</p>
                <p className="text-sm font-mono text-amber-400">{mt5AccountInfo.margin.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Free Margin</p>
                <p className={`text-sm font-mono ${mt5AccountInfo.freeMargin > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {mt5AccountInfo.freeMargin.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Margin Level</p>
                <p className={`text-sm font-mono ${mt5AccountInfo.marginLevel > 200 ? 'text-emerald-400' : mt5AccountInfo.marginLevel > 100 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {mt5AccountInfo.marginLevel.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Floating P&L</p>
                <p className={`text-sm font-mono ${mt5AccountInfo.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {mt5AccountInfo.profit >= 0 ? '+' : ''}{mt5AccountInfo.profit.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500">Open Positions</p>
                <p className="text-sm font-mono text-white">{mt5AccountInfo.openPositions}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MT5 Positions */}
      {isMt5Live && mt5ConnectionStatus === 'connected' && (
        <Card className="bg-zinc-900 border-zinc-800 p-4">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              MT5 Positions
              <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-300 ml-auto">{mt5Positions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {mt5Positions.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">No open positions on MT5</p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500">Ticket</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Dir</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Lots</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">Entry</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">SL</TableHead>
                      <TableHead className="text-[10px] text-zinc-500">TP</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 text-right">P&L</TableHead>
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
                        <TableCell className="text-xs text-zinc-300 font-mono">
                          {fmtPrice(pos.pair as 'EURUSD' | 'USDJPY' | 'GBPUSD' | 'XAUUSD', pos.entryPrice)}
                        </TableCell>
                        <TableCell className="text-xs text-rose-400 font-mono">
                          {pos.stopLoss ? fmtPrice(pos.pair as 'EURUSD' | 'USDJPY' | 'GBPUSD' | 'XAUUSD', pos.stopLoss) : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-emerald-400 font-mono">
                          {pos.takeProfit ? fmtPrice(pos.pair as 'EURUSD' | 'USDJPY' | 'GBPUSD' | 'XAUUSD', pos.takeProfit) : '-'}
                        </TableCell>
                        <TableCell className={`text-xs font-mono text-right ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
