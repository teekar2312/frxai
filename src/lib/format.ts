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

/** Pip value per 1.0 lot in USD = $10 for all pairs (FX & XAUUSD) */
export function pipValuePerLot(_s: Pair): number {
  return 10;
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
  const pnl = +(pips * pipValuePerLot(trade.symbol) * trade.lotSize).toFixed(2);
  return { pips, pnl };
}
