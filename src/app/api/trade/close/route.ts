import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccountWithDailyReset, log } from "@/lib/server-config";
import { PAIRS } from "@/lib/constants";
import { peekQuote } from "@/lib/market";
import { pipValuePerLot } from "@/lib/trade-math";
import type { Pair, TradeRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { id } = (await req.json()) as { id: string };

  // H1 FIX: ensure daily reset before processing close
  await ensureAccountWithDailyReset();

  // P0-H3: Wrap the entire close in a transaction to prevent race conditions
  try {
    const result = await db.$transaction(async (tx) => {
      const trade = await tx.trade.findUnique({ where: { id } });
      if (!trade || trade.status !== "OPEN") {
        throw new Error("NOT_FOUND");
      }
      const meta = PAIRS.find((p) => p.symbol === trade.symbol)!;
      const quote = peekQuote(trade.symbol as Pair); // don't advance price on close
      const closePrice = trade.side === "BUY" ? quote.bid : quote.ask;
      const pipsRaw =
        trade.side === "BUY"
          ? (closePrice - trade.openPrice) / meta.pipSize
          : (trade.openPrice - closePrice) / meta.pipSize;
      const pips = +pipsRaw.toFixed(1);

      // P2-M3: per-pair pip value (USDJPY computed correctly)
      const pipValue = pipValuePerLot(trade.symbol as Pair, trade.openPrice);
      const pnl = +(pips * pipValue * trade.lotSize).toFixed(2);

      const updated = await tx.trade.update({
        where: { id },
        data: { status: "CLOSED", closePrice, pnl, pips, closedAt: new Date() },
      });

      // P0-C2: ensure daily reset
      const acc = await tx.account.findFirst();
      if (!acc) throw new Error("NO_ACCOUNT");

      // P0-C1: use stored marginUsed (release exactly what was reserved)
      const marginToRelease = trade.marginUsed || (trade.lotSize * 100000 * trade.openPrice) / 500;

      // P0-H3: atomic increment/decrement for balance & dailyLoss
      // Balance: atomic increment by pnl
      // DailyLoss: atomic increment if loss (as % of balance)
      const dailyLossIncrement = pnl < 0 ? (Math.abs(pnl) / acc.balance) * 100 : 0;

      // P2-M4 + H3: update balance/equity/margin + recompute marginLevel
      const updatedAcc = await tx.account.update({
        where: { id: acc.id },
        data: {
          balance: { increment: pnl },
          equity: { increment: pnl },
          margin: { decrement: marginToRelease },
          freeMargin: { increment: marginToRelease },
          dailyLossUsed: { increment: dailyLossIncrement },
        },
      });
      // H3: recompute marginLevel
      const ml = updatedAcc.margin > 0 ? (updatedAcc.equity / updatedAcc.margin) * 100 : 0;
      if (updatedAcc.margin > 0) {
        await tx.account.update({
          where: { id: acc.id },
          data: { marginLevel: ml },
        });
      } else {
        await tx.account.update({
          where: { id: acc.id },
          data: { marginLevel: 0 },
        });
      }

      return { trade: updated, pnl, pips, closePrice };
    });

    await log("TRADE", "MT5", `CLOSE ${result.trade.side} ${result.trade.symbol} ${result.trade.lotSize} lot @ ${result.closePrice} | PnL ${result.pnl >= 0 ? "+" : ""}${result.pnl} (${result.pips}p)`, { ticket: result.trade.ticket });

    // C1: Return updated account so UI can refresh Anti-MC bar immediately
    const updatedAcc = await db.account.findFirst();
    const accountState = updatedAcc
      ? {
          broker: updatedAcc.broker,
          login: updatedAcc.login,
          server: updatedAcc.server,
          leverage: updatedAcc.leverage,
          currency: updatedAcc.currency,
          balance: updatedAcc.balance,
          equity: updatedAcc.equity,
          margin: updatedAcc.margin,
          freeMargin: updatedAcc.freeMargin,
          marginLevel: updatedAcc.marginLevel,
          mt5Connected: updatedAcc.mt5Connected,
          dailyLossUsed: updatedAcc.dailyLossUsed,
          dailyLossLimit: updatedAcc.dailyLossLimit,
        }
      : undefined;

    const row: TradeRow = {
      id: result.trade.id,
      ticket: result.trade.ticket,
      symbol: result.trade.symbol as Pair,
      side: result.trade.side as any,
      lotSize: result.trade.lotSize,
      openPrice: result.trade.openPrice,
      closePrice: result.trade.closePrice,
      stopLoss: result.trade.stopLoss,
      takeProfit: result.trade.takeProfit,
      trailingStop: result.trade.trailingStop,
      trailingPips: result.trade.trailingPips,
      slPips: result.trade.slPips,
      tpPips: result.trade.tpPips,
      pnl: result.trade.pnl,
      pips: result.trade.pips,
      status: result.trade.status as "OPEN" | "CLOSED",
      source: result.trade.source as "MANUAL" | "AI",
      strategy: result.trade.strategy,
      openedAt: result.trade.openedAt.toISOString(),
      closedAt: result.trade.closedAt!.toISOString(),
    };
    return NextResponse.json({ trade: row, account: accountState, ok: true });
  } catch (e: any) {
    if (e?.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Trade not found / not open" }, { status: 404 });
    }
    await log("ERROR", "TRADE", `Close order failed: ${e?.message ?? e}`);
    return NextResponse.json({ error: "Gagal menutup posisi" }, { status: 500 });
  }
}
