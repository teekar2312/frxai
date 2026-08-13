import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { MT5_BRIDGE_URL, BRIDGE_HEADERS } from '@/lib/mt5-config';

const MIN_LOT = 0.01; // M1: Must stay in sync with bridge MIN_LOT
const MAX_LOT = 50;   // M1: Must stay in sync with bridge MAX_LOT

// POST - Send order to MT5
export async function POST(request: NextRequest) {
  // L1: Parse body once at the top level
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { pair, direction, lotSize, stopLoss, takeProfit, comment } = body;

  try {
    if (!pair || !direction || !lotSize) {
      return NextResponse.json(
        { error: 'pair, direction, and lotSize are required' },
        { status: 400 }
      );
    }

    if (typeof lotSize !== 'number' || lotSize < MIN_LOT || lotSize > MAX_LOT) {
      return NextResponse.json(
        { error: `lotSize must be between ${MIN_LOT} and ${MAX_LOT}` },
        { status: 400 }
      );
    }

    if (!['BUY', 'SELL'].includes(direction as string)) {
      return NextResponse.json(
        { error: 'direction must be BUY or SELL' },
        { status: 400 }
      );
    }

    const res = await fetch(`${MT5_BRIDGE_URL}/api/orders`, {
      method: 'POST',
      headers: BRIDGE_HEADERS,
      body: JSON.stringify({ pair, direction, lotSize, stopLoss, takeProfit, comment }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected' }, { status: 503 });
    }

    // H4: Bridge now returns 502/504 for EA failures — forward properly
    if (res.status === 401) {
      return NextResponse.json({ error: 'Bridge authentication failed' }, { status: 502 });
    }

    const data = await res.json();
    const isSuccess = res.ok;

    // Activity log for MT5 order
    try {
      await db.activityLog.create({
        data: {
          level: isSuccess ? 'info' : 'warn',
          category: 'mt5_trading',
          message: isSuccess
            ? `MT5 Order: ${direction} ${pair} x${lotSize} (Ticket #${data.ticket ?? 'unknown'})`
            : `MT5 Order FAILED: ${direction} ${pair} x${lotSize} - ${data.error ?? 'unknown error'}`,
          pair: pair as string,
          metadata: JSON.stringify({ ticket: data.ticket, direction, lotSize, stopLoss, takeProfit, responseStatus: res.status }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch (error) {
    console.error('[MT5 Orders POST] Error:', error);

    // L1: Use pre-parsed body for error logging
    try {
      await db.activityLog.create({
        data: {
          level: 'warn',
          category: 'mt5_trading',
          message: `MT5 Order EXCEPTION: ${body.direction ?? 'unknown'} ${body.pair ?? 'unknown'} - ${error instanceof Error ? error.message : 'Unknown'}`,
          pair: (body.pair as string) ?? null,
          metadata: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json(
      { error: 'Failed to send order to MT5' },
      { status: 500 }
    );
  }
}

// DELETE - Close order on MT5
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticket = searchParams.get('ticket');

    if (!ticket) {
      return NextResponse.json({ error: 'ticket query parameter is required' }, { status: 400 });
    }

    const res = await fetch(`${MT5_BRIDGE_URL}/api/orders/${ticket}`, {
      method: 'DELETE',
      headers: BRIDGE_HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected' }, { status: 503 });
    }

    const data = await res.json();
    const isSuccess = res.ok;

    // Activity log for MT5 close
    try {
      await db.activityLog.create({
        data: {
          level: isSuccess ? 'info' : 'warn',
          category: 'mt5_trading',
          message: isSuccess
            ? `MT5 Close: Ticket #${ticket}`
            : `MT5 Close FAILED: Ticket #${ticket} - ${data.error ?? 'unknown error'}`,
          metadata: JSON.stringify({ ticket, responseStatus: res.status }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch (error) {
    console.error('[MT5 Orders DELETE] Error:', error);

    try {
      const { searchParams } = new URL(request.url);
      const ticket = searchParams.get('ticket');
      await db.activityLog.create({
        data: {
          level: 'warn',
          category: 'mt5_trading',
          message: `MT5 Close EXCEPTION: Ticket #${ticket ?? 'unknown'} - ${error instanceof Error ? error.message : 'Unknown'}`,
          metadata: JSON.stringify({ ticket, error: error instanceof Error ? error.message : 'Unknown' }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json(
      { error: 'Failed to close order on MT5' },
      { status: 500 }
    );
  }
}

// PATCH - Modify order SL/TP on MT5
export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { ticket, stopLoss, takeProfit } = body;

  try {
    if (!ticket) {
      return NextResponse.json({ error: 'ticket is required' }, { status: 400 });
    }

    const modifyData: Record<string, unknown> = {};
    if (stopLoss !== undefined) modifyData.stopLoss = stopLoss;
    if (takeProfit !== undefined) modifyData.takeProfit = takeProfit;

    const res = await fetch(`${MT5_BRIDGE_URL}/api/orders/${ticket}`, {
      method: 'PATCH',
      headers: BRIDGE_HEADERS,
      body: JSON.stringify(modifyData),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected' }, { status: 503 });
    }

    const data = await res.json();
    const isSuccess = res.ok;

    // Activity log for MT5 modify
    try {
      const parts = [];
      if (stopLoss !== undefined) parts.push(`SL=${stopLoss}`);
      if (takeProfit !== undefined) parts.push(`TP=${takeProfit}`);
      const detailStr = parts.length > 0 ? ` ${parts.join(' ')}` : '';
      await db.activityLog.create({
        data: {
          level: isSuccess ? 'info' : 'warn',
          category: 'mt5_trading',
          message: isSuccess
            ? `MT5 Modify: Ticket #${ticket}${detailStr}`
            : `MT5 Modify FAILED: Ticket #${ticket}${detailStr} - ${data.error ?? 'unknown error'}`,
          metadata: JSON.stringify({ ticket, stopLoss, takeProfit, responseStatus: res.status }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch (error) {
    console.error('[MT5 Orders PATCH] Error:', error);

    // L1: Use pre-parsed body for error logging
    try {
      await db.activityLog.create({
        data: {
          level: 'warn',
          category: 'mt5_trading',
          message: `MT5 Modify EXCEPTION: Ticket #${body.ticket ?? 'unknown'} - ${error instanceof Error ? error.message : 'Unknown'}`,
          metadata: JSON.stringify({ ticket: body.ticket, error: error instanceof Error ? error.message : 'Unknown' }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json(
      { error: 'Failed to modify order on MT5' },
      { status: 500 }
    );
  }
}
