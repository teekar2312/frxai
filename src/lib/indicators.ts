// Technical Indicator Calculations for Forex Trading
// All 30+ indicators from the pool, optimized for scalping

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ==================== MOVING AVERAGES ====================

export function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

export function ema(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    if (i === period - 1) {
      const slice = data.slice(0, period);
      prev = slice.reduce((a, b) => a + b, 0) / period;
      result.push(prev);
      continue;
    }
    prev = (data[i] - prev) * multiplier + prev;
    result.push(prev);
  }
  return result;
}

export function hma(data: number[], period: number): number[] {
  const halfPeriod = Math.floor(period / 2);
  const sqrtPeriod = Math.floor(Math.sqrt(period));
  const wma1 = wma(data, halfPeriod);
  const wma2 = wma(data, period);
  const diff = wma1.map((v, i) => (2 * v) - (wma2[i] || 0));
  return wma(diff, sqrtPeriod);
}

export function wma(data: number[], period: number): number[] {
  const result: number[] = [];
  const denom = (period * (period + 1)) / 2;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - period + 1 + j] * (j + 1);
    }
    result.push(sum / denom);
  }
  return result;
}

export function vwap(candles: OHLCV[]): number[] {
  const result: number[] = [];
  let cumTPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.volume;
    cumVol += c.volume;
    result.push(cumVol > 0 ? cumTPV / cumVol : tp);
  }
  return result;
}

// ==================== OSCILLATORS ====================

export function rsi(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  let smoothGain = 0;
  let smoothLoss = 0;

  for (let i = 0; i < gains.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    if (i === period - 1) {
      // Seed: simple average of first `period` values
      smoothGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
      smoothLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      // Wilder's EMA smoothing
      smoothGain = (smoothGain * (period - 1) + gains[i]) / period;
      smoothLoss = (smoothLoss * (period - 1) + losses[i]) / period;
    }
    if (smoothLoss === 0) { result.push(100); continue; }
    const rs = smoothGain / smoothLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return [NaN, ...result];
}

export function stochastic(candles: OHLCV[], kPeriod: number = 14, dPeriod: number = 3): { k: number[]; d: number[] } {
  const kValues: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) { kValues.push(NaN); continue; }
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...slice.map(c => c.high));
    const lowest = Math.min(...slice.map(c => c.low));
    const range = highest - lowest;
    kValues.push(range === 0 ? 50 : ((candles[i].close - lowest) / range) * 100);
  }
  const dValues = sma(kValues.filter(v => !isNaN(v)), dPeriod);
  const dPadded: number[] = [];
  let dIdx = 0;
  for (let i = 0; i < kValues.length; i++) {
    if (isNaN(kValues[i])) { dPadded.push(NaN); }
    else if (dIdx < dValues.length) { dPadded.push(dValues[dIdx++]); }
    else { dPadded.push(NaN); }
  }
  return { k: kValues, d: dPadded };
}

export function macd(data: number[], fast: number = 12, slow: number = 26, signal: number = 9): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = ema(data, fast);
  const emaSlow = ema(data, slow);
  const macdLine = emaFast.map((v, i) => (isNaN(v) || isNaN(emaSlow[i])) ? NaN : v - emaSlow[i]);
  const validMacd = macdLine.filter(v => !isNaN(v)) as number[];
  const signalLine = ema(validMacd, signal);
  const histogram: number[] = [];
  let sIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i])) { histogram.push(NaN); continue; }
    const s = signalLine[sIdx] ?? NaN;
    histogram.push(isNaN(s) ? NaN : macdLine[i]! - s);
    sIdx++;
  }
  return { macd: macdLine, signal: signalLine, histogram };
}

export function williamsR(candles: OHLCV[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const slice = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...slice.map(c => c.high));
    const lowest = Math.min(...slice.map(c => c.low));
    const range = highest - lowest;
    result.push(range === 0 ? -50 : ((highest - candles[i].close) / range) * -100);
  }
  return result;
}

export function cci(candles: OHLCV[], period: number = 20): number[] {
  const tps = candles.map(c => (c.high + c.low + c.close) / 3);
  const smaTps = sma(tps, period);
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const slice = tps.slice(i - period + 1, i + 1);
    const mean = smaTps[i]!;
    const meanDev = slice.reduce((a, v) => a + Math.abs(v - mean), 0) / period;
    result.push(meanDev === 0 ? 0 : (tps[i] - mean) / (0.015 * meanDev));
  }
  return result;
}

