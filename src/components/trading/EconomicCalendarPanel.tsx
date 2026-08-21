'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarDays, Globe } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { EconomicEvent } from '@/lib/trading-types';

// ============================================================
// Types
// ============================================================

type CurrencyFilter = 'ALL' | 'USD' | 'EUR' | 'GBP' | 'JPY';

const CURRENCY_OPTIONS: { value: CurrencyFilter; label: string }[] = [
  { value: 'ALL', label: 'Semua' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'JPY', label: 'JPY' },
];

// ============================================================
// Helpers
// ============================================================

function formatDateString(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

function getNext7Days(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function getImpactDot(impact: string) {
  switch (impact) {
    case 'high':
      return <span className="inline-block w-2 h-2 rounded-full bg-rose-500" title="Dampak Tinggi" />;
    case 'medium':
      return <span className="inline-block w-2 h-2 rounded-full bg-amber-500" title="Dampak Sedang" />;
    case 'low':
      return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" title="Dampak Rendah" />;
    default:
      return <span className="inline-block w-2 h-2 rounded-full bg-zinc-600" />;
  }
}

// ============================================================
// Impact Badge
// ============================================================

function ImpactBadge({ impact }: { impact: string }) {
  if (impact === 'high') {
    return (
      <Badge variant="outline" className="border-rose-500/30 text-rose-400 text-[10px] px-1.5 py-0 h-4">
        Dampak Tinggi
      </Badge>
    );
  }
  if (impact === 'medium') {
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-[10px] px-1.5 py-0 h-4">
        Sedang
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px] px-1.5 py-0 h-4">
      Rendah
    </Badge>
  );
}

// ============================================================
// Main Component
// ============================================================

export function EconomicCalendarPanel() {
  const dates = useMemo(() => getNext7Days(), []);
  const todayStr = new Date().toISOString().slice(0, 10);

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [currency, setCurrency] = useState<CurrencyFilter>('ALL');
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (currency !== 'ALL') params.set('currency', currency);
      const res = await fetch(`/api/economic-calendar?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [selectedDate, currency]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 60000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-zinc-400" />
        <h2 className="text-lg font-semibold text-zinc-100">Kalender Ekonomi</h2>
      </div>

      {/* Date Chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {dates.map((date) => {
          const isToday = date === todayStr;
          const isSelected = date === selectedDate;
          return (
            <Button
              key={date}
              variant={isSelected ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedDate(date)}
              className={`shrink-0 text-xs h-8 px-3 ${
                isSelected
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                  : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {isToday ? 'Hari ini' : formatDateString(date)}
            </Button>
          );
        })}
      </div>

      {/* Currency Filter */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
        {CURRENCY_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={currency === opt.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setCurrency(opt.value)}
            className={`text-xs h-7 px-3 ${
              currency === opt.value
                ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Events Table */}
      <Card className="bg-zinc-900 border-zinc-800">
        {loading ? (
          <CardContent className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-4 w-12 bg-zinc-800" />
                <Skeleton className="h-4 w-10 bg-zinc-800" />
                <Skeleton className="h-4 w-3 bg-zinc-800" />
                <Skeleton className="h-4 w-48 bg-zinc-800" />
                <Skeleton className="h-4 w-16 bg-zinc-800" />
                <Skeleton className="h-4 w-16 bg-zinc-800" />
                <Skeleton className="h-4 w-16 bg-zinc-800" />
              </div>
            ))}
          </CardContent>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Globe className="w-12 h-12 mb-3" />
            <p className="text-sm">Tidak ada acara ekonomi</p>
            <p className="text-xs text-zinc-600 mt-1">Pilih tanggal lain untuk melihat jadwal</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Waktu</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Mata Uang</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Dampak</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9">Acara</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9 text-right">Prakiraan</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9 text-right">Sebelumnya</TableHead>
                  <TableHead className="text-xs text-zinc-500 font-medium h-9 text-right">Aktual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow
                    key={event.id}
                    className={`border-zinc-800/50 hover:bg-zinc-800/30 ${
                      event.impact === 'high' ? 'border-l-2 border-l-rose-500' : ''
                    }`}
                  >
                    <TableCell className="text-xs text-zinc-300 py-2.5 font-mono">
                      {event.time}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-zinc-700 text-zinc-300 font-medium">
                        {event.currency}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        {getImpactDot(event.impact)}
                        <ImpactBadge impact={event.impact} />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-100 py-2.5 max-w-[200px] lg:max-w-none">
                      <span className="line-clamp-1">{event.title}</span>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 py-2.5 text-right font-mono">
                      {event.forecast ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 py-2.5 text-right font-mono">
                      {event.previous ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs py-2.5 text-right font-mono font-medium">
                      {event.actual ? (
                        <span className={event.impact === 'high' ? 'text-zinc-100' : 'text-zinc-300'}>
                          {event.actual}
                        </span>
                      ) : (
                        <span className="text-zinc-600">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
