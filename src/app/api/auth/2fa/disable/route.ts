import { NextRequest, NextResponse } from 'next/server';
import { authenticator } from 'otplib';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';

// POST - Disable 2FA (requires current token verification)
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { token } = body as { token?: string };

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'token is required and must be a string' },
        { status: 400 }
      );
    }

    // Get stored 2FA record
    const twoFactor = await db.userTwoFactor.findUnique({
      where: { userId: session.user.id },
    });

    if (!twoFactor) {
      return NextResponse.json(
        { error: '2FA is not enabled' },
        { status: 400 }
      );
    }

    if (!twoFactor.enabled) {
      return NextResponse.json(
        { error: '2FA is already disabled' },
        { status: 400 }
      );
    }

    // Verify current token before disabling
    authenticator.resetOptions();
    const isValid = authenticator.verify({ token, secret: twoFactor.secret });

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid token. Cannot disable 2FA.' },
        { status: 400 }
      );
    }

    // Disable 2FA
    await db.userTwoFactor.update({
      where: { userId: session.user.id },
      data: {
        enabled: false,
        verifiedAt: null,
      },
    });

    safeLog({
      level: 'info',
      route: '2FA-Disable',
      message: `2FA disabled for user ${session.user.id}`,
    });

    return NextResponse.json({ success: true, message: '2FA disabled successfully' });
  } catch (error) {
    logApiError('2FA-Disable', error);
    return NextResponse.json(
      { error: 'Failed to disable 2FA' },
      { status: 500 }
    );
  }
}
