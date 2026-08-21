import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { safeLog } from '@/lib/safe-log';
import { sendEmail } from '@/lib/email-service';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  // H4: Add rate limiting to prevent abuse
  const rateCheck = checkRateLimit(clientIp(request), 'auth');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { success: true, message: 'Jika email terdaftar, link reset telah dikirim.' },
      );
    }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.user.update({
        where: { id: user.id },
        data: {
          resetToken: token,
          resetTokenExpires: expires,
        },
      });

      // Send email (best-effort)
      try {
        const resetUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reset Password</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;min-height:100vh;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td style="padding:20px 0;text-align:center;">
    <span style="font-size:22px;font-weight:700;color:#10b981;">FINEX Indonesia</span>
    <br><span style="font-size:12px;color:#71717a;">Platform Trading Forex AI</span>
  </td></tr>
  <tr><td style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:24px;">
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 16px;">Anda meminta reset password. Klik tombol di bawah untuk mengatur password baru:</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${resetUrl}" style="display:inline-block;background:#059669;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Reset Password</a>
    </p>
    <p style="color:#71717a;font-size:12px;margin:16px 0 0;">Link ini berlaku selama 1 jam. Jika Anda tidak meminta reset, abaikan email ini.</p>
  </td></tr>
  <tr><td style="padding:20px 0;text-align:center;">
    <span style="font-size:10px;color:#52525b;">Terdaftar dan Diawasi oleh BAPPEBTI</span>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

        await sendEmail(
          user.email,
          'Reset Password - FINEX Indonesia',
          html,
        );
        safeLog({ level: 'info', route: 'ForgotPassword', message: `Reset email sent to: ${user.email}` });
      } catch (emailErr) {
        safeLog({
          level: 'warn',
          route: 'ForgotPassword',
          message: 'Failed to send reset email',
          error: emailErr instanceof Error ? emailErr.message : String(emailErr),
        });
      }
    }

    // Always return success to prevent email enumeration
    return NextResponse.json(
      { success: true, message: 'Jika email terdaftar, link reset telah dikirim.' },
    );
  } catch (error) {
    safeLog({
      level: 'error',
      route: 'ForgotPassword',
      message: 'Request failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: true, message: 'Jika email terdaftar, link reset telah dikirim.' },
    );
  }
}
