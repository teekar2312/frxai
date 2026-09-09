import "server-only";
import type { Pair, Quote } from "./types";
import { PAIRS } from "./constants";

// In-memory cache of real MT5 ticks published by the Python bridge.
// The bridge POSTs to /api/market/ticks every second; /api/market reads from
// here first and falls back to the simulator (lib/market.ts) when no recent
// real tick is available.

interface CachedTick {
  quote: Quote;
  receivedAt: number;
}

const cache: Partial<Record<Pair, CachedTick>> = {};
const STALE_MS = 15_000; // treat real tick as stale after 15s without update

export function publishTicks(quotes: Quote[]): number {
  let count = 0;
  for (const q of quotes) {
    if (!PAIRS.some((p) => p.symbol === q.symbol)) continue;
    cache[q.symbol as Pair] = { quote: q, receivedAt: Date.now() };
    count++;
  }
  return count;
}

export function getRealQuote(symbol: Pair): Quote | null {
  const entry = cache[symbol];
  if (!entry) return null;
  if (Date.now() - entry.receivedAt > STALE_MS) return null; // stale
  return entry.quote;
}

export function getAllRealQuotes(): Quote[] {
  const out: Quote[] = [];
  for (const p of PAIRS) {
    const q = getRealQuote(p.symbol);
    if (q) out.push(q);
  }
  return out;
}

export function hasRealTicks(): boolean {
  return Object.keys(cache).length > 0 && getAllRealQuotes().length > 0;
}

export function lastTickAt(): number | null {
  let latest: number | null = null;
  for (const k in cache) {
    const t = cache[k as Pair]?.receivedAt ?? 0;
    if (t > (latest ?? 0)) latest = t;
  }
  return latest;
}