export function mfi(candles: OHLCV[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let positiveFlow = 0;
    let negativeFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
      const mf = tp * candles[j].volume;
      const prevTp = j > 0 ? (candles[j - 1].high + candles[j - 1].low + candles[j - 1].close) / 3 : tp;
      if (tp > prevTp) positiveFlow += mf;
      else negativeFlow += mf;
    }
    result.push(negativeFlow === 0 ? 100 : 100 - 100 / (1 + positiveFlow / negativeFlow));
  }
  return result;
}

export function tsi(data: number[], longPeriod: number = 25, shortPeriod: number = 13): number[] {
  const momentum = data.map((v, i) => i === 0 ? 0 : v - data[i - 1]);
  const absMomentum = momentum.map(Math.abs);
  const ema1 = ema(momentum, longPeriod);
  const ema2 = ema(absMomentum, longPeriod);
  const validEma1 = ema1.filter(v => !isNaN(v)) as number[];
  const validEma2 = ema2.filter(v => !isNaN(v)) as number[];
  const doubleEma1 = ema(validEma1, shortPeriod);
  const doubleEma2 = ema(validEma2, shortPeriod);
  const result: number[] = [];
  let idx = 0;
  for (let i = 0; i < data.length; i++) {
    if (isNaN(ema1[i])) { result.push(NaN); continue; }
    if (idx < doubleEma1.length && idx < doubleEma2.length) {
      const denom = doubleEma2[idx];
      result.push(denom === 0 ? 0 : (doubleEma1[idx]! / denom) * 100);
      idx++;
    } else { result.push(NaN); }
  }
  return result;
}

export function roc(data: number[], period: number = 12): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    result.push(((data[i] - data[i - period]) / data[i - period]) * 100);
  }
  return result;
}

export function momentum(data: number[], period: number = 10): number[] {
  return data.map((v, i) => (i < period ? NaN : v - data[i - period]));
}

export function ultimateOscillator(candles: OHLCV[], p1: number = 7, p2: number = 14, p3: number = 28): number[] {
  const result: number[] = [];
  const bp: number[] = [];
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const trueLow = Math.min(candles[i].low, i > 0 ? candles[i - 1].close : candles[i].low);
    const trueHigh = Math.max(candles[i].high, i > 0 ? candles[i - 1].close : candles[i].high);
    bp.push(candles[i].close - trueLow);
    tr.push(trueHigh - trueLow);
  }
  for (let i = 0; i < candles.length; i++) {
    if (i < p3 - 1) { result.push(NaN); continue; }
    const avgBP1 = bp.slice(i - p1 + 1, i + 1).reduce((a, b) => a + b, 0);
    const avgTR1 = tr.slice(i - p1 + 1, i + 1).reduce((a, b) => a + b, 0);
    const avgBP2 = bp.slice(i - p2 + 1, i + 1).reduce((a, b) => a + b, 0);
    const avgTR2 = tr.slice(i - p2 + 1, i + 1).reduce((a, b) => a + b, 0);
    const avgBP3 = bp.slice(i - p3 + 1, i + 1).reduce((a, b) => a + b, 0);
    const avgTR3 = tr.slice(i - p3 + 1, i + 1).reduce((a, b) => a + b, 0);
    const raw = (4 * (avgBP1 / (avgTR1 || 1)) + 2 * (avgBP2 / (avgTR2 || 1)) + (avgBP3 / (avgTR3 || 1))) / 7 * 100;
    result.push(Math.min(100, Math.max(0, raw)));
  }
  return result;
}

// ==================== VOLATILITY ====================

export function atr(candles: OHLCV[], period: number = 14): number[] {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { trs.push(candles[i].high - candles[i].low); continue; }
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trs.push(tr);
  }
  return ema(trs, period);
}

export function bollingerBands(data: number[], period: number = 20, stdDev: number = 2): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = sma(data, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (isNaN(middle[i])) { upper.push(NaN); lower.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = middle[i]!;
    const std = Math.sqrt(slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period);
    upper.push(mean + stdDev * std);
    lower.push(mean - stdDev * std);
  }
  return { upper, middle, lower };
}

