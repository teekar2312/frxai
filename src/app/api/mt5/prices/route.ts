import { NextRequest, NextResponse } from 'next/server';
import { MT5_BRIDGE_URL, BRIDGE_HEADERS } from '@/lib/mt5-config';
import { validateAuth } from '@/lib/api-auth';
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
export async function GET(request: NextRequest) {
  // H2: Add auth check (consistent with other MT5 routes)
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;
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
    const rawPrices = data.prices ?? data;
    // H6: Don't mutate the response object — build a new filtered object
    const filteredPrices: Record<string, unknown> = {};
    if (rawPrices && typeof rawPrices === 'object') {
      for (const [key, val] of Object.entries(rawPrices)) {
        if (key === 'timestamp' || key === 'success') continue;
        if (val && typeof val === 'object' && !isValidPrice(val as Record<string, unknown>)) continue;
        filteredPrices[key] = val;
      }
    }

    return NextResponse.json(data.prices ? { ...data, prices: filteredPrices } : filteredPrices);
  } catch (error) {
    logApiError('MT5 Prices', error);
    return NextResponse.json(
      { error: 'Failed to reach MT5 bridge', prices: {} },
      { status: 500 }
    );
  }
}
