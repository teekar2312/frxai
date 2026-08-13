'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Bell, Plus, CheckCircle2, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { type ForexPair, FOREX_PAIRS, PAIR_DISPLAY } from '@/lib/trading-types';
import { type PriceAlert, fmtPrice } from './shared';

export function PriceAlertsPanel() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<PriceAlert[]>([]);
  const [newAlert, setNewAlert] = useState({
    pair: 'EURUSD' as ForexPair,
    condition: 'above' as PriceAlert['condition'],
    targetPrice: 1.1000,
    emailNotify: false,
  });
  const [createAlertDialog, setCreateAlertDialog] = useState(false);

  // Fetch alerts
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/alerts');
        if (res.ok) {
          const data = await res.json();
          const all = (data.alerts || []) as PriceAlert[];
          setAlerts(all.filter(a => !a.isTriggered));
          setTriggeredAlerts(all.filter(a => a.isTriggered));
        }
      } catch {
        // silent
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const refreshAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const data = await res.json();
        const all = (data.alerts || []) as PriceAlert[];
        setAlerts(all.filter(a => !a.isTriggered));
        setTriggeredAlerts(all.filter(a => a.isTriggered));
      }
    } catch {
      // silent
    }
  };

  // Create alert
  const handleCreateAlert = async () => {
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAlert),
      });
      if (res.ok) {
        toast.success('Alert created');
        setCreateAlertDialog(false);
        refreshAlerts();
      }
    } catch {
      toast.error('Failed to create alert');
    }
  };

  // Delete alert
  const handleDeleteAlert = async (id: string) => {
    try {
      await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
      toast.success('Alert deleted');
      refreshAlerts();
    } catch {
      toast.error('Failed to delete alert');
    }
  };

  // Toggle alert
  const handleToggleAlert = async (id: string, isActive: boolean) => {
    try {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive }),
      });
      refreshAlerts();
    } catch {
      toast.error('Failed to toggle alert');
    }
  };

  return (
    <div className="space-y-4">
      {/* Create alert button */}
      <Dialog open={createAlertDialog} onOpenChange={setCreateAlertDialog}>
        <DialogTrigger asChild>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="w-4 h-4" /> Create Alert
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Create Price Alert</DialogTitle>
            <DialogDescription className="text-zinc-400">Set a price alert for a currency pair</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300">Pair</Label>
                <Select value={newAlert.pair} onValueChange={(v) => setNewAlert(a => ({ ...a, pair: v as ForexPair }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {FOREX_PAIRS.map(p => <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">Condition</Label>
                <Select value={newAlert.condition} onValueChange={(v) => setNewAlert(a => ({ ...a, condition: v as PriceAlert['condition'] }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="above" className="text-emerald-400">Above</SelectItem>
                    <SelectItem value="below" className="text-rose-400">Below</SelectItem>
                    <SelectItem value="crosses_above" className="text-emerald-400">Crosses Above</SelectItem>
                    <SelectItem value="crosses_below" className="text-rose-400">Crosses Below</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Target Price</Label>
              <Input type="number" step="0.00001" value={newAlert.targetPrice}
                onChange={(e) => setNewAlert(a => ({ ...a, targetPrice: parseFloat(e.target.value) || 0 }))}
                className="bg-zinc-800 border-zinc-700 text-white" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={newAlert.emailNotify} onCheckedChange={(v) => setNewAlert(a => ({ ...a, emailNotify: v }))} />
              <Label className="text-zinc-300 text-sm">Email notification</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAlertDialog(false)} className="border-zinc-700 text-zinc-300">Cancel</Button>
            <Button onClick={handleCreateAlert} className="bg-emerald-600 hover:bg-emerald-700 text-white">Create Alert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Active alerts */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Bell className="w-4 h-4" /> Active Alerts
            <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-300 ml-auto">{alerts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-8">No active alerts. Create one above.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-[10px] text-zinc-500">Pair</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Condition</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Target</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Email</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Status</TableHead>
                  <TableHead className="text-[10px] text-zinc-500 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.id} className="border-zinc-800/50">
                    <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[alert.pair]}</TableCell>
                    <TableCell className="text-xs text-zinc-300">{alert.condition.replace('_', ' ')}</TableCell>
                    <TableCell className="text-xs text-white font-mono">{fmtPrice(alert.pair, alert.targetPrice)}</TableCell>
                    <TableCell className="text-xs">{alert.emailNotify ? '✉️' : '-'}</TableCell>
                    <TableCell>
                      <Switch checked={alert.isActive} onCheckedChange={(v) => handleToggleAlert(alert.id, v)} className="scale-75" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                        onClick={() => handleDeleteAlert(alert.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Triggered alerts history */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white">Triggered Alerts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {triggeredAlerts.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">No triggered alerts yet</p>
          ) : (
            <ScrollArea className="max-h-48">
              <div className="space-y-1.5">
                {triggeredAlerts.slice(0, 20).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span className="text-xs text-zinc-300 font-mono">{PAIR_DISPLAY[alert.pair]}</span>
                      <span className="text-xs text-zinc-400">{alert.condition.replace('_', ' ')}</span>
                      <span className="text-xs text-white font-mono">{fmtPrice(alert.pair, alert.targetPrice)}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500">{alert.triggeredAt ? format(new Date(alert.triggeredAt), 'MM/dd HH:mm') : '-'}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