export function keltnerChannel(emaData: number[], atrValues: number[], emaPeriod: number = 20, multiplier: number = 1.5): { upper: number[]; middle: number[]; lower: number[] } {
  return {
    upper: emaData.map((v, i) => isNaN(v) || isNaN(atrValues[i]) ? NaN : v + multiplier * atrValues[i]!),
    middle: emaData,
    lower: emaData.map((v, i) => isNaN(v) || isNaN(atrValues[i]) ? NaN : v - multiplier * atrValues[i]!),
  };
}

export function donchianChannel(candles: OHLCV[], period: number = 20): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const lower: number[] = [];
  const middle: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); middle.push(NaN); continue; }
    const slice = candles.slice(i - period + 1, i + 1);
    const h = Math.max(...slice.map(c => c.high));
    const l = Math.min(...slice.map(c => c.low));
    upper.push(h);
    lower.push(l);
    middle.push((h + l) / 2);
  }
  return { upper, middle, lower };
}

export function standardDeviation(data: number[], period: number = 20): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period);
    result.push(std);
  }
  return result;
}

export function chaikinVolatility(candles: OHLCV[], emaPeriod: number = 10, rocPeriod: number = 10): number[] {
  const hlRanges = candles.map(c => c.high - c.low);
  const emaValues = ema(hlRanges, emaPeriod);
  return emaValues.map((v, i) => {
    if (isNaN(v) || i < rocPeriod) return NaN;
    const prev = emaValues[i - rocPeriod];
    return isNaN(prev) || prev === 0 ? 0 : ((v - prev) / prev) * 100;
  });
}

export function volatilityRatio(candles: OHLCV[], shortPeriod: number = 5, longPeriod: number = 20): number[] {
  const stdShort = standardDeviation(candles.map(c => c.close), shortPeriod);
  const stdLong = standardDeviation(candles.map(c => c.close), longPeriod);
  return stdShort.map((v, i) => {
    if (isNaN(v) || isNaN(stdLong[i]) || stdLong[i] === 0) return NaN;
    return v / stdLong[i]!;
  });
}

// ==================== TREND ====================

export function supertrend(candles: OHLCV[], period: number = 10, multiplier: number = 3): { upperBand: number[]; lowerBand: number[]; direction: number[] } {
  const atrValues = atr(candles, period);
  const upperBand: number[] = [];
  const lowerBand: number[] = [];
  const direction: number[] = [];
  let prevUpper = NaN;
  let prevLower = NaN;
  let prevDir = 1;

  for (let i = 0; i < candles.length; i++) {
    if (isNaN(atrValues[i])) { upperBand.push(NaN); lowerBand.push(NaN); direction.push(1); continue; }
    const hl2 = (candles[i].high + candles[i].low) / 2;
    let upper = hl2 + multiplier * atrValues[i]!;
    let lower = hl2 - multiplier * atrValues[i]!;
    if (!isNaN(prevLower) && lower > prevLower) lower = prevLower;
    if (!isNaN(prevUpper) && upper < prevUpper) upper = prevUpper;
    let dir: number;
    if (prevDir === 1 && candles[i].close < prevLower) dir = -1;
    else if (prevDir === -1 && candles[i].close > prevUpper) dir = 1;
    else dir = prevDir;
    upperBand.push(dir === 1 ? upper : NaN);
    lowerBand.push(dir === -1 ? lower : NaN);
    direction.push(dir);
    prevUpper = upper;
    prevLower = lower;
    prevDir = dir;
  }
  return { upperBand, lowerBand, direction };
}

export function parabolicSAR(candles: OHLCV[], step: number = 0.02, max: number = 0.2): number[] {
  const result: number[] = [];
  if (candles.length === 0) return result;
  let isLong = true;
  let af = step;
  let ep = candles[0].high;
  let sar = candles[0].low;

  result.push(sar);
  for (let i = 1; i < candles.length; i++) {
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);
    if (isLong) {
      sar = Math.min(sar, i >= 2 ? Math.min(candles[i - 1].low, candles[i - 2].low) : candles[i - 1].low);
      if (candles[i].low < sar) {
        isLong = false;
        sar = ep;
        ep = candles[i].low;
        af = step;
      } else {
        if (candles[i].high > ep) { ep = candles[i].high; af = Math.min(af + step, max); }
      }
    } else {
      sar = Math.max(sar, i >= 2 ? Math.max(candles[i - 1].high, candles[i - 2].high) : candles[i - 1].high);
      if (candles[i].high > sar) {
        isLong = true;
        sar = ep;
        ep = candles[i].high;
        af = step;
      } else {
        if (candles[i].low < ep) { ep = candles[i].low; af = Math.min(af + step, max); }
      }
    }
    result.push(sar);
  }
  return result;
}

