'use client';

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Bell, Plus, CheckCircle2, Trash2, Loader2, XCircle, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
import { useTradingStore } from '@/lib/trading-store';

const CONDITION_LABELS: Record<string, { label: string; color: string }> = {
  above: { label: 'Above', color: 'text-emerald-400' },
  below: { label: 'Below', color: 'text-rose-400' },
  crosses_above: { label: 'Crosses Above', color: 'text-emerald-400' },
  crosses_below: { label: 'Crosses Below', color: 'text-rose-400' },
};

export function PriceAlertsPanel() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [firedAlerts, setFiredAlerts] = useState<PriceAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [newAlert, setNewAlert] = useState({
    pair: 'EURUSD' as ForexPair,
    condition: 'above' as PriceAlert['condition'],
    targetPrice: 1.1,
    note: '',
    emailNotify: false,
  });
  const [createAlertDialog, setCreateAlertDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const prevTriggeredRef = useRef<string[]>([]);

  const quotes = useTradingStore(s => s.quotes);

  const currentMidPrice = (pair: ForexPair): number | null => {
    const q = quotes[pair];
    return q ? q.mid : null;
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/alerts');
        if (res.ok) {
          const data = await res.json();
          const all = (data.alerts || []) as PriceAlert[];
          setAlerts(all.filter(a => !a.isTriggered));
          setFiredAlerts(all.filter(a => a.isTriggered));
        }
      } catch { /* silent */ }
      finally { setAlertsLoading(false); }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  // Show toast when alerts trigger
  useEffect(() => {
    const firedIds = firedAlerts.map(a => a.id);
    const newIds = firedIds.filter(id => !prevTriggeredRef.current.includes(id));
    if (newIds.length > 0) {
      for (const id of newIds) {
        const alert = firedAlerts.find(a => a.id === id);
        if (alert) {
          toast.success(`🔔 ${PAIR_DISPLAY[alert.pair]} ${alert.condition.replace('_', ' ')} ${fmtPrice(alert.pair, alert.targetPrice)}`);
        }
      }
    }
    prevTriggeredRef.current = firedIds;
  }, [firedAlerts]);

  const refreshAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const data = await res.json();
        const all = (data.alerts || []) as PriceAlert[];
        setAlerts(all.filter(a => !a.isTriggered));
        setFiredAlerts(all.filter(a => a.isTriggered));
      }
    } catch { /* silent */ }
  };

  const handleCreateAlert = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAlert),
      });
      if (res.ok) {
        toast.success('Alert berhasil dibuat');
        setCreateAlertDialog(false);
        setNewAlert({ pair: 'EURUSD', condition: 'above', targetPrice: 1.1, note: '', emailNotify: false });
        refreshAlerts();
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        toast.error(data.error || 'Gagal membuat alert');
      }
    } catch { toast.error('Gagal membuat alert'); }
    finally { setSubmitting(false); }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      const res = await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Alert dihapus');
        refreshAlerts();
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        toast.error(data.error || 'Gagal menghapus alert');
      }
    } catch { toast.error('Gagal menghapus alert'); }
  };

  const handleClearTriggered = async () => {
    try {
      const res = await fetch('/api/alerts?clearTriggered=true', { method: 'DELETE' });
      if (res.ok) {
        toast.success('Riwayat alert dibersihkan');
        refreshAlerts();
      }
    } catch { toast.error('Gagal membersihkan'); }
  };

  const handleToggleAlert = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch('/api/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive }),
      });
      if (res.ok) {
        refreshAlerts();
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        toast.error(data.error || 'Gagal mengubah status');
      }
    } catch { toast.error('Gagal mengubah status'); }
  };

  const mid = currentMidPrice(newAlert.pair);
  const isValid = newAlert.targetPrice > 0 && FOREX_PAIRS.includes(newAlert.pair);

  return (
    <div className="space-y-4">
      <Dialog open={createAlertDialog} onOpenChange={setCreateAlertDialog}>
        <DialogTrigger asChild>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="w-4 h-4" /> Buat Alert
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-zinc-900 border-zinc-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Buat Price Alert</DialogTitle>
            <DialogDescription className="text-zinc-400">Atur alert harga untuk pasangan mata uang</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300">Pasangan</Label>
                <Select value={newAlert.pair} onValueChange={(v) => setNewAlert(a => ({ ...a, pair: v as ForexPair }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {FOREX_PAIRS.map(p => (
                      <SelectItem key={p} value={p} className="text-zinc-200">{PAIR_DISPLAY[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">Kondisi</Label>
                <Select value={newAlert.condition} onValueChange={(v) => setNewAlert(a => ({ ...a, condition: v as PriceAlert['condition'] }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {Object.entries(CONDITION_LABELS).map(([value, c]) => (
                      <SelectItem key={value} value={value} className={c.color}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-300">Target Harga</Label>
                {mid !== null && (
                  <button
                    type="button"
                    onClick={() => setNewAlert(a => ({ ...a, targetPrice: mid }))}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    Pakai harga saat ini: {fmtPrice(newAlert.pair, mid)}
                  </button>
                )}
              </div>
              <Input
                type="number"
                step="0.00001"
                value={newAlert.targetPrice}
                onChange={(e) => setNewAlert(a => ({ ...a, targetPrice: parseFloat(e.target.value) || 0 }))}
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Catatan <span className="text-zinc-500">(opsional)</span></Label>
              <Textarea
                value={newAlert.note}
                onChange={(e) => setNewAlert(a => ({ ...a, note: e.target.value }))}
                placeholder="Contoh: Konfirmasi breakout..."
                className="bg-zinc-800 border-zinc-700 text-white min-h-[60px] resize-none"
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={newAlert.emailNotify} onCheckedChange={(v) => setNewAlert(a => ({ ...a, emailNotify: v }))} />
              <Label className="text-zinc-300 text-sm">Notifikasi email</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAlertDialog(false)} className="border-zinc-700 text-zinc-300">Batal</Button>
            <Button onClick={handleCreateAlert} disabled={!isValid || submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Buat Alert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Bell className="w-4 h-4" /> Alert Aktif
            <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-300 ml-auto">{alerts.filter(a => a.isActive).length} aktif</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {alertsLoading ? (
            <div className="space-y-2 py-8">
              <div className="flex items-center justify-center gap-2 text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Memuat alert...</span>
              </div>
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full bg-zinc-800" />)}
            </div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-8">
              <Bell className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">Belum ada alert. Klik Buat Alert untuk membuat.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-[10px] text-zinc-500">Pasangan</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Kondisi</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Target</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Email</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Status</TableHead>
                  <TableHead className="text-[10px] text-zinc-500 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => {
                  const condInfo = CONDITION_LABELS[alert.condition] || { label: alert.condition, color: 'text-zinc-400' };
                  return (
                    <TableRow key={alert.id} className={`border-zinc-800/50 ${!alert.isActive ? 'opacity-50' : ''}`}>
                      <TableCell className="text-xs text-zinc-200 font-mono">{PAIR_DISPLAY[alert.pair]}</TableCell>
                      <TableCell className="text-xs">{alert.note && <AlertCircle className="w-3 h-3 inline mr-1 text-zinc-500" />}{condInfo.label}</TableCell>
                      <TableCell className="text-xs text-white font-mono">{fmtPrice(alert.pair, alert.targetPrice)}</TableCell>
                      <TableCell className="text-xs">{alert.emailNotify ? '✉️' : '-'}</TableCell>
                      <TableCell>
                        <Switch checked={alert.isActive} onCheckedChange={(v) => handleToggleAlert(alert.id, v)} className="scale-75" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          aria-label="Hapus alert"
                          onClick={() => handleDeleteAlert(alert.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Alert Terpicu
              {firedAlerts.length > 0 && (
                <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-400">{firedAlerts.length}</Badge>
              )}
            </CardTitle>
            {firedAlerts.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                onClick={handleClearTriggered}
              >
                <XCircle className="w-3 h-3 mr-1" /> Bersihkan
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {firedAlerts.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-4">Belum ada alert yang terpicu</p>
          ) : (
            <ScrollArea className="max-h-48">
              <div className="space-y-1.5">
                {firedAlerts.slice(0, 20).map((alert) => {
                  const condInfo = CONDITION_LABELS[alert.condition] || { label: alert.condition, color: 'text-zinc-400' };
                  return (
                    <div key={alert.id} className="flex items-center justify-between bg-zinc-800/30 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span className="text-xs text-zinc-300 font-mono">{PAIR_DISPLAY[alert.pair]}</span>
                        <span className="text-xs text-zinc-400">{condInfo.label}</span>
                        <span className="text-xs text-white font-mono">{fmtPrice(alert.pair, alert.targetPrice)}</span>
                        {alert.note && <span className="text-[10px] text-zinc-500 truncate max-w-[100px]" title={alert.note}>📝</span>}
                      </div>
                      <span className="text-[10px] text-zinc-500">{alert.triggeredAt ? format(new Date(alert.triggeredAt), 'MM/dd HH:mm') : '-'}</span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
