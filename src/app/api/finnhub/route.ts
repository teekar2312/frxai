import { NextRequest, NextResponse } from 'next/server';
import type { ForexPair, QuoteData, CandleData } from '@/lib/trading-types';
import {
  PAIR_TO_FINNHUB_SYMBOL, FOREX_PAIRS, PAIR_PIP_VALUES, FINEX_CONFIG,
  SIMULATED_BASES, RESOLUTION_TO_SECONDS, VALID_FINNHUB_RESOLUTIONS,
  toFinnhubResolution,
} from '@/lib/trading-types';
import { refreshAllQuotes, getCachedQuote, isAnySimulated, getCacheAge } from '@/lib/price-cache';
import { logApiError } from '@/lib/safe-log';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

interface FinnhubCandle {
  t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; s: string;
}

// FNH-015: AbortController timeout for candle fetches
async function fetchWithTimeout(url: string, timeoutMs = 8000, retries = 2): Promise<Response> {
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

// FNH-011: Simulated candles with time-weighted volume
function generateSimulatedCandles(pair: ForexPair, count: number): CandleData[] {
  const base = SIMULATED_BASES[pair];
  const candles: CandleData[] = [];
  let price = base.price * (1 - base.volatility * 2);
  const now = Math.floor(Date.now() / 1000);
  const interval = 300;

  for (let i = 0; i < count; i++) {
    const open = price;
    const change1 = (Math.random() - 0.5) * base.volatility;
    const change2 = (Math.random() - 0.5) * base.volatility;
    const change3 = (Math.random() - 0.5) * base.volatility * 0.5;
    const close = open + change1 + change2 + change3;
    const high = Math.max(open, close) + Math.random() * base.volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * base.volatility * 0.5;
    // FNH-018: Time-weighted volume (higher during London/NY sessions)
    const hour = new Date((now - (count - i) * interval) * 1000).getUTCHours();
    const sessionMultiplier = (hour >= 7 && hour <= 17) ? 1.5 : 0.6;
    const volume = Math.floor((Math.random() * 3000 + 500) * sessionMultiplier);

    candles.push({
      time: (now - (count - i) * interval) * 1000,
      open: parseFloat(open.toFixed(5)),
      high: parseFloat(high.toFixed(5)),
      low: parseFloat(low.toFixed(5)),
      close: parseFloat(close.toFixed(5)),
      volume,
    });
    price = close;
  }
  return candles;
}

function normalizeCandles(raw: FinnhubCandle): CandleData[] {
  if (raw.s !== 'ok' || !raw.t) return [];
  return raw.t.map((time, i) => ({
    time: time * 1000,
    open: raw.o[i],
    high: raw.h[i],
    low: raw.l[i],
    close: raw.c[i],
    volume: raw.v[i] || 0,
  }));
}

export async function GET(request: NextRequest) {
  // FNH-001: Rate limiting — max 12 req/min (4 pairs × 3 polls, leaves room for alerts)
  const rateCheck = checkRateLimit(clientIp(request), 'finnhub');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    // Candle data request
    if (type === 'candles') {
      const symbolParam = searchParams.get('symbol') as ForexPair | null;
      const resolutionParam = searchParams.get('resolution') || 'M5';

      // FNH-014: Validate resolution
      if (!VALID_FINNHUB_RESOLUTIONS.includes(resolutionParam)) {
        return NextResponse.json({ error: `Invalid resolution. Must be one of: ${VALID_FINNHUB_RESOLUTIONS.join(', ')}` }, { status: 400 });
      }
      const count = Math.min(Math.max(1, parseInt(searchParams.get('count') || '100', 10)), 5000);

      if (!symbolParam || !PAIR_TO_FINNHUB_SYMBOL[symbolParam]) {
        return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
      }

      // Return simulated candles if no API key (FNH-007: consistent fallback)
      if (!apiKey) {
        const candles = generateSimulatedCandles(symbolParam, count);
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true });
      }

      // FNH-014: Convert alias to Finnhub numeric format
      const finnhubResolution = toFinnhubResolution(resolutionParam);
      const finnhubSymbol = PAIR_TO_FINNHUB_SYMBOL[symbolParam];
      const now = Math.floor(Date.now() / 1000);
      const from = now - count * (RESOLUTION_TO_SECONDS[resolutionParam] || 300);
      const url = `${FINNHUB_BASE}/stock/candle?symbol=${finnhubSymbol}&resolution=${finnhubResolution}&from=${from}&to=${now}&token=${apiKey}`;

      try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          const candles = generateSimulatedCandles(symbolParam, count);
          return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true, fallback: true });
        }
        const data: FinnhubCandle = await res.json();
        const candles = normalizeCandles(data);
        if (candles.length === 0) {
          const simCandles = generateSimulatedCandles(symbolParam, count);
          return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: simCandles.length, candles: simCandles, simulated: true, fallback: true });
        }
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles });
      } catch {
        const candles = generateSimulatedCandles(symbolParam, count);
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true, fallback: true });
      }
    }

    // Default: fetch all forex quotes via centralized cache (C-001)
    const { quotes, simulated } = await refreshAllQuotes();

    return NextResponse.json({
      timestamp: Date.now(),
      quotes,
      simulated,
      cacheAgeMs: getCacheAge(),
      anySimulated: isAnySimulated(),
    });
  } catch (error) {
    logApiError('Finnhub', error);
    // Force simulated fallback
    const { quotes, simulated } = await refreshAllQuotes();
    return NextResponse.json({ timestamp: Date.now(), quotes, simulated: true, error: 'fallback' });
  }
}