export function ichimoku(candles: OHLCV[], tenkan: number = 9, kijun: number = 26, senkou: number = 52): {
  tenkanSen: number[]; kijunSen: number[]; senkouA: number[]; senkouB: number[]; chikou: number[];
} {
  const midHL = (c: OHLCV[], start: number, period: number) => {
    const slice = c.slice(Math.max(0, start), start + period);
    return (Math.max(...slice.map(s => s.high)) + Math.min(...slice.map(s => s.low))) / 2;
  };
  const tenkanSen = candles.map((_, i) => i >= tenkan - 1 ? midHL(candles, i - tenkan + 1, tenkan) : NaN);
  const kijunSen = candles.map((_, i) => i >= kijun - 1 ? midHL(candles, i - kijun + 1, kijun) : NaN);
  const senkouA = candles.map((_, i) => {
    if (isNaN(tenkanSen[i]) || isNaN(kijunSen[i])) return NaN;
    return (tenkanSen[i]! + kijunSen[i]!) / 2;
  });
  const senkouB = candles.map((_, i) => i >= senkou - 1 ? midHL(candles, i - senkou + 1, senkou) : NaN);
  const chikou = candles.map((c, i) => i + kijun < candles.length ? candles[i + kijun].close : NaN);
  return { tenkanSen, kijunSen, senkouA, senkouB, chikou };
}

// ==================== VOLUME ====================

export function obv(candles: OHLCV[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) result.push(result[i - 1] + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) result.push(result[i - 1] - candles[i].volume);
    else result.push(result[i - 1]);
  }
  return result;
}

export function accumulationDistribution(candles: OHLCV[]): number[] {
  const result: number[] = [0];
  for (let i = 0; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const c = candles[i].close;
    const range = h - l;
    if (range === 0) { result.push(result[i]); continue; }
    const mfm = ((c - l) - (h - c)) / range;
    const mfv = mfm * candles[i].volume;
    result.push((result[i] || 0) + mfv);
  }
  return result.slice(1);
}

// ==================== LINEAR REGRESSION ====================

export function linearRegressionChannel(data: number[], period: number = 20): { upper: number[]; middle: number[]; lower: number[] } {
  const middle: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { middle.push(NaN); upper.push(NaN); lower.push(NaN); continue; }
    const y = data.slice(i - period + 1, i + 1);
    const n = period;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let j = 0; j < n; j++) {
      sumX += j; sumY += y[j]; sumXY += j * y[j]; sumXX += j * j;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const predicted = slope * (n - 1) + intercept;
    let sumSqErr = 0;
    for (let j = 0; j < n; j++) {
      const pred = slope * j + intercept;
      sumSqErr += (y[j] - pred) ** 2;
    }
    const stdErr = Math.sqrt(sumSqErr / (n - 2));
    middle.push(predicted);
    upper.push(predicted + 2 * stdErr);
    lower.push(predicted - 2 * stdErr);
  }
  return { upper, middle, lower };
}

// ==================== SCHAFF TREND CYCLE ====================

export function schaffTrendCycle(data: number[], fastPeriod: number = 23, slowPeriod: number = 50, cyclePeriod: number = 10): number[] {
  const emaFast = ema(data, fastPeriod);
  const emaSlow = ema(data, slowPeriod);
  const macdVals = emaFast.map((v, i) => (isNaN(v) || isNaN(emaSlow[i])) ? NaN : v - emaSlow[i]!);
  const validMacd = macdVals.filter(v => !isNaN(v)) as number[];
  const minMacd = Math.min(...validMacd);
  const maxMacd = Math.max(...validMacd);
  const range = maxMacd - minMacd;
  const normalized = macdVals.map(v => isNaN(v) ? NaN : range === 0 ? 0.5 : (v - minMacd) / range);
  const validNorm = normalized.filter(v => !isNaN(v)) as number[];
  const stc1 = ema(validNorm, cyclePeriod);
  const stc2 = ema(stc1.filter(v => !isNaN(v)) as number[], cyclePeriod);
  const result: number[] = [];
  let idx = 0;
  for (let i = 0; i < data.length; i++) {
    if (isNaN(normalized[i])) { result.push(NaN); continue; }
    if (idx < stc2.length && !isNaN(stc2[idx])) { result.push(stc2[idx]! * 100); idx++; }
    else { result.push(NaN); }
  }
  return result;
}

