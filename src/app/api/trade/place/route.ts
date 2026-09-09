import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccount, getConfig, log } from "@/lib/server-config";
import { PAIRS } from "@/lib/constants";
import { getQuote } from "@/lib/market";
import type { Pair, RiskConfig, Side, TradeRow } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PlaceBody {
  symbol: Pair;
  side: Side;
  lotSize: number;
  stopLossPips?: number;
  takeProfitPips?: number;
  trailingStop?: boolean;
  trailingPips?: number;
  source?: "MANUAL" | "AI";
  strategy?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as PlaceBody;
  const meta = PAIRS.find((p) => p.symbol === body.symbol);
  if (!meta) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });

  const acc = await ensureAccount();
  const risk = await getConfig<RiskConfig>("risk", {
    riskPerTrade: 1,
    stopLossPipsMin: 5,
    stopLossPipsMax: 15,
    rrRatio: 1.5,
    maxOpenPositions: 3,
    dailyLossLimit: 3,
    avoidHighImpactNews: true,
    dailyTarget: 2,
    autoMode: false,
  });

  // Enforce max open positions
  const openCount = await db.trade.count({ where: { status: "OPEN" } });
  if (openCount >= risk.maxOpenPositions) {
    await log("WARN", "RISK", `Trade rejected: max open positions (${risk.maxOpenPositions}) reached`);
    return NextResponse.json(
      { error: `Maksimal ${risk.maxOpenPositions} posisi terbuka tercapai` },
      { status: 400 },
    );
  }

  // Daily loss limit (anti-MC)
  if (acc.dailyLossUsed >= risk.dailyLossLimit) {
    await log("WARN", "RISK", `Trade rejected: daily loss limit ${risk.dailyLossLimit}% reached (anti-MC)`);
    return NextResponse.json(
      { error: `Daily risk limit ${risk.dailyLossLimit}% tercapai (Anti-MC). Trading dihentikan hari ini.` },
      { status: 400 },
    );
  }

  const quote = getQuote(body.symbol);
  const openPrice = body.side === "BUY" ? quote.ask : quote.bid;
  const slPips = body.stopLossPips ?? Math.min(Math.max(risk.stopLossPipsMin, 8), risk.stopLossPipsMax);
  const tpPips = body.takeProfitPips ?? +(slPips * risk.rrRatio).toFixed(1);

  const slAbs = body.side === "BUY" ? openPrice - slPips * meta.pipSize : openPrice + slPips * meta.pipSize;
  const tpAbs = body.side === "BUY" ? openPrice + tpPips * meta.pipSize : openPrice - tpPips * meta.pipSize;

  const ticket = `${Date.now().toString().slice(-9)}`;
  const trade = await db.trade.create({
    data: {
      ticket,
      symbol: body.symbol,
      side: body.side,
      lotSize: body.lotSize,
      openPrice,
      stopLoss: slAbs,
      takeProfit: tpAbs,
      trailingStop: !!body.trailingStop,
      trailingPips: body.trailingPips ?? null,
      slPips,
      tpPips,
      status: "OPEN",
      source: body.source ?? "MANUAL",
      strategy: body.strategy ?? null,
    },
  });

  // Update margin (rough estimate: notional / leverage)
  const notional = body.lotSize * 100000 * openPrice; // for XXXUSD-style
  const marginUsed = notional / 500; // 1:500
  await db.account.update({
    where: { id: acc.id },
    data: { margin: { increment: marginUsed }, freeMargin: { decrement: marginUsed } },
  });

  await log("TRADE", "MT5", `OPEN ${body.side} ${body.symbol} ${body.lotSize} lot @ ${openPrice} | SL ${slPips}p TP ${tpPips}p`, { ticket });

  const row: TradeRow = {
    id: trade.id,
    ticket: trade.ticket,
    symbol: trade.symbol as Pair,
    side: trade.side as Side,
    lotSize: trade.lotSize,
    openPrice: trade.openPrice,
    closePrice: trade.closePrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    trailingStop: trade.trailingStop,
    trailingPips: trade.trailingPips,
    slPips: trade.slPips,
    tpPips: trade.tpPips,
    pnl: trade.pnl,
    pips: trade.pips,
    status: trade.status as "OPEN" | "CLOSED",
    source: trade.source as "MANUAL" | "AI",
    strategy: trade.strategy,
    openedAt: trade.openedAt.toISOString(),
    closedAt: trade.closedAt?.toISOString() ?? null,
  };
  return NextResponse.json({ trade: row, ok: true });
}
