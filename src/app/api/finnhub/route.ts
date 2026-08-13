import { NextRequest, NextResponse } from 'next/server';
import type { ForexPair, QuoteData, CandleData } from '@/lib/trading-types';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

const PAIR_TO_SYMBOL: Record<ForexPair, string> = {
  EURUSD: 'OANDA:EUR_USD',
  USDJPY: 'OANDA:USD_JPY',
  GBPUSD: 'OANDA:GBP_USD',
  XAUUSD: 'OANDA:XAU_USD',
};

interface FinnhubQuote {
  c: number; h: number; l: number; o: number; pc: number; t: number;
}

interface FinnhubCandle {
  t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; s: string;
}

// Simulated base prices for when API is not available
const SIMULATED_BASES: Record<ForexPair, { price: number; pipSize: number; volatility: number }> = {
  EURUSD: { price: 1.0872, pipSize: 0.0001, volatility: 0.0003 },
  USDJPY: { price: 154.32, pipSize: 0.01, volatility: 0.15 },
  GBPUSD: { price: 1.2715, pipSize: 0.0001, volatility: 0.0004 },
  XAUUSD: { price: 2658.50, pipSize: 0.01, volatility: 3.5 },
};

// Store simulated state for continuity between refreshes
let simState: Record<ForexPair, { price: number; prevClose: number; high: number; low: number }> | null = null;

function getSimulatedState() {
  if (simState) return simState;
  simState = {
    EURUSD: { price: 1.0872, prevClose: 1.0865, high: 1.0890, low: 1.0850 },
    USDJPY: { price: 154.32, prevClose: 154.18, high: 154.55, low: 154.00 },
    GBPUSD: { price: 1.2715, prevClose: 1.2702, high: 1.2740, low: 1.2690 },
    XAUUSD: { price: 2658.50, prevClose: 2652.30, high: 2665.00, low: 2645.00 },
  };
  return simState;
}

function generateSimulatedQuotes(): Record<ForexPair, QuoteData> {
  const state = getSimulatedState();
  const quotes = {} as Record<ForexPair, QuoteData>;
  
  for (const pair of ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'] as ForexPair[]) {
    const base = SIMULATED_BASES[pair];
    const s = state[pair];
    // Random walk with mean reversion
    const change = (Math.random() - 0.5) * 2 * base.volatility;
    const meanRevert = (base.price - s.price) * 0.05;
    s.price = Math.max(s.price + change + meanRevert, s.low);
    s.high = Math.max(s.high, s.price);
    s.low = Math.min(s.low, s.price);

    const spread = 0.5 * base.pipSize;
    quotes[pair] = {
      pair,
      bid: parseFloat(s.price.toFixed(5)),
      ask: parseFloat((s.price + spread).toFixed(5)),
      mid: parseFloat((s.price + spread / 2).toFixed(5)),
      spread: 0.5,
      change: parseFloat((s.price - s.prevClose).toFixed(5)),
      changePercent: parseFloat((((s.price - s.prevClose) / s.prevClose) * 100).toFixed(4)),
      high: s.high,
      low: s.low,
      timestamp: Date.now(),
    };
  }
  return quotes;
}

