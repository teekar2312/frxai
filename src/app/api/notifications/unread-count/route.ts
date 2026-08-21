import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

// GET - Return count of unread notifications
// AUDIT-FIX-8: Removed validateAuth from GET — frontend polls this without API key.
// Notifications are read-only display data. Mark-as-read (PUT) still requires auth.
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const count = await db.notification.count({
      where: { isRead: false },
    });

    return NextResponse.json({ count });
  } catch (error) {
    logApiError('Notifications-UnreadCount', error);
    return NextResponse.json({ error: 'Failed to fetch unread count' }, { status: 500 });
  }
}
