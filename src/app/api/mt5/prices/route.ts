import { NextResponse } from 'next/server';
import { MT5_BRIDGE_URL, BRIDGE_HEADERS } from '@/lib/mt5-config';
import { logApiError } from '@/lib/safe-log';

// P-02: Validate a single price object
function isValidPrice(p: Record<string, unknown>): boolean {
  const bid = Number(p.bid);
  const ask = Number(p.ask);
  const ts = Number(p.timestamp || p.time);
  if (bid <= 0 || ask <= 0 || bid >= ask) return false;
  if (ts > 0 && (Date.now() / 1000 - ts) > 60) return false;
  return true;
}

// GET - Fetch MT5 live prices
export async function GET() {
  try {
    const res = await fetch(`${MT5_BRIDGE_URL}/api/prices`, {
      headers: BRIDGE_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected', prices: {} }, { status: 503 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'MT5 bridge error', prices: {} }, { status: res.status });
    }
    const data = await res.json();

    // P-02: Add price validation
    const prices = data.prices ?? data;
    if (prices && typeof prices === 'object') {
      for (const [key, val] of Object.entries(prices)) {
        if (val && typeof val === 'object' && !isValidPrice(val as Record<string, unknown>)) {
          delete prices[key];
        }
      }
    }

    return NextResponse.json(data.prices ? { ...data, prices } : prices);
  } catch (error) {
    logApiError('MT5 Prices', error);
    return NextResponse.json(
      { error: 'Failed to reach MT5 bridge', prices: {} },
      { status: 500 }
    );
  }
}
