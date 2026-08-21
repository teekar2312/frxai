import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:3000';

describe('Risk Calculation API', () => {
  it('should return error for invalid balance', async () => {
    const res = await fetch(`${BASE}/api/risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountBalance: -100, pair: 'EURUSD', stopLossPips: 20 }),
    });
    expect(res.status).toBe(400);
  });

  it('should return error for zero stop loss', async () => {
    const res = await fetch(`${BASE}/api/risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountBalance: 10000, pair: 'EURUSD', stopLossPips: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('should return error for invalid pair', async () => {
    const res = await fetch(`${BASE}/api/risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountBalance: 10000, pair: 'BTCUSD', stopLossPips: 20 }),
    });
    expect(res.status).toBe(400);
  });

  it('should calculate correctly for each pair', async () => {
    const pairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
    for (const pair of pairs) {
      const res = await fetch(`${BASE}/api/risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountBalance: 10000, pair, stopLossPips: 20 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.risk.lotSize).toBeGreaterThan(0);
      expect(data.risk.potentialLoss).toBeGreaterThan(0);
      expect(data.details.canTrade).toBeDefined();
    }
  });

  it('should have different spread for XAUUSD vs EURUSD', async () => {
    const [eurRes, xauRes] = await Promise.all([
      fetch(`${BASE}/api/risk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountBalance: 10000, pair: 'EURUSD', stopLossPips: 20 }) }),
      fetch(`${BASE}/api/risk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountBalance: 10000, pair: 'XAUUSD', stopLossPips: 200 }) }),
    ]);
    const [eurData, xauData] = await Promise.all([eurRes.json(), xauRes.json()]);
    // XAUUSD should have much higher pip value due to realistic spread
    expect(xauData.risk.pipValue).toBeGreaterThan(eurData.risk.pipValue);
  });
});
