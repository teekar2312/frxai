import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, PendingOrderType } from '@/lib/trading-types';
import { FOREX_PAIRS } from '@/lib/trading-types';
import { validateAuth, requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';
import { getCurrentMidPriceLegacy as getCurrentMidPrice } from '@/lib/price-fetcher';

const VALID_ORDER_TYPES: PendingOrderType[] = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop'];
const VALID_STATUSES = ['pending', 'executed', 'cancelled', 'expired'] as const;

// GET - List pending orders
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: Record<string, string> = {};
    if (status && VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      where.status = status;
    }

    const orders = await db.pendingOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ orders });
  } catch (error) {
    logApiError('PendingOrders', error);
    return NextResponse.json({ error: 'Failed to fetch pending orders' }, { status: 500 });
  }
}

// POST - Create pending order
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'trade');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const body = await request.json();
    const {
      pair, direction, orderType, lotSize, price, stopLoss, takeProfit,
      strategy, aiConfidence, riskLevel, aiRecommendation,
    } = body as {
      pair?: string;
      direction?: string;
      orderType?: string;
      lotSize?: number;
      price?: number;
      stopLoss?: number | null;
      takeProfit?: number | null;
      strategy?: string | null;
      aiConfidence?: number | null;
      riskLevel?: string | null;
      aiRecommendation?: string | null;
    };

    if (!pair || !direction || !orderType || !lotSize || !price) {
      return NextResponse.json(
        { error: 'pair, direction, orderType, lotSize, and price are required' },
        { status: 400 }
      );
    }

    if (!FOREX_PAIRS.includes(pair as ForexPair)) {
      return NextResponse.json(
        { error: `Invalid pair. Must be one of: ${FOREX_PAIRS.join(', ')}` },
        { status: 400 }
      );
    }

    if (!['BUY', 'SELL'].includes(direction)) {
      return NextResponse.json({ error: 'direction must be BUY or SELL' }, { status: 400 });
    }

    if (!VALID_ORDER_TYPES.includes(orderType as PendingOrderType)) {
      return NextResponse.json(
        { error: `Invalid orderType. Must be one of: ${VALID_ORDER_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (lotSize <= 0) {
      return NextResponse.json({ error: 'lotSize must be positive' }, { status: 400 });
    }

    if (price <= 0) {
      return NextResponse.json({ error: 'price must be positive' }, { status: 400 });
    }

    // Validate order price vs current market price
    const currentPrice = await getCurrentMidPrice(pair as ForexPair);
    if (currentPrice && currentPrice > 0) {
      switch (orderType) {
        case 'buy_limit':
          if (price >= currentPrice) {
            return NextResponse.json(
              { error: `Buy limit price (${price}) must be below current price (${currentPrice})` },
              { status: 400 }
            );
          }
          break;
        case 'sell_limit':
          if (price <= currentPrice) {
            return NextResponse.json(
              { error: `Sell limit price (${price}) must be above current price (${currentPrice})` },
              { status: 400 }
            );
          }
          break;
        case 'buy_stop':
          if (price <= currentPrice) {
            return NextResponse.json(
              { error: `Buy stop price (${price}) must be above current price (${currentPrice})` },
              { status: 400 }
            );
          }
          break;
        case 'sell_stop':
          if (price >= currentPrice) {
            return NextResponse.json(
              { error: `Sell stop price (${price}) must be below current price (${currentPrice})` },
              { status: 400 }
            );
          }
          break;
      }
    }

    const order = await db.pendingOrder.create({
      data: {
        pair,
        direction,
        orderType,
        lotSize,
        price,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
        strategy: strategy ?? null,
        aiConfidence: aiConfidence ?? null,
        riskLevel: riskLevel ?? null,
        aiRecommendation: aiRecommendation ?? null,
        // Default expiry: 24 hours
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    safeLog({
      level: 'info',
      route: 'PendingOrders',
      message: `Created ${orderType} ${direction} ${pair} @ ${price}`,
      pair,
      metadata: JSON.stringify({ orderId: order.id, orderType, lotSize }),
    });

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    logApiError('PendingOrders', error);
    return NextResponse.json({ error: 'Failed to create pending order' }, { status: 500 });
  }
}

// PUT - Update pending order (cancel)
export async function PUT(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const body = await request.json();
    const { id, action } = body as { id?: string; action?: string };

    if (!id || !action) {
      return NextResponse.json({ error: 'id and action are required' }, { status: 400 });
    }

    if (action !== 'cancel') {
      return NextResponse.json({ error: 'Only action=cancel is supported' }, { status: 400 });
    }

    const existing = await db.pendingOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot cancel order with status: ${existing.status}` },
        { status: 400 }
      );
    }

    const updated = await db.pendingOrder.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    });

    safeLog({
      level: 'info',
      route: 'PendingOrders',
      message: `Cancelled ${existing.orderType} ${existing.direction} ${existing.pair} @ ${existing.price}`,
      pair: existing.pair,
    });

    return NextResponse.json({ order: updated });
  } catch (error) {
    logApiError('PendingOrders', error);
    return NextResponse.json({ error: 'Failed to update pending order' }, { status: 500 });
  }
}

// DELETE - Delete pending order (only if pending)
export async function DELETE(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const existing = await db.pendingOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Can only delete pending orders. Current status: ${existing.status}` },
        { status: 400 }
      );
    }

    await db.pendingOrder.delete({ where: { id } });

    safeLog({
      level: 'info',
      route: 'PendingOrders',
      message: `Deleted pending order ${existing.orderType} ${existing.direction} ${existing.pair}`,
      pair: existing.pair,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError('PendingOrders', error);
    return NextResponse.json({ error: 'Failed to delete pending order' }, { status: 500 });
  }
}
