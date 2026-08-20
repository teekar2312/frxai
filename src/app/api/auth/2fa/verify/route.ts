import { NextRequest, NextResponse } from 'next/server';
import { authenticator } from 'otplib';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';

// POST - Verify TOTP token and enable 2FA
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
        { error: '2FA not set up. Please set up 2FA first.' },
        { status: 400 }
      );
    }

    // Validate token against stored secret
    authenticator.resetOptions(); // Ensure default options
    const isValid = authenticator.verify({ token, secret: twoFactor.secret });

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid token. Please try again.' },
        { status: 400 }
      );
    }

    // Enable 2FA
    await db.userTwoFactor.update({
      where: { userId: session.user.id },
      data: {
        enabled: true,
        verifiedAt: new Date(),
      },
    });

    safeLog({
      level: 'info',
      route: '2FA-Verify',
      message: `2FA verified and enabled for user ${session.user.id}`,
    });

    return NextResponse.json({ success: true, message: '2FA enabled successfully' });
  } catch (error) {
    logApiError('2FA-Verify', error);
    return NextResponse.json(
      { error: 'Failed to verify 2FA' },
      { status: 500 }
    );
  }
}
