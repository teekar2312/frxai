import { NextRequest, NextResponse } from 'next/server';
import type { CandleData, ForexPair } from '@/lib/trading-types';
import {
  sma, ema, hma, vwap,
  rsi, stochastic, macd, williamsR, cci, mfi, tsi, roc, momentum, ultimateOscillator,
  atr, bollingerBands, keltnerChannel, donchianChannel, standardDeviation, chaikinVolatility, volatilityRatio,
  supertrend, parabolicSAR, ichimoku,
  obv, accumulationDistribution,
  linearRegressionChannel, schaffTrendCycle, volumeProfile, pivotPoints,
} from '@/lib/indicators';
import type { OHLCV } from '@/lib/indicators';

function last<T>(arr: T[]): T | undefined {
  return arr.length > 0 ? arr[arr.length - 1] : undefined;
}

function safeLast(arr: number[]): number | null {
  const v = last(arr);
  return v !== undefined && !isNaN(v) ? v : null;
}

function determineSignal(value: number, thresholds: { oversold: number; overbought: number; mid: number }): 'bullish' | 'bearish' | 'neutral' {
  if (value <= thresholds.oversold) return 'bullish';
  if (value >= thresholds.overbought) return 'bearish';
  if (value > thresholds.mid) return 'bullish';
  return 'neutral';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pair, candles, timeframe } = body as {
      pair: ForexPair;
      candles: CandleData[];
      timeframe: string;
    };

    if (!pair || !candles || !Array.isArray(candles) || candles.length < 30) {
      return NextResponse.json(
        { error: 'Valid pair and at least 30 candles are required' },
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

    const closes = ohlcv.map((c) => c.close);

    // Moving Averages
    const ema5 = ema(closes, 5);
    const ema9 = ema(closes, 9);
    const ema13 = ema(closes, 13);
    const ema21 = ema(closes, 21);
    const ema50 = ema(closes, 50);
    const ema100 = ema(closes, 100);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const hma20 = hma(closes, 20);
    const vwapValues = vwap(ohlcv);

    // Oscillators
    const rsi14 = rsi(closes, 14);
    const stoch = stochastic(ohlcv, 14, 3);
    const macdResult = macd(closes, 12, 26, 9);
    const williams = williamsR(ohlcv, 14);
    const cci20 = cci(ohlcv, 20);
    const mfi14 = mfi(ohlcv, 14);
    const tsiVal = tsi(closes, 25, 13);
    const roc12 = roc(closes, 12);
    const mom10 = momentum(closes, 10);
    const ultOsc = ultimateOscillator(ohlcv, 7, 14, 28);

    // Volatility
    const atr14 = atr(ohlcv, 14);
    const bb = bollingerBands(closes, 20, 2);
    const keltnerEma = ema(closes, 20);
    const keltner = keltnerChannel(keltnerEma, atr14, 20, 1.5);
    const donchian = donchianChannel(ohlcv, 20);
    const stdDev = standardDeviation(closes, 20);
    const chaikinVol = chaikinVolatility(ohlcv, 10, 10);
    const volRatio = volatilityRatio(ohlcv, 5, 20);

    // Trend
    const stResult = supertrend(ohlcv, 10, 3);
    const psar = parabolicSAR(ohlcv);
    const ichi = ichimoku(ohlcv, 9, 26, 52);

    // Volume
    const obvVal = obv(ohlcv);
    const adVal = accumulationDistribution(ohlcv);

    // Special
    const stc = schaffTrendCycle(closes, 23, 50, 10);
    const lrc = linearRegressionChannel(closes, 20);
    const vp = volumeProfile(ohlcv, 24);
    const pivots = pivotPoints(ohlcv);

    // Tick volume (use volume as proxy)
    const tickVolume = ohlcv.map((c) => c.volume);
    const avgTickVolume = tickVolume.length > 0
      ? tickVolume.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, tickVolume.length)
      : 0;

    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes.length > 1 ? closes[closes.length - 2] : currentPrice;
    const priceChange = currentPrice - prevPrice;

    // Build comprehensive result
    const result: Record<string, unknown> = {
      pair,
      timeframe,
      timestamp: Date.now(),
      currentPrice,

      // Moving Averages
      ema: {
        ema5: safeLast(ema5),
        ema9: safeLast(ema9),
        ema13: safeLast(ema13),
        ema21: safeLast(ema21),
        ema50: safeLast(ema50),
        ema100: safeLast(ema100),
        signal: currentPrice > (safeLast(ema21) ?? 0) ? 'bullish' as const : 'bearish' as const,
      },
      sma: {
        sma20: safeLast(sma20),
        sma50: safeLast(sma50),
        sma200: safeLast(sma200),
      },
      hma: { value: safeLast(hma20) },
      vwap: { value: safeLast(vwapValues) },

      // Oscillators
      rsi: {
        value: safeLast(rsi14),
        signal: determineSignal(safeLast(rsi14) ?? 50, { oversold: 30, overbought: 70, mid: 50 }),
      },
      stochastic: {
        k: safeLast(stoch.k),
        d: safeLast(stoch.d),
        signal: (safeLast(stoch.k) ?? 50) < 20 ? 'bullish' as const
          : (safeLast(stoch.k) ?? 50) > 80 ? 'bearish' as const
          : 'neutral' as const,
      },
      macd: {
        line: safeLast(macdResult.macd),
        signal: safeLast(macdResult.signal),
        histogram: safeLast(macdResult.histogram),
        signal_direction: (safeLast(macdResult.histogram) ?? 0) > 0 ? 'bullish' as const : 'bearish' as const,
      },
      williamsR: {
        value: safeLast(williams),
        signal: (safeLast(williams) ?? -50) > -20 ? 'bearish' as const
          : (safeLast(williams) ?? -50) < -80 ? 'bullish' as const
          : 'neutral' as const,
      },
      cci: {
        value: safeLast(cci20),
        signal: (safeLast(cci20) ?? 0) < -100 ? 'bullish' as const
          : (safeLast(cci20) ?? 0) > 100 ? 'bearish' as const
          : 'neutral' as const,
      },
      mfi: {
        value: safeLast(mfi14),
        signal: determineSignal(safeLast(mfi14) ?? 50, { oversold: 20, overbought: 80, mid: 50 }),
      },
      tsi: {
        value: safeLast(tsiVal),
        signal: (safeLast(tsiVal) ?? 0) > 0 ? 'bullish' as const : 'bearish' as const,
      },
      roc: { value: safeLast(roc12) },
      momentum: { value: safeLast(mom10) },
      ultimateOscillator: {
        value: safeLast(ultOsc),
        signal: (safeLast(ultOsc) ?? 50) < 30 ? 'bullish' as const
          : (safeLast(ultOsc) ?? 50) > 70 ? 'bearish' as const
          : 'neutral' as const,
      },
      schaffTrendCycle: { value: safeLast(stc) },

      // Volatility
      atr: { value: safeLast(atr14) },
      bollingerBands: {
        upper: safeLast(bb.upper),
        middle: safeLast(bb.middle),
        lower: safeLast(bb.lower),
        width: safeLast(bb.upper) && safeLast(bb.lower)
          ? parseFloat((((safeLast(bb.upper) ?? 0) - (safeLast(bb.lower) ?? 0)) / currentPrice * 100).toFixed(4))
          : null,
        position: safeLast(bb.upper) && safeLast(bb.lower) && safeLast(bb.middle)
          ? parseFloat((((currentPrice - (safeLast(bb.lower) ?? 0)) / ((safeLast(bb.upper) ?? 0) - (safeLast(bb.lower) ?? 0)) * 100).toFixed(1)))
          : null,
      },
      keltnerChannel: {
        upper: safeLast(keltner.upper),
        middle: safeLast(keltner.middle),
        lower: safeLast(keltner.lower),
      },
      donchianChannel: {
        upper: safeLast(donchian.upper),
        middle: safeLast(donchian.middle),
        lower: safeLast(donchian.lower),
      },
      standardDeviation: { value: safeLast(stdDev) },
      chaikinVolatility: { value: safeLast(chaikinVol) },
      volatilityRatio: { value: safeLast(volRatio) },

      // Trend
      supertrend: {
        upperBand: safeLast(stResult.upperBand),
        lowerBand: safeLast(stResult.lowerBand),
        direction: safeLast(stResult.direction),
        signal: (safeLast(stResult.direction) ?? 1) === 1 ? 'bullish' as const : 'bearish' as const,
      },
      parabolicSAR: {
        value: safeLast(psar),
        signal: currentPrice > (safeLast(psar) ?? 0) ? 'bullish' as const : 'bearish' as const,
      },
      ichimoku: {
        tenkanSen: safeLast(ichi.tenkanSen),
        kijunSen: safeLast(ichi.kijunSen),
        senkouA: safeLast(ichi.senkouA),
        senkouB: safeLast(ichi.senkouB),
        chikou: safeLast(ichi.chikou),
        signal: currentPrice > (safeLast(ichi.senkouA) ?? 0) && currentPrice > (safeLast(ichi.senkouB) ?? 0)
          ? 'bullish' as const : 'bearish' as const,
      },

      // Volume
      obv: { value: safeLast(obvVal) },
      accumulationDistribution: { value: safeLast(adVal) },
      tickVolume: {
        current: tickVolume[tickVolume.length - 1] || 0,
        average20: parseFloat(avgTickVolume.toFixed(2)),
      },
      volumeProfile: {
        bins: vp,
        poc: vp.reduce((max, b) => b.volume > max.volume ? b : max, vp[0] || { price: 0, volume: 0, buyVol: 0, sellVol: 0 }),
      },

      // Pivot Points
      pivotPoints: pivots,

      // Linear Regression
      linearRegression: {
        upper: safeLast(lrc.upper),
        middle: safeLast(lrc.middle),
        lower: safeLast(lrc.lower),
        slope: safeLast(lrc.middle) && safeLast(lrc.middle) && lrc.middle.length > 1
          ? parseFloat(((lrc.middle[lrc.middle.length - 1] - (lrc.middle[lrc.middle.length - 2] || 0)).toFixed(8)))
          : null,
      },

      // Summary signals
      summary: {
        trendSignals: [
          (safeLast(stResult.direction) ?? 1) === 1 ? 'bullish' : 'bearish',
          currentPrice > (safeLast(psar) ?? 0) ? 'bullish' : 'bearish',
          currentPrice > (safeLast(ema21) ?? 0) ? 'bullish' : 'bearish',
          currentPrice > (safeLast(ema50) ?? 0) ? 'bullish' : 'bearish',
        ].filter((s, i, arr) => arr.indexOf(s) === i),
        oscillatorSignals: [
          (safeLast(rsi14) ?? 50) < 30 ? 'oversold' : (safeLast(rsi14) ?? 50) > 70 ? 'overbought' : 'neutral',
          (safeLast(stoch.k) ?? 50) < 20 ? 'oversold' : (safeLast(stoch.k) ?? 50) > 80 ? 'overbought' : 'neutral',
          (safeLast(macdResult.histogram) ?? 0) > 0 ? 'bullish' : 'bearish',
        ],
      },
    };

    return NextResponse.json({
      success: true,
      indicators: result,
      candleCount: candles.length,
    });
  } catch (error) {
    console.error('[Indicators API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
