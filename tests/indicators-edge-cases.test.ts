import { describe, it, expect } from 'vitest';
import { rsi, ema, macd, atr, bollingerBands, stochastic } from '@/lib/indicators';
import type { OHLCV } from '@/lib/indicators';

describe('Technical Indicators — Edge Cases', () => {
  describe('RSI', () => {
    it('returns ~0 for all declining prices', () => {
      const data = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
      const result = rsi(data, 14);
      const valid = result.filter(v => !isNaN(v));
      expect(valid.length).toBeGreaterThan(0);
      valid.forEach(v => { expect(v).toBeLessThan(20); });
    });

    it('returns ~100 for all rising prices', () => {
      const data = Array.from({ length: 30 }, (_, i) => 80 + i * 0.5);
      const result = rsi(data, 14);
      const valid = result.filter(v => !isNaN(v));
      expect(valid.length).toBeGreaterThan(0);
      valid.forEach(v => { expect(v).toBeGreaterThan(80); });
    });

    it('returns 100 for flat prices (no losses)', () => {
      const data = Array.from({ length: 30 }, () => 100.0);
      const result = rsi(data, 14);
      const valid = result.filter(v => !isNaN(v));
      expect(valid.length).toBeGreaterThan(0);
      // When smoothLoss is 0, RSI formula returns 100 (no downside)
      valid.forEach(v => { expect(v).toBe(100); });
    });

    it('handles very small price movements', () => {
      const data = Array.from({ length: 30 }, (_, i) => 1.00000 + (i % 2 === 0 ? 0.00001 : -0.00001));
      const result = rsi(data, 14);
      const valid = result.filter(v => !isNaN(v));
      expect(valid.length).toBeGreaterThan(0);
    });

    it('handles high-value prices (XAUUSD ~2350)', () => {
      const data = Array.from({ length: 30 }, (_, i) => 2350 + Math.sin(i / 5) * 10);
      const result = rsi(data, 14);
      const valid = result.filter(v => !isNaN(v));
      valid.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); });
    });

    it('produces NaN for insufficient data points', () => {
      const data = Array.from({ length: 5 }, (_, i) => 100 + i);
      const result = rsi(data, 14);
      // Should have mostly NaN for first 14 periods
      const validCount = result.filter(v => !isNaN(v)).length;
      expect(validCount).toBe(0);
    });
  });

  describe('EMA', () => {
    it('tracks rising prices closely', () => {
      const data = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5);
      const result = ema(data, 10);
      const valid = result.filter(v => !isNaN(v));
      expect(valid.length).toBeGreaterThan(0);
      // EMA should be between min and max
      valid.forEach(v => { expect(v).toBeGreaterThan(99); expect(v).toBeLessThan(125); });
    });

    it('returns NaN for period longer than data', () => {
      const data = [100, 101, 102];
      const result = ema(data, 10);
      const validCount = result.filter(v => !isNaN(v)).length;
      expect(validCount).toBe(0);
    });
  });

  describe('MACD', () => {
    it('all output arrays have same length as input', () => {
      const data = Array.from({ length: 100 }, (_, i) => 1.1 + Math.sin(i / 10) * 0.01);
      const result = macd(data);
      expect(result.macd.length).toBe(data.length);
      expect(result.signal.length).toBe(data.length);
      expect(result.histogram.length).toBe(data.length);
    });

    it('histogram equals macd minus signal', () => {
      const data = Array.from({ length: 100 }, (_, i) => 1.1 + Math.sin(i / 10) * 0.01);
      const result = macd(data);
      for (let i = 0; i < data.length; i++) {
        if (!isNaN(result.macd[i]) && !isNaN(result.signal[i])) {
          expect(result.histogram[i]).toBeCloseTo(result.macd[i] - result.signal[i], 10);
        }
      }
    });
  });

  describe('ATR', () => {
    it('returns positive values', () => {
      const candles: OHLCV[] = Array.from({ length: 50 }, (_, i) => ({
        time: Date.now() - (50 - i) * 60000,
        open: 1.1, high: 1.1 + Math.random() * 0.005,
        low: 1.1 - Math.random() * 0.005, close: 1.1 + (Math.random() - 0.5) * 0.005,
        volume: 1000,
      }));
      const result = atr(candles, 14);
      const valid = result.filter(v => !isNaN(v) && v !== null);
      valid.forEach(v => { expect(v).toBeGreaterThan(0); });
    });

    it('handles doji candles (open ≈ close ≈ high ≈ low)', () => {
      const candles: OHLCV[] = Array.from({ length: 50 }, (_, i) => ({
        time: Date.now() - (50 - i) * 60000,
        open: 1.10000, high: 1.10001, low: 1.09999, close: 1.10000,
        volume: 1000,
      }));
      const result = atr(candles, 14);
      const valid = result.filter(v => !isNaN(v) && v !== null);
      // ATR should be very small for doji candles
      valid.forEach(v => { expect(v).toBeLessThan(0.001); });
    });
  });

  describe('Bollinger Bands', () => {
    it('upper > middle > lower for non-constant data', () => {
      const data = Array.from({ length: 50 }, (_, i) => 1.1 + Math.random() * 0.01);
      const result = bollingerBands(data, 20, 2);
      const last = data.length - 1;
      const upper = result.upper[last];
      const middle = result.middle[last];
      const lower = result.lower[last];
      if (upper != null && lower != null && middle != null && !isNaN(upper) && !isNaN(lower)) {
        expect(upper).toBeGreaterThan(middle!);
        expect(middle).toBeGreaterThan(lower!);
      }
    });

    it('bands converge for low volatility data', () => {
      const data = Array.from({ length: 50 }, (_, i) => 1.10000 + (i % 2 === 0 ? 0.00001 : -0.00001));
      const result = bollingerBands(data, 20, 2);
      const last = data.length - 1;
      const upper = result.upper[last];
      const lower = result.lower[last];
      if (upper != null && lower != null && !isNaN(upper) && !isNaN(lower)) {
        const bandwidth = upper - lower;
        // Bandwidth should be very small for low volatility
        expect(bandwidth).toBeLessThan(0.001);
      }
    });
  });

  describe('Stochastic', () => {
    it('values are between 0 and 100', () => {
      const candles: OHLCV[] = Array.from({ length: 50 }, (_, i) => ({
        time: Date.now() - (50 - i) * 60000,
        open: 1.1, high: 1.1 + Math.random() * 0.01,
        low: 1.1 - Math.random() * 0.01, close: 1.1 + (Math.random() - 0.5) * 0.01,
        volume: 1000,
      }));
      const result = stochastic(candles, 14, 3);
      result.k.forEach(v => { if (!isNaN(v)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); } });
      result.d.forEach(v => { if (!isNaN(v)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); } });
    });
  });
});