function generateSimulatedCandles(pair: ForexPair, count: number): CandleData[] {
  const base = SIMULATED_BASES[pair];
  const candles: CandleData[] = [];
  let price = base.price * (1 - base.volatility * 2);
  const now = Math.floor(Date.now() / 1000);
  const interval = 300; // 5 min

  for (let i = 0; i < count; i++) {
    const open = price;
    const change1 = (Math.random() - 0.5) * base.volatility;
    const change2 = (Math.random() - 0.5) * base.volatility;
    const change3 = (Math.random() - 0.5) * base.volatility * 0.5;
    const close = open + change1 + change2 + change3;
    const high = Math.max(open, close) + Math.random() * base.volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * base.volatility * 0.5;
    const volume = Math.floor(Math.random() * 5000) + 500;

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

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}

function normalizeQuote(pair: ForexPair, raw: FinnhubQuote): QuoteData {
  const bid = raw.c;
  const pipSize = pair === 'USDJPY' || pair === 'XAUUSD' ? 0.01 : 0.0001;
  const spread = 0.5 * pipSize;
  return {
    pair,
    bid,
    ask: bid + spread,
    mid: bid + spread / 2,
    spread: parseFloat((spread / pipSize).toFixed(1)),
    change: parseFloat((raw.c - raw.pc).toFixed(5)),
    changePercent: parseFloat((((raw.c - raw.pc) / raw.pc) * 100).toFixed(4)),
    high: raw.h,
    low: raw.l,
    timestamp: raw.t * 1000,
  };
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
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    // Candle data request
    if (type === 'candles') {
      const symbolParam = searchParams.get('symbol') as ForexPair | null;
      const resolution = searchParams.get('resolution') || 'M5';
      // H-6: Validate resolution parameter
      const VALID_RESOLUTIONS = ['1', '5', 'M1', 'M2', 'M5', 'M15', 'M30', '60', 'H1', 'H4', 'D1', 'W1'];
      if (!VALID_RESOLUTIONS.includes(resolution)) {
        return NextResponse.json({ error: `Invalid resolution. Must be one of: ${VALID_RESOLUTIONS.join(', ')}` }, { status: 400 });
      }
      const count = Math.min(Math.max(1, parseInt(searchParams.get('count') || '100', 10)), 5000);

      if (!symbolParam || !PAIR_TO_SYMBOL[symbolParam]) {
        return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
      }

      // Return simulated candles if no API key
      if (!apiKey) {
        const candles = generateSimulatedCandles(symbolParam, count);
        return NextResponse.json({ pair: symbolParam, resolution, count: candles.length, candles, simulated: true });
      }

      const finnhubSymbol = PAIR_TO_SYMBOL[symbolParam];
      const now = Math.floor(Date.now() / 1000);
      const from = now - count * getResolutionSeconds(resolution);
      const url = `${FINNHUB_BASE}/stock/candle?symbol=${finnhubSymbol}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`;

      try {
        const res = await fetchWithRetry(url);
        if (!res.ok) {
          // Fallback to simulated data
          const candles = generateSimulatedCandles(symbolParam, count);
          return NextResponse.json({ pair: symbolParam, resolution, count: candles.length, candles, simulated: true, fallback: true });
        }
        const data: FinnhubCandle = await res.json();
        const candles = normalizeCandles(data);
        if (candles.length === 0) {
          const simCandles = generateSimulatedCandles(symbolParam, count);
          return NextResponse.json({ pair: symbolParam, resolution, count: simCandles.length, candles: simCandles, simulated: true, fallback: true });
        }
        return NextResponse.json({ pair: symbolParam, resolution, count: candles.length, candles });
      } catch {
        const candles = generateSimulatedCandles(symbolParam, count);
        return NextResponse.json({ pair: symbolParam, resolution, count: candles.length, candles, simulated: true, fallback: true });
      }
    }

    // Default: fetch all forex quotes
    if (!apiKey) {
      const quotes = generateSimulatedQuotes();
      return NextResponse.json({ timestamp: Date.now(), quotes, simulated: true });
    }

    const pairs: ForexPair[] = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
    const quotes: Record<ForexPair, QuoteData> = {} as Record<ForexPair, QuoteData>;
    const errors: string[] = [];

    for (const pair of pairs) {
      try {
        const symbol = PAIR_TO_SYMBOL[pair];
        const url = `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`;
        const res = await fetchWithRetry(url);
        if (!res.ok) {
          errors.push(`${pair}: HTTP ${res.status}`);
          continue;
        }
        const data: FinnhubQuote = await res.json();
        if (data.c === 0 && data.h === 0 && data.l === 0) {
          errors.push(`${pair}: No data`);
          continue;
        }
        quotes[pair] = normalizeQuote(pair, data);
      } catch (err) {
        errors.push(`${pair}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
      if (pair !== pairs[pairs.length - 1]) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    // Fill in missing pairs with simulated data
    for (const pair of pairs) {
      if (!quotes[pair]) {
        const simQuotes = generateSimulatedQuotes();
        quotes[pair] = simQuotes[pair];
      }
    }

    return NextResponse.json({
      timestamp: Date.now(),
      quotes,
      simulated: Object.keys(quotes).length < pairs.length,
    });
  } catch (error) {
    console.error('[Finnhub API] Error:', error);
    // Ultimate fallback
    const quotes = generateSimulatedQuotes();
    return NextResponse.json({ timestamp: Date.now(), quotes, simulated: true, error: 'fallback' });
  }
}

function getResolutionSeconds(resolution: string): number {
  const map: Record<string, number> = {
    '1': 60, '5': 300, M1: 60, M2: 120, M5: 300, M15: 900,
    M30: 1800, '60': 3600, H1: 3600, H4: 14400, D1: 86400, W1: 604800,
  };
  return map[resolution] || 300;
}