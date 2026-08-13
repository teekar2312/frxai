/**
 * H-7: Shared price fetching utility.
 * Eliminates self-referencing HTTP calls from positions route.
 * Directly computes simulated prices or fetches from Finnhub API.
 */

export interface PriceQuote {
  mid: number;
  bid: number;
  ask: number;
}

const SIMULATED_BASES: Record<string, { price: number; pipSize: number; volatility: number }> = {
  EURUSD: { price: 1.0872, pipSize: 0.0001, volatility: 0.0003 },
  USDJPY: { price: 154.32, pipSize: 0.01, volatility: 0.15 },
  GBPUSD: { price: 1.2715, pipSize: 0.0001, volatility: 0.0004 },
  XAUUSD: { price: 2658.50, pipSize: 0.01, volatility: 3.5 },
};

// In-memory simulated state for continuity
let simState: Record<string, { price: number }> | null = null;

function getSimState() {
  if (simState) return simState;
  simState = {};
  for (const [pair, base] of Object.entries(SIMULATED_BASES)) {
    simState[pair] = { price: base.price };
  }
  return simState;
}

async function fetchFinnhubPrice(pair: string): Promise<PriceQuote | null> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return null;

  const PAIR_TO_SYMBOL: Record<string, string> = {
    EURUSD: 'OANDA:EUR_USD',
    USDJPY: 'OANDA:USD_JPY',
    GBPUSD: 'OANDA:GBP_USD',
    XAUUSD: 'OANDA:XAU_USD',
  };

  const symbol = PAIR_TO_SYMBOL[pair] || `OANDA:${pair.slice(0, 3)}_${pair.slice(3)}`;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.c || data.c === 0) return null;
    const bid = data.c;
    const pipSize = pair === 'USDJPY' || pair === 'XAUUSD' ? 0.01 : 0.0001;
    const spread = 0.5 * pipSize;
    return { mid: bid + spread / 2, bid, ask: bid + spread };
  } catch {
    return null;
  }
}

/**
 * Get the current mid price for a forex pair.
 * Tries Finnhub API first, falls back to simulated price.
 */
export async function getCurrentMidPrice(pair: string): Promise<number | null> {
  // Try real API first
  const real = await fetchFinnhubPrice(pair);
  if (real) return real.mid;

  // Simulated fallback
  const base = SIMULATED_BASES[pair];
  if (!base) return null;

  const state = getSimState();
  const s = state[pair];
  if (!s) return null;

  // Random walk with mean reversion
  const change = (Math.random() - 0.5) * 2 * base.volatility;
  const meanRevert = (base.price - s.price) * 0.05;
  s.price = s.price + change + meanRevert;

  return s.price;
}
