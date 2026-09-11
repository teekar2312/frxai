import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureAccountWithDailyReset, getConfig, log } from "@/lib/server-config";
import { PAIRS } from "@/lib/constants";
import { getQuote } from "@/lib/market";
import { marginRequired } from "@/lib/trade-math";
import type { Pair, RiskConfig, Side, TradingConfig, TradeRow } from "@/lib/types";

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

  // P0-C2: ensure daily reset before checking limits
  const acc = await ensureAccountWithDailyReset();
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
  const trading = await getConfig<TradingConfig>("trading", {
    pairs: [],
    timeframes: [],
    sessions: [],
    avoidWeekends: true,
    autoMode: false,
    trailingAuto: false,
    indicatorAuto: false,
    riskAuto: false,
  });

  // Weekend gate
  const now = new Date();
  if (trading.avoidWeekends && (now.getUTCDay() === 0 || now.getUTCDay() === 6)) {
    await log("WARN", "RISK", `Trade rejected: weekend (avoidWeekends active)`);
    return NextResponse.json(
      { error: "Trading dihentikan pada hari Sabtu & Minggu (avoidWeekends aktif)." },
      { status: 400 },
    );
  }

  // Session gate
  if (trading.sessions.length > 0) {
    const h = now.getUTCHours();
    const inRange = (a: number, b: number) => (a < b ? h >= a && h < b : h >= a || h < b);
    const sessionMap: Record<string, [number, number]> = {
      Sydney: [21, 6], Tokyo: [0, 9], London: [7, 16],
      NewYork: [12, 21], LondonNewYork: [12, 16], NewYorkTokyo: [21, 0],
    };
    const inSession = trading.sessions.some((s) => {
      const r = sessionMap[s];
      return r ? inRange(r[0], r[1]) : false;
    });
    if (!inSession) {
      await log("WARN", "RISK", `Trade rejected: outside configured sessions (${trading.sessions.join(", ")})`);
      return NextResponse.json(
        { error: `Di luar sesi trading terkonfigurasi: ${trading.sessions.join(", ")}.` },
        { status: 400 },
      );
    }
  }

  // P1-M1: Server-side validation — clamp lot & SL to safe bounds
  const lotSize = Math.min(Math.max(body.lotSize ?? 0.01, 0.01), 50); // broker min 0.01, max 50
  const slPips = Math.min(
    Math.max(body.stopLossPips ?? risk.stopLossPipsMin, risk.stopLossPipsMin),
    risk.stopLossPipsMax,
  );
  const tpPips = body.takeProfitPips
    ? Math.min(Math.max(body.takeProfitPips ?? slPips * risk.rrRatio, slPips), slPips * 5)
    : +(slPips * risk.rrRatio).toFixed(1);

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

  const slAbs = body.side === "BUY" ? openPrice - slPips * meta.pipSize : openPrice + slPips * meta.pipSize;
  const tpAbs = body.side === "BUY" ? openPrice + tpPips * meta.pipSize : openPrice - tpPips * meta.pipSize;

  // P0-C1: correct margin using contractSize per pair
  const marginUsed = marginRequired(body.symbol, lotSize, openPrice, 500);

  const ticket = `${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`;

  // P0-H3: Wrap count-check + create + margin-update in a transaction
  // to prevent race conditions (double-click, auto-tick + manual)
  try {
    const result = await db.$transaction(async (tx) => {
      // Re-check open positions INSIDE the transaction (serializable)
      const openCount = await tx.trade.count({ where: { status: "OPEN" } });
      if (openCount >= risk.maxOpenPositions) {
        throw new Error("MAX_POSITIONS");
      }

      const trade = await tx.trade.create({
        data: {
          ticket,
          symbol: body.symbol,
          side: body.side,
          lotSize,
          openPrice,
          stopLoss: slAbs,
          takeProfit: tpAbs,
          trailingStop: !!body.trailingStop,
          trailingPips: body.trailingPips ?? null,
          slPips,
          tpPips,
          marginUsed, // P0-C1: store margin at open
          status: "OPEN",
          source: body.source ?? "MANUAL",
          strategy: body.strategy ?? null,
        },
      });

      // Atomic margin update
      await tx.account.update({
        where: { id: acc.id },
        data: {
          margin: { increment: marginUsed },
          freeMargin: { decrement: marginUsed },
        },
      });

      return trade;
    });

    await log("TRADE", "MT5", `OPEN ${body.side} ${body.symbol} ${lotSize} lot @ ${openPrice} | SL ${slPips}p TP ${tpPips}p | margin $${marginUsed.toFixed(2)}`, { ticket });

    const row: TradeRow = {
      id: result.id,
      ticket: result.ticket,
      symbol: result.symbol as Pair,
      side: result.side as Side,
      lotSize: result.lotSize,
      openPrice: result.openPrice,
      closePrice: result.closePrice,
      stopLoss: result.stopLoss,
      takeProfit: result.takeProfit,
      trailingStop: result.trailingStop,
      trailingPips: result.trailingPips,
      slPips: result.slPips,
      tpPips: result.tpPips,
      pnl: result.pnl,
      pips: result.pips,
      status: result.status as "OPEN" | "CLOSED",
      source: result.source as "MANUAL" | "AI",
      strategy: result.strategy,
      openedAt: result.openedAt.toISOString(),
      closedAt: result.closedAt?.toISOString() ?? null,
    };
    return NextResponse.json({ trade: row, ok: true });
  } catch (e: any) {
    if (e?.message === "MAX_POSITIONS") {
      await log("WARN", "RISK", `Trade rejected: max open positions (${risk.maxOpenPositions}) reached`);
      return NextResponse.json(
        { error: `Maksimal ${risk.maxOpenPositions} posisi terbuka tercapai` },
        { status: 400 },
      );
    }
    await log("ERROR", "TRADE", `Place order failed: ${e?.message ?? e}`);
    return NextResponse.json({ error: "Gagal menempatkan order" }, { status: 500 });
  }
}
