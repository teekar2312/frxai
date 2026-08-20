import { NextRequest, NextResponse } from 'next/server';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';

// POST - Generate TOTP secret for 2FA setup
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Generate new TOTP secret
    const secret = authenticator.generateSecret();

    // Build otpauth URL
    const userEmail = session.user.email || 'user';
    const otpauthUrl = `otpauth://totp/FINEX:${userEmail}?secret=${secret}&issuer=FINEX`;

    // Generate QR code as data URL
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // Upsert UserTwoFactor record
    await db.userTwoFactor.upsert({
      where: { userId: session.user.id },
      update: {
        secret,
        enabled: false,
        verifiedAt: null,
      },
      create: {
        userId: session.user.id,
        secret,
        enabled: false,
      },
    });

    safeLog({
      level: 'info',
      route: '2FA-Setup',
      message: `2FA setup initiated for user ${session.user.id}`,
    });

    return NextResponse.json({ secret, qrCodeUrl });
  } catch (error) {
    logApiError('2FA-Setup', error);
    return NextResponse.json(
      { error: 'Failed to setup 2FA' },
      { status: 500 }
    );
  }
}