// ==================== VOLUME PROFILE (simplified) ====================

export function volumeProfile(candles: OHLCV[], bins: number = 24): { price: number; volume: number; buyVol: number; sellVol: number }[] {
  if (!candles || candles.length === 0) return [];
  const allPrices = candles.flatMap(c => [c.high, c.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const binSize = (maxPrice - minPrice) / bins;
  if (binSize === 0) return [{ price: minPrice, volume: 0, buyVol: 0, sellVol: 0 }];
  const profile: { price: number; volume: number; buyVol: number; sellVol: number }[] = [];
  for (let i = 0; i < bins; i++) {
    const price = minPrice + (i + 0.5) * binSize;
    profile.push({ price, volume: 0, buyVol: 0, sellVol: 0 });
  }
  for (const c of candles) {
    const binIdx = Math.min(Math.floor((c.close - minPrice) / binSize), bins - 1);
    const clampedIdx = Math.max(0, binIdx);
    profile[clampedIdx].volume += c.volume;
    if (c.close >= c.open) profile[clampedIdx].buyVol += c.volume;
    else profile[clampedIdx].sellVol += c.volume;
  }
  return profile;
}

// ==================== MARKET CONDITION DETECTION ====================

export function detectMarketCondition(candles: OHLCV[]): 'trending' | 'range_bound' | 'high_volatility' | 'low_volatility' {
  if (candles.length < 30) return 'range_bound';
  const closes = candles.map(c => c.close);
  const atrVals = atr(candles, 14);
  const bb = bollingerBands(closes, 20, 2);
  const recentAtr = atrVals.filter(v => !isNaN(v)).slice(-20);
  const avgAtr = recentAtr.reduce((a, b) => a + (b || 0), 0) / recentAtr.length;
  const recentBbWidth = bb.upper.slice(-20).map((v, i) => {
    const l = bb.lower[bb.lower.length - 20 + i];
    return v && l ? v - l : 0;
  });
  const avgBbWidth = recentBbWidth.reduce((a, b) => a + b, 0) / recentBbWidth.length;
  const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const atrPct = (avgAtr / avgPrice) * 100;
  const bbWidthPct = (avgBbWidth / avgPrice) * 100;
  // Trend detection: ADX-like using linear regression slope
  const recent = closes.slice(-20);
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < recent.length; i++) {
    sumX += i; sumY += recent[i]; sumXY += i * recent[i]; sumXX += i * i;
  }
  const slope = (20 * sumXY - sumX * sumY) / (20 * sumXX - sumX * sumX);
  const slopePct = Math.abs((slope / avgPrice) * 100);
  const rSquared = (() => {
    const mean = sumY / 20;
    const ssTot = recent.reduce((s, y) => s + (y - mean) ** 2, 0);
    const ssRes = recent.reduce((s, y, i) => s + (y - (slope * i + (sumY - slope * sumX) / 20)) ** 2, 0);
    return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  })();
  if (atrPct > 0.3 || bbWidthPct > 1.5) return 'high_volatility';
  if (atrPct < 0.05 || bbWidthPct < 0.2) return 'low_volatility';
  if (slopePct > 0.02 && rSquared > 0.6) return 'trending';
  return 'range_bound';
}

// ==================== PIVOT POINTS ====================

export function pivotPoints(candles: OHLCV[]): { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } {
  const last = candles[candles.length - 1];
  const pp = (last.high + last.low + last.close) / 3;
  return {
    pp,
    r1: 2 * pp - last.low,
    r2: pp + (last.high - last.low),
    r3: last.high + 2 * (pp - last.low),
    s1: 2 * pp - last.high,
    s2: pp - (last.high - last.low),
    s3: last.low - 2 * (last.high - pp),
  };
}