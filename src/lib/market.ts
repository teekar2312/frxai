import { PAIRS } from "./constants";
import type { Candle, Pair, Quote } from "./types";

// In-sandbox market data simulator.
// In production the dashboard pulls live ticks from the MT5 bridge
// (running on the user's Windows machine) via the configured gateway.

const state: Record<Pair, { price: number; high: number; low: number; prevClose: number }> = {} as any;

for (const p of PAIRS) {
  state[p.symbol] = {
    price: p.basePrice,
    high: p.basePrice,
    low: p.basePrice,
    prevClose: p.basePrice,
  };
}

function vol(symbol: Pair): number {
  // volatility per tick relative to price
  switch (symbol) {
    case "XAUUSD":
      return 0.0008;
    case "USDJPY":
      return 0.00025;
    default:
      return 0.00018;
  }
}

function spreadPips(symbol: Pair): number {
  switch (symbol) {
    case "XAUUSD":
      return 2.5;
    case "USDJPY":
      return 1.2;
    case "GBPUSD":
      return 1.1;
    default:
      return 0.6;
  }
}

export function getQuote(symbol: Pair): Quote {
  const meta = PAIRS.find((p) => p.symbol === symbol)!;
  const s = state[symbol];
  // random walk
  const drift = (Math.random() - 0.5) * 2 * vol(symbol) * s.price;
  const next = Math.max(s.price + drift, meta.pipSize);
  s.price = next;
  s.high = Math.max(s.high, next);
  s.low = Math.min(s.low, next);
  const sp = spreadPips(symbol);
  const spreadAbs = sp * meta.pipSize;
  const changePct = ((next - s.prevClose) / s.prevClose) * 100;
  return {
    symbol,
    bid: next - spreadAbs / 2,
    ask: next + spreadAbs / 2,
    spreadPips: sp,
    changePct,
    last: next,
    high: s.high,
    low: s.low,
    ts: Date.now(),
  };
}

export function getAllQuotes(): Quote[] {
  return PAIRS.map((p) => getQuote(p.symbol));
}

export function generateCandles(symbol: Pair, count: number, tfMinutes: number): Candle[] {
  const meta = PAIRS.find((p) => p.symbol === symbol)!;
  const candles: Candle[] = [];
  let price = meta.basePrice * (0.99 + Math.random() * 0.02);
  const now = Date.now();
  const step = tfMinutes * 60 * 1000;
  for (let i = count - 1; i >= 0; i--) {
    const time = now - i * step;
    const open = price;
    const swings = 6;
    let high = open;
    let low = open;
    for (let j = 0; j < swings; j++) {
      const move = (Math.random() - 0.5) * 2 * vol(symbol) * price * 2.5;
      high = Math.max(high, open + move);
      low = Math.min(low, open + move);
    }
    const close = low + Math.random() * (high - low);
    const volume = Math.floor(500 + Math.random() * 5000);
    candles.push({ time, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

export function equityCurve(points: number, start: number): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  let v = start;
  const now = Date.now();
  for (let i = points - 1; i >= 0; i--) {
    const change = (Math.random() - 0.45) * (start * 0.004);
    v = Math.max(start * 0.6, v + change);
    out.push({ t: now - i * 3600 * 1000, v });
  }
  return out;
}

// Helper to detect active sessions by UTC hour
export function activeSessions(date = new Date()): { label: string; active: boolean }[] {
  const h = date.getUTCHours();
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  const weekend = day === 0 || day === 6;
  const inRange = (a: number, b: number) => (a < b ? h >= a && h < b : h >= a || h < b);
  return [
    { label: "Sydney", active: !weekend && inRange(21, 6) },
    { label: "Tokyo", active: !weekend && inRange(0, 9) },
    { label: "London", active: !weekend && inRange(7, 16) },
    { label: "New York", active: !weekend && inRange(12, 21) },
    {
      label: "London + NY Overlap",
      active: !weekend && inRange(12, 16),
    },
    {
      label: "NY + Tokyo Overlap",
      active: !weekend && inRange(21, 0),
    },
  ];
}
