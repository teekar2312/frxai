import { PAIRS } from "./constants";
import type { Pair, Quote, TradeRow } from "./types";

/** Format a number as USD currency: $X,XXX.XX */
export function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Alias for fmtUsd (some sections use formatMoney) */
export const formatMoney = fmtUsd;

/** Get pair metadata */
export function pairMeta(s: Pair) {
  return PAIRS.find((p) => p.symbol === s)!;
}

/** Format a price with correct digits per pair */
export function fmtPrice(s: Pair, v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(pairMeta(s).digits);
}

/**
 * P2-M3: Per-pair pip value in USD per 1.0 lot.
 * - EURUSD/GBPUSD: 0.0001 × 100000 = $10/pip/lot
 * - XAUUSD: 0.1 × 100 = $10/pip/lot
 * - USDJPY: 0.01 × 100000 / price ≈ $6.37/pip/lot at 157
 *   (1 pip = 0.01 JPY; 100000 × 0.01 = 1000 JPY; ÷ price = USD)
 */
export function pipValuePerLot(s: Pair, price?: number): number {
  const meta = pairMeta(s);
  if (s === "USDJPY" && price) {
    return (meta.pipSize * meta.contractSize) / price;
  }
  return meta.pipSize * meta.contractSize;
}

/** Compute live P&L for an open trade given current quotes */
export function livePnl(
  trade: TradeRow,
  quotes: Record<Pair, Quote>,
): { pips: number; pnl: number } {
  if (trade.status === "CLOSED") {
    return { pips: trade.pips ?? 0, pnl: trade.pnl ?? 0 };
  }
  const q = quotes[trade.symbol];
  if (!q) return { pips: trade.pips ?? 0, pnl: trade.pnl ?? 0 };
  const meta = pairMeta(trade.symbol);
  const currentPrice = trade.side === "BUY" ? q.bid : q.ask;
  const pipsRaw =
    trade.side === "BUY"
      ? (currentPrice - trade.openPrice) / meta.pipSize
      : (trade.openPrice - currentPrice) / meta.pipSize;
  const pips = +pipsRaw.toFixed(1);
  // P2-M3: use per-pair pip value (USDJPY computed from openPrice)
  const pv = pipValuePerLot(trade.symbol, trade.openPrice);
  const pnl = +(pips * pv * trade.lotSize).toFixed(2);
  return { pips, pnl };
}
