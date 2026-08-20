import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateAuth, requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

// GET - List watchlist pairs
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const pairs = await db.watchlistPair.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json({ pairs });
  } catch (error) {
    logApiError('Watchlist', error);
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }
}

// POST - Add pair to watchlist
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
    const { pair, sortOrder } = body as { pair?: string; sortOrder?: number };

    if (!pair) {
      return NextResponse.json({ error: 'pair is required' }, { status: 400 });
    }

    // Check if already exists
    const existing = await db.watchlistPair.findUnique({ where: { pair: pair.toUpperCase() } });
    if (existing) {
      return NextResponse.json({ error: 'Pair already in watchlist' }, { status: 409 });
    }

    // Get max sortOrder if not provided
    let finalSortOrder = sortOrder ?? 0;
    if (finalSortOrder === 0) {
      const maxEntry = await db.watchlistPair.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      finalSortOrder = (maxEntry?.sortOrder ?? 0) + 1;
    }

    const watchlistPair = await db.watchlistPair.create({
      data: {
        pair: pair.toUpperCase(),
        sortOrder: finalSortOrder,
      },
    });

    return NextResponse.json({ pair: watchlistPair }, { status: 201 });
  } catch (error) {
    logApiError('Watchlist', error);
    return NextResponse.json({ error: 'Failed to add pair to watchlist' }, { status: 500 });
  }
}

// DELETE - Remove pair from watchlist
export async function DELETE(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const pair = searchParams.get('pair');

    if (!pair) {
      return NextResponse.json({ error: 'pair query parameter is required' }, { status: 400 });
    }

    const existing = await db.watchlistPair.findUnique({ where: { pair: pair.toUpperCase() } });
    if (!existing) {
      return NextResponse.json({ error: 'Pair not found in watchlist' }, { status: 404 });
    }

    await db.watchlistPair.delete({ where: { pair: pair.toUpperCase() } });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError('Watchlist', error);
    return NextResponse.json({ error: 'Failed to remove pair from watchlist' }, { status: 500 });
  }
}
