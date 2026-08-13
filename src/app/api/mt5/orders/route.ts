import { NextRequest, NextResponse } from 'next/server';

const BRIDGE_URL = 'http://localhost:3004';

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
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (error) {
    console.error('[MT5 Orders POST] Error:', error);
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
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (error) {
    console.error('[MT5 Orders DELETE] Error:', error);
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
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (error) {
    console.error('[MT5 Orders PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to modify order on MT5' },
      { status: 500 }
    );
  }
}
