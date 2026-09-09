import "server-only";
import { db } from "./db";
import { ensureAccount, getConfig, log, setConfig } from "./server-config";
import { analyzeMarket } from "./ai";
import { PAIRS } from "./constants";
import { getQuote } from "./market";
import type { Pair, RiskConfig, Side, TradingConfig, TradeRow } from "./types";

// Default scalping indicator subset used when indicatorAuto is ON.
const SCALPING_SUBSET = ["EMA", "RSI", "ATR", "Supertrend", "Bollinger Bands"];

export interface AutoTradeResult {
  pair: Pair;
  signal: "BUY" | "SELL" | "NEUTRAL";
  confidence: number;
  executed: boolean;
  trade?: TradeRow;
  reason: string;
  skipped?: boolean;
}

/**
 * Convert a strong AI signal into an actual OPEN Trade (source="AI").
 * Shared by /api/ai/signal (manual "Eksekusi Sinyal") and
 * /api/auto-trade/tick (background auto-trading).
 */
export async function executeSignalAsTrade(
  symbol: Pair,
  side: Side,
  confidence: number,
  suggestedEntry: number | undefined,
  suggestedStopLoss: number | undefined,
  suggestedTakeProfit: number | undefined,
  summary: string,
  signalId?: string,
): Promise<{ trade: TradeRow | null; reason: string }> {
  const meta = PAIRS.find((p) => p.symbol === symbol)!;
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

  // Pre-trade guards
  const openCount = await db.trade.count({ where: { status: "OPEN" } });
  if (openCount >= risk.maxOpenPositions) {
    if (signalId) await db.signal.update({ where: { id: signalId }, data: { status: "SKIPPED" } });
    return { trade: null, reason: `Maksimal ${risk.maxOpenPositions} posisi terbuka tercapai.` };
  }
  if (acc.dailyLossUsed >= risk.dailyLossLimit) {
    if (signalId) await db.signal.update({ where: { id: signalId }, data: { status: "SKIPPED" } });
    return { trade: null, reason: `Daily risk limit ${risk.dailyLossLimit}% tercapai (Anti-MC).` };
  }

  const quote = getQuote(symbol);
  const openPrice = side === "BUY" ? quote.ask : quote.bid;

  // SL distance from AI suggestion, clamped to risk bounds
  let slPips: number;
  if (suggestedStopLoss && suggestedEntry) {
    const slDist = Math.abs(suggestedStopLoss - suggestedEntry) / meta.pipSize;
    slPips = Math.min(Math.max(slDist, risk.stopLossPipsMin), risk.stopLossPipsMax);
  } else {
    slPips = Math.min(Math.max(risk.stopLossPipsMin, 8), risk.stopLossPipsMax);
  }
  const tpPips = +(slPips * risk.rrRatio).toFixed(1);
  const slAbs = side === "BUY" ? openPrice - slPips * meta.pipSize : openPrice + slPips * meta.pipSize;
  const tpAbs = side === "BUY" ? openPrice + tpPips * meta.pipSize : openPrice - tpPips * meta.pipSize;

  // Lot size from risk
  const pipValuePerLot = symbol === "XAUUSD" ? 1 : 10;
  const riskAmount = (acc.balance * risk.riskPerTrade) / 100;
  const lotSize = Math.max(0.01, +(riskAmount / (slPips * pipValuePerLot)).toFixed(2));

  // Enable trailing stop on AI trades when trailingAuto is ON
  const cfg = await getConfig<TradingConfig>("trading", {
    pairs: [], timeframes: [], sessions: [],
    avoidWeekends: true, autoMode: false,
    trailingAuto: false, indicatorAuto: false, riskAuto: false,
  });
  const useTrailing = cfg.trailingAuto;
  const trailingPipsVal = useTrailing ? slPips : null;

  const ticket = `${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 9)}`;
  const trade = await db.trade.create({
    data: {
      ticket,
      symbol,
      side,
      lotSize,
      openPrice,
      stopLoss: slAbs,
      takeProfit: tpAbs,
      trailingStop: useTrailing,
      trailingPips: trailingPipsVal,
      slPips,
      tpPips,
      status: "OPEN",
      source: "AI",
      strategy: `AI Auto Signal (${confidence}%)`,
    },
  });

  if (signalId) await db.signal.update({ where: { id: signalId }, data: { status: "EXECUTED" } });

  const notional = lotSize * 100000 * openPrice;
  const marginUsed = notional / 500;
  await db.account.update({
    where: { id: acc.id },
    data: { margin: { increment: marginUsed }, freeMargin: { decrement: marginUsed } },
  });

  await log("TRADE", "AUTO-TRADE", `AI AUTO-EXECUTE ${side} ${symbol} ${lotSize} lot @ ${openPrice} | SL ${slPips}p TP ${tpPips}p | conf ${confidence}%`, { ticket });

  const tradeRow: TradeRow = {
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
  return { trade: tradeRow, reason: `Dieksekusi: ${side} ${symbol} ${lotSize} lot @ ${openPrice}` };
}

/**
 * Run one auto-trade cycle: analyze ONE pair and execute if signal is strong.
 * The pair is chosen round-robin (oldest analysis first) so each call is fast
 * (~10-20s for one LLM call).
 */
export async function runAutoTradeCycle(): Promise<AutoTradeResult> {
  const cfg = await getConfig<TradingConfig>("trading", {
    pairs: ["EURUSD", "GBPUSD"],
    timeframes: ["M5", "M15"],
    sessions: ["London", "LondonNewYork"],
    avoidWeekends: true,
    autoMode: false,
    trailingAuto: false,
    indicatorAuto: false,
    riskAuto: false,
  });

  // Expire old PENDING signals (>30 min) — Phase 5
  await expireOldSignals();

  if (!cfg.autoMode) {
    return { pair: "EURUSD", signal: "NEUTRAL", confidence: 0, executed: false, reason: "Auto-trade OFF", skipped: true };
  }

  // Weekend gate
  const now = new Date();
  if (cfg.avoidWeekends && (now.getUTCDay() === 0 || now.getUTCDay() === 6)) {
    return { pair: "EURUSD", signal: "NEUTRAL", confidence: 0, executed: false, reason: "Weekend — trading dihentikan (avoidWeekends)", skipped: true };
  }

  // Session gate
  if (cfg.sessions.length > 0 && cfg.pairs.length > 0) {
    const h = now.getUTCHours();
    const inRange = (a: number, b: number) => (a < b ? h >= a && h < b : h >= a || h < b);
    const sessionMap: Record<string, [number, number]> = {
      Sydney: [21, 6],
      Tokyo: [0, 9],
      London: [7, 16],
      NewYork: [12, 21],
      LondonNewYork: [12, 16],
      NewYorkTokyo: [21, 0],
    };
    const inSession = cfg.sessions.some((s) => {
      const range = sessionMap[s];
      return range ? inRange(range[0], range[1]) : false;
    });
    if (!inSession) {
      return { pair: cfg.pairs[0], signal: "NEUTRAL", confidence: 0, executed: false, reason: `Di luar sesi trading terkonfigurasi (${cfg.sessions.join(", ")})`, skipped: true };
    }
  }

  if (cfg.pairs.length === 0) {
    return { pair: "EURUSD", signal: "NEUTRAL", confidence: 0, executed: false, reason: "Tidak ada pair aktif", skipped: true };
  }

  // Pick pair with oldest AiAnalysis (round-robin)
  const pair = await pickNextPair(cfg.pairs as Pair[]);

  // Analyze
  const analysis = await analyzeMarket(pair);
  await log("AI", "AUTO-TRADE", `Auto-tick analyzed ${pair}: ${analysis.signal} @ ${analysis.confidence}%`);

  // Weak signal -> skip
  if (analysis.signal === "NEUTRAL" || analysis.confidence < 55) {
    await db.signal.create({
      data: {
        symbol: pair,
        side: analysis.signal === "NEUTRAL" ? "BUY" : analysis.signal,
        entry: analysis.suggestedEntry ?? 0,
        stopLoss: analysis.suggestedStopLoss ?? 0,
        takeProfit: analysis.suggestedTakeProfit ?? 0,
        confidence: analysis.confidence,
        reason: analysis.summary,
        source: "AI",
        status: "SKIPPED",
      },
    });
    return {
      pair,
      signal: analysis.signal,
      confidence: analysis.confidence,
      executed: false,
      reason: `Signal ${analysis.signal} @ ${analysis.confidence}% di bawah threshold, skip.`,
      skipped: true,
    };
  }

  // Strong signal -> create Signal PENDING, then execute as Trade
  const signal = await db.signal.create({
    data: {
      symbol: pair,
      side: analysis.signal,
      entry: analysis.suggestedEntry ?? 0,
      stopLoss: analysis.suggestedStopLoss ?? 0,
      takeProfit: analysis.suggestedTakeProfit ?? 0,
      confidence: analysis.confidence,
      reason: analysis.summary,
      source: "AI",
      status: "PENDING",
    },
  });

  const { trade, reason } = await executeSignalAsTrade(
    pair,
    analysis.signal as Side,
    analysis.confidence,
    analysis.suggestedEntry,
    analysis.suggestedStopLoss,
    analysis.suggestedTakeProfit,
    analysis.summary,
    signal.id,
  );

  return {
    pair,
    signal: analysis.signal,
    confidence: analysis.confidence,
    executed: !!trade,
    trade: trade ?? undefined,
    reason,
  };
}

/** Pick the pair whose most recent AiAnalysis is the oldest (round-robin). */
async function pickNextPair(pairs: Pair[]): Promise<Pair> {
  const recent = await db.aiAnalysis.findMany({
    where: { symbol: { in: pairs } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const lastSeen: Record<string, Date> = {};
  for (const a of recent) {
    if (!lastSeen[a.symbol]) lastSeen[a.symbol] = a.createdAt;
  }
  // Pick pair with oldest (or never-seen) analysis
  let pick = pairs[0];
  let pickTime = lastSeen[pairs[0]] ?? new Date(0);
  for (const p of pairs) {
    const t = lastSeen[p] ?? new Date(0);
    if (t < pickTime) {
      pick = p;
      pickTime = t;
    }
  }
  return pick;
}

/** Mark PENDING signals older than 30 minutes as EXPIRED. */
export async function expireOldSignals(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const result = await db.signal.updateMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

/**
 * Trailing stop pass: for each OPEN trade with trailingStop=true (or all OPEN
 * trades if trailingAuto is on), move SL toward current price.
 * Returns number of trades updated.
 */
export async function runTrailingStopPass(): Promise<{ updated: number; details: { ticket: string; symbol: string; oldSL: number; newSL: number }[] }> {
  const cfg = await getConfig<TradingConfig>("trading", {
    pairs: [],
    timeframes: [],
    sessions: [],
    avoidWeekends: true,
    autoMode: false,
    trailingAuto: false,
    indicatorAuto: false,
    riskAuto: false,
  });

  // If trailingAuto is off, only trail trades that have per-trade trailingStop=true
  const where = cfg.trailingAuto
    ? { status: "OPEN" as const, trailingStop: true }
    : { status: "OPEN" as const, trailingStop: true };
  // (both branches filter trailingStop=true; trailingAuto gates whether the feature is available at all,
  //  but per-trade trailingStop must always be true to trail. If trailingAuto is on, the UI auto-enables
  //  trailingStop on new AI trades — see executeSignalAsTrade. For now both require trailingStop=true.)

  const trades = await db.trade.findMany({ where });
  const details: { ticket: string; symbol: string; oldSL: number; newSL: number }[] = [];
  let updated = 0;

  for (const t of trades) {
    const meta = PAIRS.find((p) => p.symbol === t.symbol);
    if (!meta || !t.trailingPips || !t.stopLoss) continue;
    const quote = getQuote(t.symbol as Pair);
    const trailDist = t.trailingPips * meta.pipSize;
    let newSL = t.stopLoss;
    if (t.side === "BUY") {
      // Move SL up: newSL = max(currentSL, currentBid - trailDist)
      const candidate = quote.bid - trailDist;
      if (candidate > t.stopLoss) newSL = candidate;
    } else {
      // Move SL down: newSL = min(currentSL, currentAsk + trailDist)
      const candidate = quote.ask + trailDist;
      if (candidate < t.stopLoss) newSL = candidate;
    }
    if (newSL !== t.stopLoss) {
      await db.trade.update({ where: { id: t.id }, data: { stopLoss: newSL } });
      details.push({ ticket: t.ticket, symbol: t.symbol, oldSL: t.stopLoss, newSL });
      updated++;
      await log("TRADE", "TRAILING", `Trailing SL ${t.symbol} ${t.side}: ${t.stopLoss} → ${newSL} (ticket ${t.ticket})`);
    }
  }
  return { updated, details };
}

/**
 * AI auto-select indicators: when indicatorAuto is ON, enable a sensible
 * scalping subset and disable the rest. Called from the auto-trade tick.
 */
export async function autoSelectIndicators(): Promise<{ changed: number; enabled: string[] }> {
  const cfg = await getConfig<TradingConfig>("trading", {
    pairs: [], timeframes: [], sessions: [],
    avoidWeekends: true, autoMode: false,
    trailingAuto: false, indicatorAuto: false, riskAuto: false,
  });
  if (!cfg.indicatorAuto) return { changed: 0, enabled: [] };

  const all = await db.indicatorConfig.findMany();
  let changed = 0;
  for (const ind of all) {
    const shouldBeEnabled = SCALPING_SUBSET.includes(ind.name);
    if (ind.enabled !== shouldBeEnabled) {
      await db.indicatorConfig.update({
        where: { id: ind.id },
        data: { enabled: shouldBeEnabled, autoMode: true },
      });
      changed++;
    }
  }
  if (changed > 0) {
    await log("AI", "INDICATOR-AUTO", `Auto-selected ${SCALPING_SUBSET.length} scalping indicators (${SCALPING_SUBSET.join(", ")}), ${changed} changed`);
  }
  return { changed, enabled: SCALPING_SUBSET };
}

/**
 * AI auto-adjust risk: when riskAuto is ON, scale riskPerTrade down after
 * consecutive losses and restore after wins. Called from the auto-trade tick.
 */
export async function autoAdjustRisk(): Promise<{ adjusted: boolean; newRisk: number; reason: string }> {
  const cfg = await getConfig<TradingConfig>("trading", {
    pairs: [], timeframes: [], sessions: [],
    avoidWeekends: true, autoMode: false,
    trailingAuto: false, indicatorAuto: false, riskAuto: false,
  });
  if (!cfg.riskAuto) return { adjusted: false, newRisk: 0, reason: "riskAuto OFF" };

  const risk = await getConfig<RiskConfig>("risk", {
    riskPerTrade: 1, stopLossPipsMin: 5, stopLossPipsMax: 15,
    rrRatio: 1.5, maxOpenPositions: 3, dailyLossLimit: 3,
    avoidHighImpactNews: true, dailyTarget: 2, autoMode: false,
  });

  // Look at last 5 closed trades
  const recent = await db.trade.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 5,
  });
  if (recent.length < 3) return { adjusted: false, newRisk: risk.riskPerTrade, reason: "Belum cukup data (butuh min 3 trade closed)" };

  // Count consecutive losses from most recent
  let consecLosses = 0;
  for (const t of recent) {
    if (t.pnl < 0) consecLosses++;
    else break;
  }

  let newRisk = risk.riskPerTrade;
  let reason = "Tidak ada penyesuaian";
  if (consecLosses >= 3) {
    // 3+ consecutive losses → halve risk (min 0.5%)
    newRisk = Math.max(0.5, +(risk.riskPerTrade / 2).toFixed(2));
    reason = `${consecLosses} loss beruntun → turunkan risk ke ${newRisk}%`;
  } else if (consecLosses === 0 && recent[0].pnl > 0) {
    // Winning → restore toward 1% (max)
    newRisk = Math.min(1, +(risk.riskPerTrade + 0.1).toFixed(2));
    reason = `Win streak → naikkan risk ke ${newRisk}%`;
  }

  if (newRisk !== risk.riskPerTrade) {
    const updated = { ...risk, riskPerTrade: newRisk };
    await setConfig("risk", updated);
    await log("AI", "RISK-AUTO", `Auto-adjusted risk: ${risk.riskPerTrade}% → ${newRisk}% (${reason})`);
    return { adjusted: true, newRisk, reason };
  }
  return { adjusted: false, newRisk, reason };
}

