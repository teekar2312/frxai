import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, log } from "@/lib/server-config";
import { PAIRS } from "@/lib/constants";
import { getQuote } from "@/lib/market";
import type { Pair, TradeRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id } = (await req.json()) as { id: string };
  const trade = await db.trade.findUnique({ where: { id } });
  if (!trade || trade.status !== "OPEN") {
    return NextResponse.json({ error: "Trade not found / not open" }, { status: 404 });
  }
  const meta = PAIRS.find((p) => p.symbol === trade.symbol)!;
  const quote = getQuote(trade.symbol as Pair);
  const closePrice = trade.side === "BUY" ? quote.bid : quote.ask;
  const pipsRaw =
    trade.side === "BUY"
      ? (closePrice - trade.openPrice) / meta.pipSize
      : (trade.openPrice - closePrice) / meta.pipSize;
  const pips = +pipsRaw.toFixed(1);
  // PnL: pips * pipValuePerLot * lotSize. pipValue ≈ $10/lot for USD-quoted FX, $1 for XAU per 0.1 pip
  const pipValue = trade.symbol === "XAUUSD" ? 1 : 10; // $ per pip per lot (approx)
  const pnl = +(pips * pipValue * trade.lotSize).toFixed(2);

  const updated = await db.trade.update({
    where: { id },
    data: { status: "CLOSED", closePrice, pnl, pips, closedAt: new Date() },
  });

  const acc = await ensureAccount();
  const notional = trade.lotSize * 100000 * trade.openPrice;
  const marginUsed = notional / 500;
  const newBalance = acc.balance + pnl;
  const dailyLossUsed = pnl < 0 ? acc.dailyLossUsed + (Math.abs(pnl) / acc.balance) * 100 : acc.dailyLossUsed;
  await db.account.update({
    where: { id: acc.id },
    data: {
      balance: newBalance,
      equity: newBalance,
      margin: { decrement: marginUsed },
      freeMargin: { increment: marginUsed },
      dailyLossUsed,
    },
  });

  await log("TRADE", "MT5", `CLOSE ${trade.side} ${trade.symbol} ${trade.lotSize} lot @ ${closePrice} | PnL ${pnl >= 0 ? "+" : ""}${pnl} (${pips}p)`, { ticket: trade.ticket });

  const row: TradeRow = {
    id: updated.id,
    ticket: updated.ticket,
    symbol: updated.symbol as Pair,
    side: updated.side as any,
    lotSize: updated.lotSize,
    openPrice: updated.openPrice,
    closePrice: updated.closePrice,
    stopLoss: updated.stopLoss,
    takeProfit: updated.takeProfit,
    trailingStop: updated.trailingStop,
    trailingPips: updated.trailingPips,
    slPips: updated.slPips,
    tpPips: updated.tpPips,
    pnl: updated.pnl,
    pips: updated.pips,
    status: updated.status as "OPEN" | "CLOSED",
    source: updated.source as "MANUAL" | "AI",
    strategy: updated.strategy,
    openedAt: updated.openedAt.toISOString(),
    closedAt: updated.closedAt!.toISOString(),
  };
  return NextResponse.json({ trade: row, ok: true });
}
