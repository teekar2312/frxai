/**
 * C-001: Centralized in-memory price cache.
 * All routes (finnhub, alerts, price-fetcher) read from here
 * to prevent 3-way price divergence.
 * TTL: 3 seconds (matching the ~5s frontend poll interval).
 */

import type { ForexPair, QuoteData } from './trading-types';
import { PAIR_TO_FINNHUB_SYMBOL, PAIR_PIP_VALUES, FINEX_CONFIG, FOREX_PAIRS, SIMULATED_BASES } from './trading-types';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const CACHE_TTL_MS = 3000; // 3 seconds

interface CacheEntry {
  quote: QuoteData;
  fetchedAt: number;
  simulated: boolean;
}

const cache = new Map<ForexPair, CacheEntry>();
let lastFetchAllAt = 0;
let isFetchingAll = false;

// FNH-015: AbortController timeout
function fetchWithTimeout(url: string, timeoutMs = 5000, retries = 2): Promise<Response> {
  return new Promise((resolve, reject) => {
    const attempt = (tryNum: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      fetch(url, { signal: controller.signal })
        .then((res) => {
          clearTimeout(timer);
          if (res.status === 429 && tryNum < retries) {
            setTimeout(() => attempt(tryNum + 1), 1000 * (tryNum + 1));
            return;
          }
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          if (tryNum < retries) {
            setTimeout(() => attempt(tryNum + 1), 500 * (tryNum + 1));
            return;
          }
          reject(err);
        });
    };
    attempt(0);
  });
}

// FNH-011: Simulated state with daily reset
let simState: Record<ForexPair, { price: number; prevClose: number; high: number; low: number; date: string }> | null = null;
let lastSimResetDate = '';

function getSimState() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastSimResetDate !== today || !simState) {
    lastSimResetDate = today;
    simState = {} as Record<ForexPair, { price: number; prevClose: number; high: number; low: number; date: string }>;
    for (const [pair, base] of Object.entries(SIMULATED_BASES)) {
      const p = pair as ForexPair;
      simState[p] = {
        price: base.price,
        prevClose: base.price * (1 + (Math.random() - 0.5) * 0.002),
        high: base.price,
        low: base.price,
        date: today,
      };
    }
  }
  return simState!;
}

function generateSimulatedQuote(pair: ForexPair): QuoteData {
  const base = SIMULATED_BASES[pair];
  const state = getSimState();
  const s = state[pair];
  const change = (Math.random() - 0.5) * 2 * base.volatility;
  const meanRevert = (base.price - s.price) * 0.05;
  s.price = Math.max(s.price + change + meanRevert, s.low);
  s.high = Math.max(s.high, s.price);
  s.low = Math.min(s.low, s.price);

  // C-007: Use FINEX_CONFIG.spreadPip for consistency
  const spread = FINEX_CONFIG.spreadPip * base.pipSize;
  return {
    pair,
    bid: parseFloat(s.price.toFixed(5)),
    ask: parseFloat((s.price + spread).toFixed(5)),
    mid: parseFloat((s.price + spread / 2).toFixed(5)),
    spread: FINEX_CONFIG.spreadPip,
    change: parseFloat((s.price - s.prevClose).toFixed(5)),
    changePercent: parseFloat((((s.price - s.prevClose) / s.prevClose) * 100).toFixed(4)),
    high: s.high,
    low: s.low,
    timestamp: Date.now(),
  };
}

/**
 * Fetch all pair quotes from Finnhub (or simulate if no key).
 * Populates the cache. Call this from the finnhub route.
 */
