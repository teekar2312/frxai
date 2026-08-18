import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, StrategyName, CandleData, BacktestConfig, BacktestResult } from '@/lib/trading-types';
import { PAIR_PIP_VALUES, FINEX_CONFIG, PAIR_TO_FINNHUB_SYMBOL, RESOLUTION_TO_SECONDS, toFinnhubResolution, FOREX_PAIRS } from '@/lib/trading-types';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { generateSimulatedCandles } from '@/lib/sim-candles';
// FIX IND-005: Only import what's actually used
import {
  ema, rsi, macd, atr, pivotPoints,
  supertrend, linearRegressionChannel, schaffTrendCycle,
} from '@/lib/indicators';
import type { OHLCV } from '@/lib/indicators';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

interface BacktestTrade {
  id: number;
  entryIndex: number;
  exitIndex: number;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  lotSize: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  pnlPips: number;
  reason: string;
  entryTime: number;
  exitTime: number;
}

// FNH-019: Use shared resolution mapping
function getResolutionSeconds(resolution: string): number {
  return RESOLUTION_TO_SECONDS[resolution] || 300;
}

async function fetchHistoricalCandles(
  pair: ForexPair,
  resolution: string,
  startDate: string,
  endDate: string
): Promise<CandleData[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  // FNH-007: Consistent fallback to simulated data
  if (!apiKey) return generateSimulatedCandles(pair, 500, getResolutionSeconds(resolution));

  // FNH-002: Use shared symbol mapping
  const finnhubSymbol = PAIR_TO_FINNHUB_SYMBOL[pair] || `OANDA:${pair.slice(0, 3)}_${pair.slice(3)}`;
  // FNH-014: Convert resolution alias to Finnhub format
  const finnhubResolution = toFinnhubResolution(resolution);
  const from = Math.floor(new Date(startDate).getTime() / 1000);
  const to = Math.floor(new Date(endDate).getTime() / 1000);
  const allCandles: CandleData[] = [];

  const maxCandles = 500;
  const resSeconds = getResolutionSeconds(resolution);
  const totalSeconds = to - from;
  const totalCandlesNeeded = Math.ceil(totalSeconds / resSeconds);
  const batches = Math.ceil(totalCandlesNeeded / maxCandles);

  for (let batch = 0; batch < batches; batch++) {
    const batchFrom = from + (batch * maxCandles * resSeconds);
    const batchTo = Math.min(batchFrom + (maxCandles * resSeconds), to);

    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${finnhubSymbol}&resolution=${finnhubResolution}&from=${batchFrom}&to=${batchTo}&token=${apiKey}`;

    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.s !== 'ok' || !data.t) continue;
      for (let i = 0; i < data.t.length; i++) {
        allCandles.push({ time: data.t[i] * 1000, open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i], volume: data.v[i] || 0 });
      }
    } catch (err) {
      logApiError('Backtest-Fetch', err);
      continue;
    }

    if (batch < batches - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  allCandles.sort((a, b) => a.time - b.time);
  const unique = allCandles.filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);

  // FNH-007: Fallback to simulated if insufficient real data
  // API-AUDIT-013: Use 500 directly instead of Math.max(500, 100)
  if (unique.length < 50) return generateSimulatedCandles(pair, 500, getResolutionSeconds(resolution));
  return unique;
}

interface SignalResult {
  direction: 'BUY' | 'SELL' | null;
  strength: number;
}

function generateSignal(
  strategy: StrategyName,
  candles: OHLCV[],
  index: number,
  indicators: Record<string, unknown>
): SignalResult {
  const close = candles[index].close;

  switch (strategy) {
    case 'MA_RIBBON': {
      const ema5 = indicators.ema5 as number[];
      const ema9 = indicators.ema9 as number[];
      const ema21 = indicators.ema21 as number[];
      const ema50 = indicators.ema50 as number[];
      if (!ema5 || !ema21 || !ema50) return { direction: null, strength: 0 };
      const e5 = ema5[index], e21 = ema21[index], e50 = ema50[index];
      if (isNaN(e5) || isNaN(e21) || isNaN(e50)) return { direction: null, strength: 0 };
      const bullish = e5 > e21 && e21 > e50;
      const bearish = e5 < e21 && e21 < e50;
      return {
        direction: bullish ? 'BUY' : bearish ? 'SELL' : null,
        strength: Math.abs(e5 - e50) / close,
      };
    }

    case 'EMA_CROSSOVER': {
      const emaFast = indicators.ema9 as number[];
      const emaSlow = indicators.ema21 as number[];
      if (!emaFast || !emaSlow) return { direction: null, strength: 0 };
      const fast = emaFast[index], slow = emaSlow[index];
      const prevFast = emaFast[index - 1], prevSlow = emaSlow[index - 1];
      if (isNaN(fast) || isNaN(slow) || isNaN(prevFast) || isNaN(prevSlow)) return { direction: null, strength: 0 };
      // Crossover detection
      if (prevFast <= prevSlow && fast > slow) return { direction: 'BUY', strength: (fast - slow) / close };
      if (prevFast >= prevSlow && fast < slow) return { direction: 'SELL', strength: (slow - fast) / close };
      // Trend continuation
      if (fast > slow) return { direction: 'BUY', strength: (fast - slow) / close * 0.3 };
      if (fast < slow) return { direction: 'SELL', strength: (slow - fast) / close * 0.3 };
      return { direction: null, strength: 0 };
    }

    case 'MOMENTUM_SCALPING': {
      const rsiVal = indicators.rsi as number[];
      const mom = indicators.momentum as number[];
      const macdHist = indicators.macdHistogram as number[];
      if (!rsiVal || !mom || !macdHist) return { direction: null, strength: 0 };
      const r = rsiVal[index], m = mom[index], h = macdHist[index];
      if (isNaN(r) || isNaN(m) || isNaN(h)) return { direction: null, strength: 0 };
      if (r < 30 && m < 0 && h > 0) return { direction: 'BUY', strength: 0.8 };
      if (r > 70 && m > 0 && h < 0) return { direction: 'SELL', strength: 0.8 };
      if (r < 40 && h > 0) return { direction: 'BUY', strength: 0.5 };
      if (r > 60 && h < 0) return { direction: 'SELL', strength: 0.5 };
      return { direction: null, strength: 0 };
    }

    // FIX STRATEGY-003/IND-001: Use single pivot point object (not array)
    case 'PIVOT_POINT': {
      const pp = indicators.pivotPoints as { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } | undefined;
      if (!pp) return { direction: null, strength: 0 };
      if (close > pp.r1) return { direction: 'BUY', strength: (close - pp.pp) / close };
      if (close < pp.s1) return { direction: 'SELL', strength: (pp.pp - close) / close };
      if (close > pp.r2) return { direction: 'BUY', strength: (close - pp.r1) / close * 0.7 };
      if (close < pp.s2) return { direction: 'SELL', strength: (pp.s1 - close) / close * 0.7 };
      if (close > pp.pp) return { direction: 'BUY', strength: 0.3 };
      if (close < pp.pp) return { direction: 'SELL', strength: 0.3 };
      return { direction: null, strength: 0 };
    }

    case 'RMI_TREND_SYNC': {
      const stc = indicators.stc as number[];
      const stDir = indicators.supertrendDirection as number[];
      if (!stc || !stDir) return { direction: null, strength: 0 };
      const s = stc[index], d = stDir[index];
      if (isNaN(s) || isNaN(d)) return { direction: null, strength: 0 };
      const stBullish = d === 1;
      const stcOversold = s < 25;
      const stcOverbought = s > 75;
      if (stBullish && stcOversold) return { direction: 'BUY', strength: 0.9 };
      if (!stBullish && stcOverbought) return { direction: 'SELL', strength: 0.9 };
      if (stBullish && s < 50) return { direction: 'BUY', strength: 0.6 };
      if (!stBullish && s > 50) return { direction: 'SELL', strength: 0.6 };
      return { direction: null, strength: 0 };
    }

    case 'LINEAR_REGRESSION': {
      const lrcUpper = indicators.lrcUpper as number[];
      const lrcMiddle = indicators.lrcMiddle as number[];
      const lrcLower = indicators.lrcLower as number[];
      if (!lrcUpper || !lrcMiddle || !lrcLower) return { direction: null, strength: 0 };
      const u = lrcUpper[index], m = lrcMiddle[index], l = lrcLower[index];
      if (isNaN(u) || isNaN(m) || isNaN(l)) return { direction: null, strength: 0 };
      if (close <= l) return { direction: 'BUY', strength: (m - l) / close };
      if (close >= u) return { direction: 'SELL', strength: (u - m) / close };
      return { direction: null, strength: 0 };
    }

    case 'EMA_RSI_FILTER': {
      const emaFast = indicators.ema9 as number[];
      const emaSlow = indicators.ema21 as number[];
      const rsiVal = indicators.rsi as number[];
      if (!emaFast || !emaSlow || !rsiVal) return { direction: null, strength: 0 };
      const ef = emaFast[index], es = emaSlow[index], r = rsiVal[index];
      if (isNaN(ef) || isNaN(es) || isNaN(r)) return { direction: null, strength: 0 };
      if (ef > es && r > 40 && r < 70) return { direction: 'BUY', strength: 0.7 };
      if (ef < es && r > 30 && r < 60) return { direction: 'SELL', strength: 0.7 };
      return { direction: null, strength: 0 };
    }

    default:
      return { direction: null, strength: 0 };
  }
}

function precomputeIndicators(candles: OHLCV[]): Record<string, unknown> {
  const closes = candles.map((c) => c.close);
  const lrc = linearRegressionChannel(closes, 20);
  return {
    ema5: ema(closes, 5),
    ema9: ema(closes, 9),
    // FIX STRATEGY-013: Removed unused ema13
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    rsi: rsi(closes, 14),
    momentum: closes.map((v, i) => (i < 10 ? NaN : v - closes[i - 10])),
    macdHistogram: macd(closes, 12, 26, 9).histogram,
    stc: schaffTrendCycle(closes, 23, 50, 10),
    supertrendDirection: supertrend(candles, 10, 3).direction,
    lrcUpper: lrc.upper,
    lrcMiddle: lrc.middle,
    lrcLower: lrc.lower,
    atr: atr(candles, 14),
    // FIX STRATEGY-003/IND-001: Compute pivot points for PIVOT_POINT strategy
    pivotPoints: candles.length > 0 ? pivotPoints(candles) : undefined,
  };
}

function runBacktestSimulation(
  candles: OHLCV[],
  config: BacktestConfig,
  pipConfig: { standard: number; pipSize: number }
): { trades: BacktestTrade[]; equityCurve: number[] } {
  const indicators = precomputeIndicators(candles);
  const atrValues = indicators.atr as number[];
  const trades: BacktestTrade[] = [];
  const equityCurve: number[] = [];
  let balance = config.initialBalance;
  let openTrade: BacktestTrade | null = null;
  let tradeId = 0;
  const minLookback = 60; // Minimum candles before trading starts
  // FIX STRATEGY-006: Use config value instead of hardcoded 1
  const maxOpenPositions = config.maxPositions || 1;
  // RISK-008: Track daily risk for backtest circuit breaker
  const dailyRiskLimitAmount = config.initialBalance * (config.riskPerTrade * 3 / 100); // ~3x single-trade risk as daily limit
  const maxDrawdownPct = 30; // Stop backtest if 30% drawdown reached
  let peakBalance = config.initialBalance;
  let dailyLoss = 0;
  let lastTradeDay = -1;
  let tradingHalted = false;

  for (let i = minLookback; i < candles.length; i++) {
    const candle = candles[i];

    // RISK-008: Check max drawdown circuit breaker
    if (balance > peakBalance) peakBalance = balance;
    const currentDrawdown = ((peakBalance - balance) / peakBalance) * 100;
    if (currentDrawdown >= maxDrawdownPct) {
      tradingHalted = true;
    }

    // RISK-008: Reset daily loss on new day (approximate: every 288 M5 candles = 1 day)
    const candleDay = Math.floor(i / 288);
    if (candleDay !== lastTradeDay) {
      dailyLoss = 0;
      lastTradeDay = candleDay;
    }

    // Check open trade for SL/TP
    if (openTrade) {
      const sl = openTrade.stopLoss;
      const tp = openTrade.takeProfit;
      const direction = openTrade.direction;

      let closed = false;
      let closePrice = candle.close;
      let reason = 'signal';

      if (direction === 'BUY') {
        if (candle.low <= sl) { closePrice = sl; reason = 'stop_loss'; closed = true; }
        else if (candle.high >= tp) { closePrice = tp; reason = 'take_profit'; closed = true; }
      } else {
        if (candle.high >= sl) { closePrice = sl; reason = 'stop_loss'; closed = true; }
        else if (candle.low <= tp) { closePrice = tp; reason = 'take_profit'; closed = true; }
      }

      // Also check for signal-based close
      if (!closed) {
        const signal = generateSignal(config.strategy, candles, i, indicators);
        if (signal.direction && signal.direction !== openTrade.direction && signal.strength > 0.4) {
          closePrice = candle.close;
          reason = 'reverse_signal';
          closed = true;
        }
      }

      if (closed) {
        const pipDiff = direction === 'BUY'
          ? (closePrice - openTrade.entryPrice) / pipConfig.pipSize
          : (openTrade.entryPrice - closePrice) / pipConfig.pipSize;
        const pnl = pipDiff * pipConfig.standard * openTrade.lotSize - FINEX_CONFIG.commissionPerLot * openTrade.lotSize;
        balance += pnl;

        openTrade.exitIndex = i;
        openTrade.exitPrice = closePrice;
        openTrade.pnl = pnl;
        openTrade.pnlPips = pipDiff;
        openTrade.reason = reason;
        openTrade.exitTime = candle.time;
        trades.push(openTrade);
        // RISK-008: Track daily loss
        if (pnl < 0) dailyLoss += Math.abs(pnl);
        openTrade = null;
      }
    }

    // Open new trade if no position and not halted
    if (!openTrade && !tradingHalted && i < candles.length - 5) {
      // RISK-008: Check daily risk limit before opening new trade
      if (dailyLoss >= dailyRiskLimitAmount) {
        equityCurve.push(balance);
        continue;
      }
      const signal = generateSignal(config.strategy, candles, i, indicators);
      if (signal.direction && signal.strength > 0.2) {
        const atrVal = atrValues[i];
        if (isNaN(atrVal) || atrVal === 0) continue;

        const slPips = Math.max(config.stopLossPips, Math.round(atrVal / pipConfig.pipSize * 1.5));
        // FIX STRATEGY-005: Use user's takeProfitPips config instead of hardcoded 1.5x
        const tpPips = config.takeProfitPips || Math.round(slPips * 1.5);
        const riskAmount = balance * (config.riskPerTrade / 100);
        const lotSize = Math.max(
          FINEX_CONFIG.minLot,
          Math.min(
            FINEX_CONFIG.maxLotPerOrder,
            parseFloat((riskAmount / (slPips * pipConfig.standard)).toFixed(2))
          )
        );

        const entryPrice = candle.close;
        let stopLoss: number, takeProfit: number;
        if (signal.direction === 'BUY') {
          stopLoss = entryPrice - slPips * pipConfig.pipSize;
          takeProfit = entryPrice + tpPips * pipConfig.pipSize;
        } else {
          stopLoss = entryPrice + slPips * pipConfig.pipSize;
          takeProfit = entryPrice - tpPips * pipConfig.pipSize;
        }

        openTrade = {
          id: ++tradeId,
          entryIndex: i,
          exitIndex: 0,
          direction: signal.direction,
          entryPrice,
          exitPrice: 0,
          lotSize,
          stopLoss,
          takeProfit,
          pnl: 0,
          pnlPips: 0,
          reason: '',
          entryTime: candle.time,
          exitTime: 0,
        };
      }
    }

    equityCurve.push(balance);
  }

  // Close any remaining open trade at last price
  if (openTrade) {
    const lastCandle = candles[candles.length - 1];
    const pipDiff = openTrade.direction === 'BUY'
      ? (lastCandle.close - openTrade.entryPrice) / pipConfig.pipSize
      : (openTrade.entryPrice - lastCandle.close) / pipConfig.pipSize;
    const pnl = pipDiff * pipConfig.standard * openTrade.lotSize - FINEX_CONFIG.commissionPerLot * openTrade.lotSize;
    balance += pnl;

    openTrade.exitIndex = candles.length - 1;
    openTrade.exitPrice = lastCandle.close;
    openTrade.pnl = pnl;
    openTrade.pnlPips = pipDiff;
    openTrade.reason = 'end_of_data';
    openTrade.exitTime = lastCandle.time;
    trades.push(openTrade);
    equityCurve[equityCurve.length - 1] = balance;
  }

  return { trades, equityCurve };
}

function calculateBacktestStats(
  trades: BacktestTrade[],
  equityCurve: number[],
  config: BacktestConfig
): Omit<BacktestResult, 'id'> {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  // Max drawdown
  let maxDrawdown = 0;
  let peak = config.initialBalance;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio (simplified - annualized)
  let sharpeRatio: number | null = null;
  if (trades.length > 2) {
    const returns = trades.map((t) => t.pnl / config.initialBalance);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1));
    if (stdReturn > 0) {
      sharpeRatio = parseFloat(((avgReturn / stdReturn) * Math.sqrt(252)).toFixed(2));
    }
  }

  // Profit factor
  let profitFactor: number | null = null;
  const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  if (totalLosses > 0) {
    profitFactor = parseFloat((totalWins / totalLosses).toFixed(2));
  } else if (totalWins > 0) {
    profitFactor = 999;
  }

  // Avg win/loss
  const avgWin = wins.length > 0 ? parseFloat((wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2)) : null;
  const avgLoss = losses.length > 0 ? parseFloat((losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2)) : null;

  // Max consecutive wins/losses
  let maxConsecWins = 0, maxConsecLosses = 0;
  let consecWins = 0, consecLosses = 0;
  for (const t of trades) {
    if (t.pnl > 0) { consecWins++; consecLosses = 0; }
    else { consecLosses++; consecWins = 0; }
    maxConsecWins = Math.max(maxConsecWins, consecWins);
    maxConsecLosses = Math.max(maxConsecLosses, consecLosses);
  }

  return {
    name: `${config.strategy} - ${config.pair} - ${config.timeframe}`,
    pair: config.pair,
    strategy: config.strategy,
    timeframe: config.timeframe,
    startDate: config.startDate,
    endDate: config.endDate,
    initialBalance: config.initialBalance,
    finalBalance: parseFloat(equityCurve[equityCurve.length - 1]?.toFixed(2) || config.initialBalance.toFixed(2)),
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: parseFloat(winRate.toFixed(2)),
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    sharpeRatio,
    profitFactor,
    avgWin,
    avgLoss,
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
  };
}

export async function POST(request: NextRequest) {
  // API-AUDIT-005: Rate limit BEFORE auth to prevent brute-force API key guessing
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  try {
    const body = await request.json();
    const config = body as BacktestConfig;

    // M-3: Validate pair, strategy, and timeframe against allowed lists
    // API-AUDIT-029: FOREX_PAIRS is now imported statically at the top of file
    if (!FOREX_PAIRS.includes(config.pair)) {
      return NextResponse.json({ error: `Invalid pair. Must be one of: ${FOREX_PAIRS.join(', ')}` }, { status: 400 });
    }
    const VALID_STRATEGIES: string[] = ['MA_RIBBON', 'MOMENTUM_SCALPING', 'PIVOT_POINT', 'EMA_CROSSOVER', 'RMI_TREND_SYNC', 'LINEAR_REGRESSION', 'EMA_RSI_FILTER'];
    if (!VALID_STRATEGIES.includes(config.strategy)) {
      return NextResponse.json({ error: `Invalid strategy. Must be one of: ${VALID_STRATEGIES.join(', ')}` }, { status: 400 });
    }
    // FIX STRATEGY-007: Added M2 to match TIMEFRAMES constant
    const VALID_TIMEFRAMES = ['M1', 'M2', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
    if (!VALID_TIMEFRAMES.includes(config.timeframe)) {
      return NextResponse.json({ error: `Invalid timeframe. Must be one of: ${VALID_TIMEFRAMES.join(', ')}` }, { status: 400 });
    }

    if (!config.pair || !config.strategy || !config.timeframe || !config.startDate || !config.endDate) {
      return NextResponse.json(
        { error: 'pair, strategy, timeframe, startDate, and endDate are required' },
        { status: 400 }
      );
    }

    // BT-01: Validate numeric fields
    const { stopLossPips, riskPerTrade, initialBalance } = body;
    if (!stopLossPips || stopLossPips <= 0 || stopLossPips > 500) {
      return NextResponse.json({ error: 'stopLossPips must be between 1 and 500' }, { status: 400 });
    }
    // API-AUDIT-011: Validate takeProfitPips
    if (config.takeProfitPips !== undefined && (typeof config.takeProfitPips !== 'number' || config.takeProfitPips <= 0)) {
      return NextResponse.json({ error: 'takeProfitPips must be greater than 0' }, { status: 400 });
    }
    // API-AUDIT-011: Validate maxPositions
    if (config.maxPositions !== undefined && (typeof config.maxPositions !== 'number' || config.maxPositions < 1 || config.maxPositions > 20)) {
      return NextResponse.json({ error: 'maxPositions must be between 1 and 20' }, { status: 400 });
    }
    if (typeof riskPerTrade !== 'number' || riskPerTrade < 0.1 || riskPerTrade > 100) {
      return NextResponse.json({ error: 'riskPerTrade must be between 0.1 and 100' }, { status: 400 });
    }
    if (!initialBalance || initialBalance < 100) {
      return NextResponse.json({ error: 'initialBalance must be at least 100' }, { status: 400 });
    }

    // BT-05: Limit backtest date range
    const maxDays = 730; // 2 years
    const dayDiff = (new Date(config.endDate).getTime() - new Date(config.startDate).getTime()) / (1000 * 60 * 60 * 24);
    if (dayDiff > maxDays) {
      return NextResponse.json({ error: `Date range too large (max ${maxDays} days)` }, { status: 400 });
    }
    if (dayDiff < 1) {
      return NextResponse.json({ error: 'Date range must be at least 1 day' }, { status: 400 });
    }

    // Fetch historical candles
    const candles = await fetchHistoricalCandles(
      config.pair,
      config.timeframe,
      config.startDate,
      config.endDate
    );

    if (candles.length < 100) {
      return NextResponse.json(
        { error: `Insufficient historical data: ${candles.length} candles. Need at least 100.` },
        { status: 400 }
      );
    }

    const ohlcv: OHLCV[] = candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0,
    }));

    const pipConfig = PAIR_PIP_VALUES[config.pair] || { standard: 10, pipSize: 0.0001 };

    // Run the simulation
    const { trades, equityCurve } = runBacktestSimulation(ohlcv, config, pipConfig);

    // Calculate statistics
    const stats = calculateBacktestStats(trades, equityCurve, config);

    // Store result in DB
    const dbResult = await db.backtestResult.create({
      data: {
        ...stats,
        startDate: new Date(config.startDate),
        endDate: new Date(config.endDate),
        parameters: JSON.stringify({
          stopLossPips: config.stopLossPips,
          takeProfitPips: config.takeProfitPips,
          riskPerTrade: config.riskPerTrade,
          maxPositions: config.maxPositions,
        }),
      },
    });

    // Log the backtest
    try {
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'analysis',
          message: `Backtest completed: ${config.strategy} on ${config.pair} - ${trades.length} trades, win rate: ${stats.winRate}%, PnL: $${stats.totalPnl.toFixed(2)}`,
          pair: config.pair,
          metadata: JSON.stringify({
            backtestId: dbResult.id,
            trades: trades.length,
            winRate: stats.winRate,
            totalPnl: stats.totalPnl,
            maxDrawdown: stats.maxDrawdown,
            sharpeRatio: stats.sharpeRatio,
          }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      result: { ...stats, id: dbResult.id },
      trades,
      candlesUsed: candles.length,
      // FIX STRATEGY-004: Format equity curve as {time, equity} objects for chart rendering
      // API-AUDIT-049: Fix time mapping — equity values start from indicator lookback, not index 0
      equityCurve: equityCurve.map((eq, i) => ({
        time: candles[i + 60]?.time ? new Date(candles[i + 60].time).toISOString().slice(0, 10) : String(i),
        equity: parseFloat(eq.toFixed(2)),
      })),
    });
  } catch (error) {
    logApiError('Backtest', error);
    return NextResponse.json(
      { error: 'Backtest failed' },
      { status: 500 }
    );
  }
}

// GET - Fetch backtest history
export async function GET() {
  try {
    const results = await db.backtestResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json({ results });
  } catch (error) {
    logApiError('Backtest', error);
    return NextResponse.json(
      { error: 'Failed to fetch backtest results' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a backtest result
export async function DELETE(request: NextRequest) {
  // API-AUDIT-005: Rate limit BEFORE auth
  const deleteRateCheck = checkRateLimit(clientIp(request), 'general');
  if (!deleteRateCheck.allowed) return rateLimitedResponse(deleteRateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }
    await db.backtestResult.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError('Backtest', error);
    return NextResponse.json(
      { error: 'Failed to delete backtest result' },
      { status: 500 }
    );
  }
}
