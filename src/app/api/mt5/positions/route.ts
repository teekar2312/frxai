import { NextResponse } from 'next/server';
import { MT5_BRIDGE_URL, BRIDGE_HEADERS } from '@/lib/mt5-config';

// GET - Fetch MT5 positions
export async function GET() {
  try {
    const res = await fetch(`${MT5_BRIDGE_URL}/api/positions`, {
      headers: BRIDGE_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected', positions: [] }, { status: 503 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'MT5 bridge error', positions: [] }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[MT5 Positions GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reach MT5 bridge', positions: [] },
      { status: 500 }
    );
  }
}
