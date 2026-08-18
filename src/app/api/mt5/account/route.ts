import { NextRequest, NextResponse } from 'next/server';
import { MT5_BRIDGE_URL, BRIDGE_HEADERS } from '@/lib/mt5-config';
import { logApiError } from '@/lib/safe-log';
// AUDIT-TRADE-12: Add auth for MT5 account endpoint
import { validateAuth } from '@/lib/api-auth';

// GET - Fetch MT5 account info
export async function GET(request: NextRequest) {
  // AUDIT-TRADE-12: Require auth for MT5 data access (validateAuth checks all methods)
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;
  try {
    const res = await fetch(`${MT5_BRIDGE_URL}/api/account`, {
      headers: BRIDGE_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected' }, { status: 503 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'MT5 bridge error' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    logApiError('MT5 Account', error);
    return NextResponse.json(
      { error: 'Failed to reach MT5 bridge' },
      { status: 500 }
    );
  }
}
