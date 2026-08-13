import { NextRequest, NextResponse } from 'next/server';
import { MT5_BRIDGE_URL, BRIDGE_HEADERS } from '@/lib/mt5-config';
import { logApiError } from '@/lib/safe-log';

async function getBridgeStatus() {
  try {
    const res = await fetch(`${MT5_BRIDGE_URL}/api/status`, {
      headers: BRIDGE_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// GET - Check MT5 connection status
export async function GET() {
  try {
    const bridgeStatus = await getBridgeStatus();
    return NextResponse.json({
      connected: bridgeStatus?.connected ?? false,
      eaConnected: bridgeStatus?.eaConnected ?? false,
      uptime: bridgeStatus?.uptime ?? 0,
      lastPing: bridgeStatus?.lastPing ?? null,
      bridgeReachable: bridgeStatus !== null,
    });
  } catch (error) {
    logApiError('MT5 Connection', error);
    return NextResponse.json({
      connected: false,
      eaConnected: false,
      bridgeReachable: false,
      error: 'Failed to reach MT5 bridge',
    }, { status: 500 });
  }
}

// POST - Enable/disable/check MT5 connection
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body as { action: 'check' | 'enable' | 'disable' };

    if (!action || !['check', 'enable', 'disable'].includes(action)) {
      return NextResponse.json({ error: 'action must be check, enable, or disable' }, { status: 400 });
    }

    const bridgeStatus = await getBridgeStatus();

    return NextResponse.json({
      action,
      connected: bridgeStatus?.connected ?? false,
      eaConnected: bridgeStatus?.eaConnected ?? false,
      bridgeReachable: bridgeStatus !== null,
      message: action === 'enable'
        ? 'Bridge is reachable. Start the MT5 Expert Advisor to connect.'
        : action === 'disable'
          ? 'MT5 mode can be disabled. Switch to Simulation mode in settings.'
          : 'Status checked',
    });
  } catch (error) {
    logApiError('MT5 Connection', error);
    return NextResponse.json(
      { error: 'Failed to process connection request' },
      { status: 500 }
    );
  }
}
