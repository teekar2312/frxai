import { NextRequest, NextResponse } from 'next/server';
import type { ForexPair, CandleData } from '@/lib/trading-types';
import {
  PAIR_TO_FINNHUB_SYMBOL, RESOLUTION_TO_SECONDS, VALID_FINNHUB_RESOLUTIONS,
  toFinnhubResolution,
} from '@/lib/trading-types';
import { refreshAllQuotes, isAnySimulated, getCacheAge } from '@/lib/price-cache';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { generateSimulatedCandles } from '@/lib/sim-candles';
import { logApiError } from '@/lib/safe-log';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { checkAllAlerts } from '@/lib/alert-checker';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

interface FinnhubCandle {
  t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; s: string;
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

      const intervalSeconds = RESOLUTION_TO_SECONDS[resolutionParam] || 300;

      // Return simulated candles if no API key (FNH-007: consistent fallback)
      if (!apiKey) {
        const candles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
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
          const candles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
          return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true, fallback: true });
        }
        const data: FinnhubCandle = await res.json();
        const candles = normalizeCandles(data);
        if (candles.length === 0) {
          const simCandles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
          return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: simCandles.length, candles: simCandles, simulated: true, fallback: true });
        }
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles });
      } catch {
        const candles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true, fallback: true });
      }
    }

    // Default: fetch all forex quotes via centralized cache (C-001)
    const { quotes, simulated } = await refreshAllQuotes();

    // CRITICAL FIX: Check all price alerts on every price tick (not just when alerts tab is open)
    const triggeredAlerts = await checkAllAlerts();

    // RB-003: Add Cache-Control header (quotes don't change faster than ~1s)
    return new NextResponse(
      JSON.stringify({
        timestamp: Date.now(),
        quotes,
        simulated,
        cacheAgeMs: getCacheAge(),
        anySimulated: isAnySimulated(),
        triggeredAlerts: triggeredAlerts.length > 0 ? triggeredAlerts : undefined,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=2, s-maxage=2',
        },
      },
    );
  } catch (error) {
    logApiError('Finnhub', error);
    // API-AUDIT-008: Wrap refreshAllQuotes fallback in its own try-catch
    let fallbackQuotes: Record<string, unknown> = {};
    let fallbackSimulated = true;
    try {
      const fallback = await refreshAllQuotes();
      fallbackQuotes = fallback.quotes;
      fallbackSimulated = fallback.simulated;
    } catch {
      // If even the fallback fails, return minimal error response
    }
    return NextResponse.json({ timestamp: Date.now(), quotes: fallbackQuotes, simulated: fallbackSimulated, error: 'fallback' });
  }
}
