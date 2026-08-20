import { describe, it, expect } from 'vitest';

describe('FINEX API Integration Tests', () => {
  const BASE = 'http://localhost:3000';

  describe('GET /api/health', () => {
    it('should return 200 with status ok', async () => {
      const res = await fetch(`${BASE}/api/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });
  });

  describe('GET /api/finnhub (simulated prices)', () => {
    it('should return price data for all pairs', async () => {
      const res = await fetch(`${BASE}/api/finnhub`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.quotes).toBeDefined();
      expect(Object.keys(data.quotes).length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('POST /api/risk', () => {
    it('should calculate risk for valid parameters', async () => {
      const res = await fetch(`${BASE}/api/risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountBalance: 10000,
          pair: 'EURUSD',
          stopLossPips: 20,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.risk.lotSize).toBeGreaterThan(0);
    });

    it('should reject invalid pair', async () => {
      const res = await fetch(`${BASE}/api/risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountBalance: 10000,
          pair: 'INVALID',
          stopLossPips: 20,
        }),
      });
      expect(res.status).toBe(400);
    });

    it('should integrate AI confidence when provided', async () => {
      const res = await fetch(`${BASE}/api/risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountBalance: 10000,
          pair: 'EURUSD',
          stopLossPips: 20,
          aiConfidence: 0.85,
          riskLevel: 'medium',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.details.aiAdjusted).toBe(true);
      expect(data.details.aiConfidenceUsed).toBe(0.85);
      expect(data.details.riskLevelUsed).toBe('medium');
    });
  });

  describe('POST /api/market-condition', () => {
    it('should detect market condition from candles', async () => {
      // Generate simple test candles
      const candles = Array.from({ length: 100 }, (_, i) => ({
        time: Date.now() - (100 - i) * 60000,
        open: 1.1 + Math.sin(i / 10) * 0.001,
        high: 1.1 + Math.sin(i / 10) * 0.001 + 0.0005,
        low: 1.1 + Math.sin(i / 10) * 0.001 - 0.0005,
        close: 1.1 + Math.sin((i + 1) / 10) * 0.001,
        volume: 1000,
      }));
      const res = await fetch(`${BASE}/api/market-condition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candles }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(['trending', 'range_bound', 'high_volatility', 'low_volatility']).toContain(data.condition);
    });
  });

  describe('GET /api/news', () => {
    it('should return news (simulated)', async () => {
      const res = await fetch(`${BASE}/api/news`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.news).toBeDefined();
      expect(data.news.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/config', () => {
    it('should return trading configuration', async () => {
      const res = await fetch(`${BASE}/api/config`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.riskPerTrade).toBeDefined();
    });
  });
});
