'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, X, ChevronUp, ChevronDown, RefreshCw, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { EXTENDED_PAIRS, EXTENDED_PAIR_DISPLAY, EXTENDED_PAIR_PIP_VALUES } from '@/lib/trading-types';

// ============================================================
// Types
// ============================================================

interface WatchlistEntry {
  id: string;
  pair: string;
  sortOrder: number;
  createdAt: string;
}

interface WatchlistQuote {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  timestamp: number;
}

// ============================================================
// Helper: format price based on pair pip size
// ============================================================

function fmtPrice(pair: string, price: number): string {
  const pipInfo = EXTENDED_PAIR_PIP_VALUES[pair];
  if (!pipInfo) return price.toFixed(5);
  const decimals = pipInfo.pipSize < 0.001 ? 5 : 3;
  return price.toFixed(decimals);
}

// ============================================================
// Default pairs when watchlist is empty
// ============================================================

const DEFAULT_PAIRS = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];

// ============================================================
// Component: WatchlistPanel
// ============================================================

export function WatchlistPanel() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [quotes, setQuotes] = useState<Record<string, WatchlistQuote>>({});
  const [isLoadingEntries, setIsLoadingEntries] = useState(true);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [availablePairs, setAvailablePairs] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Fetch watchlist entries ----
  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/watchlist');
      if (res.ok) {
        const data = await res.json();
        const list: WatchlistEntry[] = data.entries ?? data.watchlist ?? [];
        setEntries(list);
        return list;
      }
    } catch {
      // silent fallback to defaults
    }
    return [];
  }, []);

  // ---- Fetch quotes for given pairs ----
  const fetchQuotes = useCallback(async (pairs: string[]) => {
    if (!pairs.length) return;
    setIsLoadingQuotes(true);
    try {
      const pairParam = pairs.join(',');
      const res = await fetch(`/api/finnhub?type=quotes&pairs=${pairParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data.quotes && typeof data.quotes === 'object') {
          setQuotes(data.quotes as Record<string, WatchlistQuote>);
        }
      }
    } catch {
      // ignore
    }
    setIsLoadingQuotes(false);
  }, []);

  // ---- Initial load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingEntries(true);
      const list = await fetchEntries();
      if (cancelled) return;
      const pairs = list.length > 0 ? list.map(e => e.pair) : DEFAULT_PAIRS;
      await fetchQuotes(pairs);
      setIsLoadingEntries(false);
    })();
    return () => { cancelled = true; };
  }, [fetchEntries, fetchQuotes]);

  // ---- Poll quotes every 5s ----
  useEffect(() => {
    const pairs = entries.length > 0 ? entries.map(e => e.pair) : DEFAULT_PAIRS;
    if (!pairs.length) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchQuotes(pairs), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [entries, fetchQuotes]);

  // ---- Pause when tab hidden ----
  useEffect(() => {
    const handler = () => {
      if (document.hidden && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      } else if (!document.hidden) {
        const pairs = entries.length > 0 ? entries.map(e => e.pair) : DEFAULT_PAIRS;
        if (pairs.length) {
          pollRef.current = setInterval(() => fetchQuotes(pairs), 5000);
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [entries, fetchQuotes]);

  // ---- Add pair ----
  const handleAdd = async (pair: string) => {
    setIsAdding(true);
    try {
      const sortOrder = entries.length;
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair, sortOrder }),
      });
      if (res.ok) {
        toast.success(`${EXTENDED_PAIR_DISPLAY[pair] || pair} ditambahkan ke watchlist`);
        setIsAddOpen(false);
        const updated = await fetchEntries();
        fetchQuotes([...(updated.length > 0 ? updated.map(e => e.pair) : DEFAULT_PAIRS)]);
      } else {
        toast.error('Gagal menambahkan pair ke watchlist');
      }
    } catch {
      toast.error('Gagal menambahkan pair ke watchlist');
    }
    setIsAdding(false);
  };

  // ---- Remove pair ----
  const handleRemove = async (pair: string) => {
    setIsRemoving(pair);
    try {
      const res = await fetch(`/api/watchlist?pair=${pair}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`${EXTENDED_PAIR_DISPLAY[pair] || pair} dihapus dari watchlist`);
        await fetchEntries();
      } else {
        toast.error('Gagal menghapus pair dari watchlist');
      }
    } catch {
      toast.error('Gagal menghapus pair dari watchlist');
    }
    setIsRemoving(null);
  };

  // ---- Reorder (up / down) ----
  const handleMove = async (pair: string, direction: 'up' | 'down') => {
    const idx = entries.findIndex(e => e.pair === pair);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= entries.length) return;

    setIsReordering(pair);
    try {
      const reordered = [...entries];
      [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
      const updates = reordered.map((e, i) => ({ pair: e.pair, sortOrder: i }));
      const res = await fetch('/api/watchlist/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updates }),
      });
      if (res.ok) {
        await fetchEntries();
      }
    } catch {
      toast.error('Gagal mengubah urutan');
    }
    setIsReordering(null);
  };

  // ---- Open add dialog ----
  const handleOpenAddDialog = () => {
    const existing = new Set(entries.map(e => e.pair));
    setAvailablePairs(EXTENDED_PAIRS.filter(p => !existing.has(p)));
    setIsAddOpen(true);
  };

  // ---- Active display list ----
  const hasCustomEntries = entries.length > 0;
  const displayList = hasCustomEntries
    ? [...entries].sort((a, b) => a.sortOrder - b.sortOrder)
    : DEFAULT_PAIRS.map((p, i) => ({ id: `default-${i}`, pair: p, sortOrder: i, createdAt: '' }));

  const activePairs = hasCustomEntries
    ? entries.map(e => e.pair)
    : DEFAULT_PAIRS;

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-zinc-100">
            Watchlist
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              onClick={() => fetchQuotes(activePairs)}
              disabled={isLoadingQuotes}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingQuotes ? 'animate-spin' : ''}`} />
            </Button>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                  onClick={handleOpenAddDialog}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-800 sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-zinc-100">Tambah Pair</DialogTitle>
                </DialogHeader>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {availablePairs.length === 0 ? (
                    <p className="text-sm text-zinc-500 text-center py-6">
                      Semua pair sudah ada di watchlist
                    </p>
                  ) : (
                    availablePairs.map(pair => (
                      <button
                        key={pair}
                        onClick={() => handleAdd(pair)}
                        disabled={isAdding}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-zinc-800 transition-colors text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
                      >
                        <span className="text-sm font-medium">
                          {EXTENDED_PAIR_DISPLAY[pair] || pair}
                        </span>
                        <span className="text-xs text-zinc-600 font-mono">{pair}</span>
                      </button>
                    ))
                  )}
                </div>
                {isAdding && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                    <span className="ml-2 text-sm text-zinc-400">Menambahkan...</span>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Desktop column headers */}
        <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_56px_56px_56px] gap-1 px-3 pb-2 text-[10px] text-zinc-500 uppercase tracking-wider">
          <span>Pair</span>
          <span className="text-right">Bid</span>
          <span className="text-right">Ask</span>
          <span className="text-right">Spread</span>
          <span className="text-right">Ubah %</span>
          <span className="text-right">Aksi</span>
        </div>

        <ScrollArea className="max-h-96 overflow-y-auto">
          {isLoadingEntries ? (
            <div className="space-y-2 px-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full bg-zinc-800" />
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {displayList.map((entry, idx) => {
                const q = quotes[entry.pair];
                const changeColor = q
                  ? q.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                  : 'text-zinc-500';
                const isFirst = idx === 0;
                const isLast = idx === displayList.length - 1;

                return (
                  <div
                    key={entry.id || entry.pair}
                    className="group rounded-md hover:bg-zinc-800/60 transition-colors"
                  >
                    {/* Mobile layout */}
                    <div className="sm:hidden px-3 py-2 flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-zinc-100">
                          {EXTENDED_PAIR_DISPLAY[entry.pair] || entry.pair}
                        </span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-zinc-400">
                            B: {q ? fmtPrice(entry.pair, q.bid) : '—'}
                          </span>
                          <span className="text-zinc-400">
                            A: {q ? fmtPrice(entry.pair, q.ask) : '—'}
                          </span>
                          <span className={changeColor}>
                            {q ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '—'}
                          </span>
                        </div>
                      </div>
                      {hasCustomEntries && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-500 hover:text-red-400 hover:bg-zinc-700"
                          onClick={() => handleRemove(entry.pair)}
                          disabled={isRemoving === entry.pair}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_56px_56px_56px] gap-1 items-center px-3 py-1.5">
                      <span className="text-sm font-medium text-zinc-100 truncate">
                        {EXTENDED_PAIR_DISPLAY[entry.pair] || entry.pair}
                      </span>
                      <span className="text-sm text-right font-mono text-zinc-300">
                        {q ? fmtPrice(entry.pair, q.bid) : <Skeleton className="h-4 w-16 ml-auto bg-zinc-800" />}
                      </span>
                      <span className="text-sm text-right font-mono text-zinc-300">
                        {q ? fmtPrice(entry.pair, q.ask) : <Skeleton className="h-4 w-16 ml-auto bg-zinc-800" />}
                      </span>
                      <span className="text-xs text-right font-mono text-zinc-400">
                        {q ? q.spread.toFixed(1) : '—'}
                      </span>
                      <span className={`text-xs text-right font-mono ${changeColor}`}>
                        {q ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '—'}
                      </span>
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {hasCustomEntries && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-6 w-6 ${isFirst ? 'invisible' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'}`}
                              onClick={() => handleMove(entry.pair, 'up')}
                              disabled={isReordering === entry.pair}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-6 w-6 ${isLast ? 'invisible' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'}`}
                              onClick={() => handleMove(entry.pair, 'down')}
                              disabled={isReordering === entry.pair}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-zinc-500 hover:text-red-400 hover:bg-zinc-700"
                              onClick={() => handleRemove(entry.pair)}
                              disabled={isRemoving === entry.pair}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {hasCustomEntries && (
          <div className="mt-2 pt-2 border-t border-zinc-800/60">
            <p className="text-[10px] text-zinc-600 text-center">
              {entries.length} pair dalam watchlist
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