export async function refreshAllQuotes(): Promise<{ quotes: Record<ForexPair, QuoteData>; simulated: boolean }> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    const quotes = {} as Record<ForexPair, QuoteData>;
    for (const pair of FOREX_PAIRS) {
      const q = generateSimulatedQuote(pair);
      cache.set(pair, { quote: q, fetchedAt: Date.now(), simulated: true });
      quotes[pair] = q;
    }
    return { quotes, simulated: true };
  }

  const quotes = {} as Record<ForexPair, QuoteData>;
  let anyReal = false;

  for (const pair of FOREX_PAIRS) {
    try {
      const symbol = PAIR_TO_FINNHUB_SYMBOL[pair];
      const url = `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.c || data.c === 0) continue;

      // FNH-006: data.c is the last/mid price, NOT bid
      const lastPrice = data.c;
      const pipSize = PAIR_PIP_VALUES[pair]?.pipSize ?? 0.0001;
      const spread = FINEX_CONFIG.spreadPip * pipSize; // C-007: use config spread

      const quote: QuoteData = {
        pair,
        bid: parseFloat((lastPrice - spread / 2).toFixed(5)),
        ask: parseFloat((lastPrice + spread / 2).toFixed(5)),
        mid: lastPrice,
        spread: FINEX_CONFIG.spreadPip,
        change: parseFloat((data.c - (data.pc || data.c)).toFixed(5)),
        changePercent: data.pc ? parseFloat((((data.c - data.pc) / data.pc) * 100).toFixed(4)) : 0,
        high: data.h || lastPrice,
        low: data.l || lastPrice,
        timestamp: (data.t || Math.floor(Date.now() / 1000)) * 1000,
      };
      cache.set(pair, { quote, fetchedAt: Date.now(), simulated: false });
      quotes[pair] = quote;
      anyReal = true;
    } catch {
      // fallback to simulated for this pair
    }
    // Rate-limit delay between pairs (FNH-001: stay under 60/min)
    if (pair !== FOREX_PAIRS[FOREX_PAIRS.length - 1]) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Fill missing pairs with simulated
  for (const pair of FOREX_PAIRS) {
    if (!quotes[pair]) {
      const q = generateSimulatedQuote(pair);
      cache.set(pair, { quote: q, fetchedAt: Date.now(), simulated: true });
      quotes[pair] = q;
    }
  }

  lastFetchAllAt = Date.now();
  return { quotes, simulated: !anyReal };
}

/**
 * Get a cached quote for a single pair.
 * Returns null if not in cache or expired.
 */
export function getCachedQuote(pair: ForexPair): { quote: QuoteData; simulated: boolean } | null {
  const entry = cache.get(pair);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return { quote: entry.quote, simulated: entry.simulated };
}

/**
 * Get the current mid price for a pair (for position calculations).
 * C-001: Uses centralized cache. Falls back to direct fetch then simulated.
 */
export async function getCurrentMidPrice(pair: string): Promise<{ mid: number; simulated: boolean } | null> {
  // Check cache first
  const cached = getCachedQuote(pair as ForexPair);
  if (cached) return { mid: cached.quote.mid, simulated: cached.simulated };

  // Try Finnhub directly
  const apiKey = process.env.FINNHUB_API_KEY;
  if (apiKey) {
    const symbol = PAIR_TO_FINNHUB_SYMBOL[pair as ForexPair] || `OANDA:${pair.slice(0, 3)}_${pair.slice(3)}`;
    try {
      const res = await fetchWithTimeout(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`);
      if (res.ok) {
        const data = await res.json();
        if (data.c && data.c > 0) {
          return { mid: data.c, simulated: false };
        }
      }
    } catch {
      // fall through
    }
  }

  // Simulated fallback
  const base = SIMULATED_BASES[pair as ForexPair];
  if (!base) return null;
  const state = getSimState();
  const s = state[pair as ForexPair];
  if (!s) return null;
  const change = (Math.random() - 0.5) * 2 * base.volatility;
  const meanRevert = (base.price - s.price) * 0.05;
  s.price = s.price + change + meanRevert;
  return { mid: s.price, simulated: true };
}

/** Check if any cached data is simulated */
export function isAnySimulated(): boolean {
 for (const pair of FOREX_PAIRS) {
    const entry = cache.get(pair);
    if (!entry || entry.simulated) return true;
  }
  return false;
}

/** Get cache age in ms */
export function getCacheAge(): number {
 return Date.now() - lastFetchAllAt;
}
