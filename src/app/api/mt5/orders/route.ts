import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const BRIDGE_URL = 'http://localhost:3004';
const MIN_LOT = 0.01;
const MAX_LOT = 50;

// POST - Send order to MT5
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pair, direction, lotSize, stopLoss, takeProfit, comment } = body;

    if (!pair || !direction || !lotSize) {
      return NextResponse.json(
        { error: 'pair, direction, and lotSize are required' },
        { status: 400 }
      );
    }

    if (lotSize < MIN_LOT || lotSize > MAX_LOT) {
      return NextResponse.json(
        { error: `lotSize must be between ${MIN_LOT} and ${MAX_LOT}` },
        { status: 400 }
      );
    }

    if (!['BUY', 'SELL'].includes(direction)) {
      return NextResponse.json(
        { error: 'direction must be BUY or SELL' },
        { status: 400 }
      );
    }

    const res = await fetch(`${BRIDGE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair, direction, lotSize, stopLoss, takeProfit, comment }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 503) {
      return NextResponse.json({ error: 'MT5 not connected' }, { status: 503 });
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
          pair,
          metadata: JSON.stringify({ ticket: data.ticket, direction, lotSize, stopLoss, takeProfit, responseStatus: res.status }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json(data, { status: isSuccess ? 200 : res.status });
  } catch (error) {
    console.error('[MT5 Orders POST] Error:', error);

    // Activity log for failure
    try {
      const body = await request.json().catch(() => ({}));
      await db.activityLog.create({
        data: {
          level: 'warn',
          category: 'mt5_trading',
          message: `MT5 Order EXCEPTION: ${body.direction ?? 'unknown'} ${body.pair ?? 'unknown'} - ${error instanceof Error ? error.message : 'Unknown'}`,
          pair: body.pair ?? null,
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

    const res = await fetch(`${BRIDGE_URL}/api/orders/${ticket}`, {
      method: 'DELETE',
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

    return NextResponse.json(data, { status: isSuccess ? 200 : res.status });
  } catch (error) {
    console.error('[MT5 Orders DELETE] Error:', error);

    // Activity log for failure
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
  try {
    const body = await request.json();
    const { ticket, stopLoss, takeProfit } = body;

    if (!ticket) {
      return NextResponse.json({ error: 'ticket is required' }, { status: 400 });
    }

    const modifyData: Record<string, unknown> = {};
    if (stopLoss !== undefined) modifyData.stopLoss = stopLoss;
    if (takeProfit !== undefined) modifyData.takeProfit = takeProfit;

    const res = await fetch(`${BRIDGE_URL}/api/orders/${ticket}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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

    return NextResponse.json(data, { status: isSuccess ? 200 : res.status });
  } catch (error) {
    console.error('[MT5 Orders PATCH] Error:', error);

    // Activity log for failure
    try {
      const body = await request.json().catch(() => ({ ticket: 'unknown' }));
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
