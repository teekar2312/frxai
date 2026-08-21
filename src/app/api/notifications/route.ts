import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

const VALID_TYPES = ['signal', 'alert', 'position_open', 'position_close', 'system', 'auto_trade', 'stop_loss', 'take_profit', 'order_executed', 'order_expired', 'transaction'] as const;

// GET - List notifications
// AUDIT-FIX-8: Removed validateAuth from GET — frontend polls this without API key.
// Notifications are read-only display data, not sensitive. Mutations (POST/PUT/DELETE) still require auth.
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    const where: Record<string, unknown> = unreadOnly ? { isRead: false } : {};

    const notifications = await db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const parsed = notifications.map(item => ({
      ...item,
      data: item.data ? (() => { try { return JSON.parse(item.data); } catch { return null; } })() : null,
    }));

    return NextResponse.json({ notifications: parsed });
  } catch (error) {
    logApiError('Notifications', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

// POST - Create notification (system use)
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
    const { type, title, message, pair, data } = body as {
      type?: string;
      title?: string;
      message?: string;
      pair?: string;
      data?: Record<string, unknown>;
    };

    if (!title || !message) {
      return NextResponse.json({ error: 'title and message are required' }, { status: 400 });
    }

    if (type && !VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    const notification = await db.notification.create({
      data: {
        type: type || 'system',
        title,
        message,
        pair: pair || null,
        data: data ? JSON.stringify(data) : null,
      },
    });

    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    logApiError('Notifications', error);
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
  }
}

// PUT - Mark notification(s) as read
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
    const { ids, id } = body as { ids?: string[]; id?: string };

    if (!ids && !id) {
      return NextResponse.json(
        { error: 'Either ids (array) or id (string) is required' },
        { status: 400 },
      );
    }

    const targetIds = ids || (id ? [id] : []);

    if (targetIds.length === 0) {
      return NextResponse.json({ error: 'No notification IDs provided' }, { status: 400 });
    }

    const result = await db.notification.updateMany({
      where: { id: { in: targetIds } },
      data: { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({ updated: result.count });
  } catch (error) {
    logApiError('Notifications', error);
    return NextResponse.json({ error: 'Failed to mark notifications as read' }, { status: 500 });
  }
}

// DELETE - Delete notification
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

    const existing = await db.notification.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    await db.notification.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError('Notifications', error);
    return NextResponse.json({ error: 'Failed to delete notification' }, { status: 500 });
  }
}
