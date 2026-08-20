import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateAuth, requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

// GET - List shared signals
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const pairFilter = searchParams.get('pair');

    const where: Record<string, unknown> = {};
    if (pairFilter) {
      where.pair = pairFilter.toUpperCase();
    }

    const signals = await db.sharedSignal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        pair: true,
        direction: true,
        entryPrice: true,
        stopLoss: true,
        takeProfit: true,
        confidence: true,
        reasoning: true,
        strategy: true,
        sharedBy: true,
        likes: true,
        commentCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ signals });
  } catch (error) {
    logApiError('SharedSignals', error);
    return NextResponse.json({ error: 'Failed to fetch shared signals' }, { status: 500 });
  }
}

// POST - Share a signal
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const body = await request.json();
    const { pair, direction, entryPrice, stopLoss, takeProfit, confidence, reasoning, strategy } = body as {
      pair?: string;
      direction?: string;
      entryPrice?: number;
      stopLoss?: number | null;
      takeProfit?: number | null;
      confidence?: number | null;
      reasoning?: string | null;
      strategy?: string | null;
    };

    if (!pair || !direction || !entryPrice) {
      return NextResponse.json(
        { error: 'pair, direction, and entryPrice are required' },
        { status: 400 }
      );
    }

    if (!['BUY', 'SELL'].includes(direction)) {
      return NextResponse.json({ error: 'direction must be BUY or SELL' }, { status: 400 });
    }

    if (entryPrice <= 0) {
      return NextResponse.json({ error: 'entryPrice must be positive' }, { status: 400 });
    }

    const signal = await db.sharedSignal.create({
      data: {
        pair: pair.toUpperCase(),
        direction,
        entryPrice,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
        confidence: confidence ?? null,
        reasoning: reasoning ?? null,
        strategy: strategy ?? null,
      },
    });

    return NextResponse.json({ signal }, { status: 201 });
  } catch (error) {
    logApiError('SharedSignals', error);
    return NextResponse.json({ error: 'Failed to share signal' }, { status: 500 });
  }
}

// PUT - Like a signal
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

    if (action !== 'like') {
      return NextResponse.json({ error: 'Only action=like is supported' }, { status: 400 });
    }

    const existing = await db.sharedSignal.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    const updated = await db.sharedSignal.update({
      where: { id },
      data: { likes: { increment: 1 } },
    });

    return NextResponse.json({ signal: updated });
  } catch (error) {
    logApiError('SharedSignals', error);
    return NextResponse.json({ error: 'Failed to like signal' }, { status: 500 });
  }
}
