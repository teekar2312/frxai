/**
 * RA-004: Shared simulated candle generator.
 * Used by finnhub route and backtest route.
 */

import type { ForexPair, CandleData } from './trading-types';
import { SIMULATED_BASES } from './trading-types';

export function generateSimulatedCandles(
  pair: ForexPair,
  count: number,
  intervalSeconds = 300,
): CandleData[] {
  const base = SIMULATED_BASES[pair];
  const candles: CandleData[] = [];
  let price = base.price * (1 - base.volatility * 2);
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < count; i++) {
    const open = price;
    const change1 = (Math.random() - 0.5) * base.volatility;
    const change2 = (Math.random() - 0.5) * base.volatility;
    const change3 = (Math.random() - 0.5) * base.volatility * 0.5;
    const close = open + change1 + change2 + change3;
    const high = Math.max(open, close) + Math.random() * base.volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * base.volatility * 0.5;
    // FNH-018: Time-weighted volume (higher during London/NY sessions)
    const hour = new Date((now - (count - i) * intervalSeconds) * 1000).getUTCHours();
    const sessionMultiplier = (hour >= 7 && hour <= 17) ? 1.5 : 0.6;
    const volume = Math.floor((Math.random() * 3000 + 500) * sessionMultiplier);

    candles.push({
      time: (now - (count - i) * intervalSeconds) * 1000,
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
