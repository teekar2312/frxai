import { NextResponse } from 'next/server';

const BRIDGE_URL = 'http://localhost:3004';

// GET - Fetch MT5 live prices
export async function GET() {
  try {
    const res = await fetch(`${BRIDGE_URL}/api/prices`, { signal: AbortSignal.timeout(5000) });
    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected', prices: {} }, { status: 503 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'MT5 bridge error', prices: {} }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[MT5 Prices GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reach MT5 bridge', prices: {} },
      { status: 500 }
    );
  }
}
