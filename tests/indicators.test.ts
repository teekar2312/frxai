import { describe, it, expect } from 'vitest';
import { rsi, ema, macd, atr, bollingerBands, stochastic, detectMarketCondition } from '@/lib/indicators';
import type { OHLCV } from '@/lib/indicators';

function generateCandles(count: number, basePrice: number = 1.1): OHLCV[] {
  const candles: OHLCV[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 0.002;
    price += change;
    candles.push({
      time: Date.now() - (count - i) * 60000,
      open: price, high: price + Math.abs(change), low: price - Math.abs(change),
      close: price + change, volume: 1000,
    });
  }
  return candles;
}

describe('Technical Indicators', () => {
  it('RSI returns values between 0-100', () => {
    const data = Array.from({ length: 50 }, (_, _i) => 1.1 + Math.sin(_i / 5) * 0.01);
    const result = rsi(data, 14);
    const valid = result.filter(v => !isNaN(v));
    expect(valid.length).toBeGreaterThan(0);
    valid.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); });
  });

  it('EMA produces valid values', () => {
    const data = Array.from({ length: 50 }, (_, _i) => 1.1 + Math.random() * 0.01);
    const result = ema(data, 10);
    const valid = result.filter(v => !isNaN(v));
    expect(valid.length).toBeGreaterThan(0);
  });

  it('MACD returns macd, signal, and histogram', () => {
    const data = Array.from({ length: 100 }, (_, i) => 1.1 + Math.sin(i / 10) * 0.01);
    const result = macd(data);
    expect(result.macd).toBeDefined();
    expect(result.signal).toBeDefined();
    expect(result.histogram).toBeDefined();
    expect(result.macd.length).toBe(result.signal.length);
  });

  it('ATR returns positive values', () => {
    const candles = generateCandles(50);
    const result = atr(candles, 14);
    const valid = result.filter(v => !isNaN(v) && v !== null);
    valid.forEach(v => { expect(v).toBeGreaterThan(0); });
  });

  it('Bollinger Bands has upper > middle > lower', () => {
    const data = Array.from({ length: 50 }, (_, _i) => 1.1 + Math.random() * 0.005);
    const result = bollingerBands(data, 20, 2);
    const last = data.length - 1;
    const upperVal = result.upper[last];
    const middleVal = result.middle[last];
    const lowerVal = result.lower[last];
    if (upperVal != null && lowerVal != null && middleVal != null && !isNaN(upperVal) && !isNaN(lowerVal)) {
      expect(upperVal).toBeGreaterThan(middleVal);
      expect(middleVal).toBeGreaterThan(lowerVal);
    }
  });

  it('Stochastic returns K and D between 0-100', () => {
    const candles = generateCandles(50);
    const result = stochastic(candles, 14, 3);
    const validK = result.k.filter(v => !isNaN(v));
    validK.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); });
  });

  it('detectMarketCondition returns valid condition', () => {
    const candles = generateCandles(100);
    const result = detectMarketCondition(candles);
    expect(['trending', 'range_bound', 'high_volatility', 'low_volatility']).toContain(result);
  });

  it('detectMarketCondition handles small input', () => {
    const candles = generateCandles(5);
    const result = detectMarketCondition(candles);
    expect(result).toBe('range_bound');
  });
});
