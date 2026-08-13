/**
 * FNH-002/FNH-003/C-001: Price fetcher now delegates to centralized price-cache.
 * Eliminates duplicated symbol mapping and simulated bases.
 */

export interface PriceQuote {
  mid: number;
  bid: number;
  ask: number;
  simulated: boolean;
}

import { getCurrentMidPrice } from './price-cache';
import { PAIR_PIP_VALUES, FINEX_CONFIG } from './trading-types';
import type { ForexPair } from './trading-types';

/**
 * Get the current mid/bid/ask for a forex pair.
 * Uses centralized cache (C-001), falls back to Finnhub direct, then simulated.
 */
export async function getCurrentPrice(pair: string): Promise<PriceQuote | null> {
  const result = await getCurrentMidPrice(pair);
  if (!result) return null;

  const mid = result.mid;
  // RA-002: Use PAIR_PIP_VALUES instead of hardcoded pipSize
  const pipSize = PAIR_PIP_VALUES[pair as ForexPair]?.pipSize ?? 0.0001;
  const spread = FINEX_CONFIG.spreadPip * pipSize; // C-007: use config spread

  return {
    mid,
    bid: parseFloat((mid - spread / 2).toFixed(5)),
    ask: parseFloat((mid + spread / 2).toFixed(5)),
    simulated: result.simulated,
  };
}

/** Legacy compat: returns mid price only */
export async function getCurrentMidPriceLegacy(pair: string): Promise<number | null> {
  const result = await getCurrentPrice(pair);
  return result?.mid ?? null;
}
