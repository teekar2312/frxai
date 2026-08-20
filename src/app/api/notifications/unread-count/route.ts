import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateAuth } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

// GET - Return count of unread notifications
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

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
