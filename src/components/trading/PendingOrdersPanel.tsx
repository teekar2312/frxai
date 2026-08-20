'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Clock, Plus, X, Loader2, Inbox,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EXTENDED_PAIRS, EXTENDED_PAIR_DISPLAY } from '@/lib/trading-types';
import type { PendingOrder, PendingOrderType } from '@/lib/trading-types';


// ============================================================
// Types
// ============================================================

interface CreateOrderForm {
  pair: string;
  orderType: PendingOrderType;
  direction: 'BUY' | 'SELL';
  lotSize: string;
  price: string;
  stopLoss: string;
  takeProfit: string;
}

// ============================================================
// Constants
// ============================================================

const ORDER_TYPE_OPTIONS: { value: PendingOrderType; label: string }[] = [
  { value: 'buy_limit', label: 'Buy Limit' },
  { value: 'sell_limit', label: 'Sell Limit' },
  { value: 'buy_stop', label: 'Buy Stop' },
  { value: 'sell_stop', label: 'Sell Stop' },
];

const ORDER_TYPE_CONFIG: Record<PendingOrderType, { label: string; color: string; badgeClass: string }> = {
  buy_limit: { label: 'Buy Limit', color: 'text-emerald-400', badgeClass: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' },
  sell_limit: { label: 'Sell Limit', color: 'text-rose-400', badgeClass: 'border-rose-500/30 text-rose-400 bg-rose-500/5' },
  buy_stop: { label: 'Buy Stop', color: 'text-sky-400', badgeClass: 'border-sky-500/30 text-sky-400 bg-sky-500/5' },
  sell_stop: { label: 'Sell Stop', color: 'text-amber-400', badgeClass: 'border-amber-500/30 text-amber-400 bg-amber-500/5' },
};

const EMPTY_FORM: CreateOrderForm = {
  pair: 'EURUSD',
  orderType: 'buy_limit',
  direction: 'BUY',
  lotSize: '0.01',
  price: '',
  stopLoss: '',
  takeProfit: '',
};

// ============================================================
// Helpers
// ============================================================


// ============================================================
// Main Component
// ============================================================

export function PendingOrdersPanel() {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateOrderForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Fetch pending orders
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pending-orders');
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Validate form
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!form.pair) errors.pair = 'Pilih pasangan';

    const lot = parseFloat(form.lotSize);
    if (!form.lotSize || isNaN(lot) || lot <= 0) {
      errors.lotSize = 'Ukuran lot harus lebih dari 0';
    }

    const price = parseFloat(form.price);
    if (!form.price || isNaN(price) || price <= 0) {
      errors.price = 'Harga target harus lebih dari 0';
    }

    if (form.stopLoss) {
      const sl = parseFloat(form.stopLoss);
      if (isNaN(sl) || sl <= 0) errors.stopLoss = 'SL tidak valid';
    }

    if (form.takeProfit) {
      const tp = parseFloat(form.takeProfit);
      if (isNaN(tp) || tp <= 0) errors.takeProfit = 'TP tidak valid';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Create order
  const handleCreate = async () => {
    if (!validateForm()) return;

    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        pair: form.pair,
        orderType: form.orderType,
        direction: form.direction,
        lotSize: parseFloat(form.lotSize),
        price: parseFloat(form.price),
      };

      if (form.stopLoss) body.stopLoss = parseFloat(form.stopLoss);
      if (form.takeProfit) body.takeProfit = parseFloat(form.takeProfit);

      const res = await fetch('/api/pending-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success('Order tertunda berhasil dibuat');
        setForm(EMPTY_FORM);
        setFormErrors({});
        setDialogOpen(false);
        fetchOrders();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Gagal membuat order');
      }
    } catch {
      toast.error('Terjadi kesalahan jaringan');
    } finally {
      setCreating(false);
    }
  };

  // Cancel order
  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      const res = await fetch('/api/pending-orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'cancel' }),
      });

      if (res.ok) {
        toast.success('Order dibatalkan');
        setOrders((prev) => prev.filter((o) => o.id !== id));
      } else {
        toast.error('Gagal membatalkan order');
      }
    } catch {
      toast.error('Terjadi kesalahan jaringan');
    } finally {
      setCancellingId(null);
    }
  };

  // Derive direction from order type (auto)
  const handleOrderTypeChange = (type: PendingOrderType) => {
    const direction: 'BUY' | 'SELL' = type.startsWith('buy') ? 'BUY' : 'SELL';
    setForm((prev) => ({ ...prev, orderType: type, direction }));
  };

  // Get pair display name
  const getPairDisplay = (pair: string) => {
    return EXTENDED_PAIR_DISPLAY[pair] ?? pair;
  };

  // Get price decimals for a pair
  const getDecimals = (pair: string) => {
    return pair === 'XAUUSD' || pair === 'USDJPY' ? 3 : 5;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-zinc-400" />
          <h2 className="text-lg font-semibold text-zinc-100">Order Tertunda</h2>
          {orders.length > 0 && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-400 text-xs">
              {orders.length}
            </Badge>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Buat Order Tertunda
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-800 max-w-md">
            <DialogHeader>
              <DialogTitle className="text-zinc-100">Buat Order Tertunda</DialogTitle>
              <DialogDescription className="text-zinc-400">
                Tentukan parameter order yang akan dieksekusi saat harga mencapai target.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Pair */}
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Pasangan</Label>
                <Select value={form.pair} onValueChange={(v) => setForm((prev) => ({ ...prev, pair: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {EXTENDED_PAIRS.map((p) => (
                      <SelectItem key={p} value={p} className="text-zinc-200 focus:bg-zinc-700">
                        {getPairDisplay(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Order Type */}
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Tipe Order</Label>
                <Select value={form.orderType} onValueChange={(v) => handleOrderTypeChange(v as PendingOrderType)}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {ORDER_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-zinc-200 focus:bg-zinc-700">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Direction */}
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Arah</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={form.direction === 'BUY' ? 'default' : 'outline'}
                    className={`flex-1 text-xs h-9 ${
                      form.direction === 'BUY'
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                    }`}
                    onClick={() => setForm((prev) => ({ ...prev, direction: 'BUY' }))}
                  >
                    BUY
                  </Button>
                  <Button
                    type="button"
                    variant={form.direction === 'SELL' ? 'default' : 'outline'}
                    className={`flex-1 text-xs h-9 ${
                      form.direction === 'SELL'
                        ? 'bg-rose-600 hover:bg-rose-700 text-white'
                        : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                    }`}
                    onClick={() => setForm((prev) => ({ ...prev, direction: 'SELL' }))}
                  >
                    SELL
                  </Button>
                </div>
              </div>

              {/* Lot Size */}
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Ukuran Lot</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.lotSize}
                  onChange={(e) => setForm((prev) => ({ ...prev, lotSize: e.target.value }))}
                  className={`bg-zinc-800 border-zinc-700 text-white ${formErrors.lotSize ? 'border-rose-500' : ''}`}
                  placeholder="0.01"
                />
                {formErrors.lotSize && <p className="text-xs text-rose-400">{formErrors.lotSize}</p>}
              </div>

              {/* Target Price */}
              <div className="space-y-2">
                <Label className="text-zinc-300 text-sm">Harga Target</Label>
                <Input
                  type="number"
                  step={form.pair === 'XAUUSD' || form.pair === 'USDJPY' ? '0.01' : '0.00001'}
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  className={`bg-zinc-800 border-zinc-700 text-white ${formErrors.price ? 'border-rose-500' : ''}`}
                  placeholder="1.08500"
                />
                {formErrors.price && <p className="text-xs text-rose-400">{formErrors.price}</p>}
              </div>

              {/* SL / TP Row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-zinc-300 text-sm">Stop Loss</Label>
                  <Input
                    type="number"
                    step={form.pair === 'XAUUSD' || form.pair === 'USDJPY' ? '0.01' : '0.00001'}
                    value={form.stopLoss}
                    onChange={(e) => setForm((prev) => ({ ...prev, stopLoss: e.target.value }))}
                    className={`bg-zinc-800 border-zinc-700 text-white ${formErrors.stopLoss ? 'border-rose-500' : ''}`}
                    placeholder="Opsional"
                  />
                  {formErrors.stopLoss && <p className="text-xs text-rose-400">{formErrors.stopLoss}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-zinc-300 text-sm">Take Profit</Label>
                  <Input
                    type="number"
                    step={form.pair === 'XAUUSD' || form.pair === 'USDJPY' ? '0.01' : '0.00001'}
                    value={form.takeProfit}
                    onChange={(e) => setForm((prev) => ({ ...prev, takeProfit: e.target.value }))}
                    className={`bg-zinc-800 border-zinc-700 text-white ${formErrors.takeProfit ? 'border-rose-500' : ''}`}
                    placeholder="Opsional"
                  />
                  {formErrors.takeProfit && <p className="text-xs text-rose-400">{formErrors.takeProfit}</p>}
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => { setDialogOpen(false); setFormErrors({}); }}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Batal
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Buat Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <Card className="bg-zinc-900 border-zinc-800">
        {loading ? (
          <CardContent className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-4 w-16 bg-zinc-800" />
                <Skeleton className="h-4 w-20 bg-zinc-800" />
                <Skeleton className="h-4 w-10 bg-zinc-800" />
                <Skeleton className="h-4 w-12 bg-zinc-800" />
                <Skeleton className="h-4 w-16 bg-zinc-800" />
                <Skeleton className="h-4 w-16 bg-zinc-800" />
                <Skeleton className="h-4 w-16 bg-zinc-800" />
                <Skeleton className="h-4 w-8 bg-zinc-800" />
              </div>
            ))}
          </CardContent>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Inbox className="w-12 h-12 mb-3" />
            <p className="text-sm">Tidak ada order tertunda</p>
            <p className="text-xs text-zinc-600 mt-1">Klik tombol di atas untuk membuat order baru</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Pasangan</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Tipe</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Arah</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Lot</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9 text-right">Harga Target</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9 text-right">SL</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9 text-right">TP</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Status</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const config = ORDER_TYPE_CONFIG[order.orderType];
                  return (
                    <TableRow key={order.id} className="border-zinc-800/50 hover:bg-zinc-800/30">
                      <TableCell className="py-2.5">
                        <span className="text-sm font-medium text-zinc-100">
                          {getPairDisplay(order.pair)}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${config.badgeClass}`}>
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <span className={`text-xs font-bold ${
                          order.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {order.direction}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-300 py-2.5 font-mono">
                        {order.lotSize}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-300 py-2.5 text-right font-mono">
                        {order.price.toFixed(getDecimals(order.pair))}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500 py-2.5 text-right font-mono">
                        {order.stopLoss ? order.stopLoss.toFixed(getDecimals(order.pair)) : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500 py-2.5 text-right font-mono">
                        {order.takeProfit ? order.takeProfit.toFixed(getDecimals(order.pair)) : '-'}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 h-5 ${
                            order.status === 'pending'
                              ? 'border-amber-500/30 text-amber-400'
                              : order.status === 'executed'
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-zinc-700 text-zinc-500'
                          }`}
                        >
                          {order.status === 'pending' ? 'Menunggu' : order.status === 'executed' ? 'Tereksekusi' : order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        {order.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                            onClick={() => handleCancel(order.id)}
                            disabled={cancellingId === order.id}
                          >
                            {cancellingId === order.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <X className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
