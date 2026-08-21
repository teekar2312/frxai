import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:3000';

describe('Position Management API', () => {
  it('GET /api/positions returns array', async () => {
    const res = await fetch(`${BASE}/api/positions`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.positions || data)).toBe(true);
  });

  it('GET /api/pending-orders returns array', async () => {
    const res = await fetch(`${BASE}/api/pending-orders`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.orders || data)).toBe(true);
  });

  it('GET /api/trade-analytics returns analytics', async () => {
    const res = await fetch(`${BASE}/api/trade-analytics`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('totalTrades');
  });

  it('GET /api/correlation returns matrix', async () => {
    const res = await fetch(`${BASE}/api/correlation`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.matrix).toBeDefined();
  });
});
