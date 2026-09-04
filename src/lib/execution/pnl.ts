/*
 * Trade Execution Engine — PART 3/10: pnl.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 82-83, 295-324):
 *   - PNL CALCULATION HELPERS (calculatePnl, calculatePnlPercent)
 *   - Module-private constant PIP_VALUE_PER_LOT (sole-dependency of
 *     calculatePnl; also declared in pipeline.ts, which needs the same
 *     immutable literal for slippage/margin math — kept private to preserve
 *     the original export set)
 */

/** Pip value per standard lot (100 000 units). */
const PIP_VALUE_PER_LOT = 100_000

// ============================================
// PNL CALCULATION HELPERS
// ============================================

/**
 * Calculate PnL for a trade based on direction, entry price, close price, lot size, and commission.
 *   BUY:  (closePrice - entryPrice) * lotSize * 100000 - commission
 *   SELL: (entryPrice - closePrice) * lotSize * 100000 - commission
 */
export function calculatePnl(
  direction: string,
  entryPrice: number,
  closePrice: number,
  lotSize: number,
  commission: number = 0,
): number {
  if (direction === 'BUY') {
    return (closePrice - entryPrice) * lotSize * PIP_VALUE_PER_LOT - commission
  }
  // SELL
  return (entryPrice - closePrice) * lotSize * PIP_VALUE_PER_LOT - commission
}

/**
 * Calculate PnL percentage relative to the margin used.
 */
export function calculatePnlPercent(pnl: number, margin: number): number {
  if (margin <= 0) return 0
  return (pnl / margin) * 100
}
