import "server-only";
import { PAIRS } from "./constants";
import type { Pair } from "./types";

/**
 * Compute the notional value (in USD) for a given position.
 * P0-C1: uses contractSize per pair (100000 for FX, 100 for XAUUSD).
 *
 * For USD-quoted pairs (EURUSD, GBPUSD, XAUUSD): notional = lot × contractSize × price
 * For JPY pairs (USDJPY): notional = lot × contractSize (price is in JPY, but
 *   1 lot USDJPY = 100,000 USD notional regardless of JPY price).
 */
export function notionalUsd(symbol: Pair, lot: number, price: number): number {
  const meta = PAIRS.find((p) => p.symbol === symbol)!;
  if (symbol === "USDJPY") {
    // 1 lot USDJPY = 100,000 USD base
    return lot * meta.contractSize;
  }
  return lot * meta.contractSize * price;
}

/** Margin required = notional / leverage (leverage = 500 for 1:500) */
export function marginRequired(symbol: Pair, lot: number, price: number, leverage = 500): number {
  return notionalUsd(symbol, lot, price) / leverage;
}

/**
 * P2-M3: Per-pair pip value in USD per 1.0 lot.
 *
 * - EURUSD/GBPUSD: pipSize × contractSize = 0.0001 × 100000 = $10/pip/lot
 * - XAUUSD: pipSize × contractSize = 0.1 × 100 = $10/pip/lot
 * - USDJPY: pipSize × contractSize / price = 0.01 × 100000 / 157 ≈ $6.37/pip/lot
 *   (1 pip = 0.01 JPY move; 100,000 × 0.01 = 1000 JPY; ÷ 157 ≈ $6.37)
 */
export function pipValuePerLot(symbol: Pair, price: number): number {
  const meta = PAIRS.find((p) => p.symbol === symbol)!;
  if (symbol === "USDJPY") {
    // JPY-denominated: convert JPY pip value to USD
    return (meta.pipSize * meta.contractSize) / price;
  }
  return meta.pipSize * meta.contractSize;
}

/**
 * P0-C2: Check if daily loss counter should reset.
 * Returns true if the last reset was on a different UTC day than now.
 */
export function shouldResetDaily(lastResetAt: Date | null, now = new Date()): boolean {
  if (!lastResetAt) return true;
  // Compare UTC date as YYYY-MM-DD string — handles day/month/year boundary
  const lastDay = `${lastResetAt.getUTCFullYear()}-${lastResetAt.getUTCMonth() + 1}-${lastResetAt.getUTCDate()}`;
  const todayDay = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
  return lastDay !== todayDay;
}
