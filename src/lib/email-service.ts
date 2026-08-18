import { Resend } from 'resend';
import { db } from '@/lib/db';
import { safeLog } from '@/lib/safe-log';

// Lazy singleton — Resend client is only created when first needed
let _resendClient: Resend | null = null;
function getResendClient(): Resend | null {
  if (_resendClient) return _resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  _resendClient = new Resend(apiKey);
  return _resendClient;
}

const DEFAULT_FROM = process.env.NOTIFICATION_EMAIL_FROM || 'onboarding@resend.dev';

// ============================================================
// Email Config Resolution
// ============================================================

export async function getEmailConfig() {
  const config = await db.tradingConfig.findFirst();
  const targetEmail = config?.notifyEmail || process.env.NOTIFICATION_EMAIL_TO || '';
  const resendKey = process.env.RESEND_API_KEY || '';
  return {
    targetEmail,
    fromEmail: DEFAULT_FROM,
    hasResendKey: !!resendKey,
    hasTargetEmail: !!targetEmail,
    isReady: !!resendKey && !!targetEmail,
    toggles: {
      positionOpen: config?.emailOnPositionOpen ?? false,
      positionClose: config?.emailOnPositionClose ?? false,
      alertTrigger: config?.emailOnAlertTrigger ?? true,
    },
  };
}

export async function getEmailConfigStatus() {
  const config = await getEmailConfig();
  return {
    configured: config.isReady,
    provider: config.hasResendKey ? 'resend' : 'none',
    fromEmail: config.fromEmail,
    toEmail: config.targetEmail || '(not set)',
    toggles: config.toggles,
  };
}

// ============================================================
// HTML Email Templates (Dark Theme)
// ============================================================

function emailBaseHtml(innerHtml: string, subject: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;min-height:100vh;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td style="padding:20px 0;text-align:center;">
    <span style="font-size:22px;font-weight:700;color:#10b981;">FINEX Indonesia</span>
    <br><span style="font-size:12px;color:#71717a;">Platform Trading Forex AI</span>
  </td></tr>
  <tr><td style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:24px;">
    ${innerHtml}
  </td></tr>
  <tr><td style="padding:20px 0;text-align:center;">
    <span style="font-size:10px;color:#52525b;">Terdaftar dan Diawasi oleh BAPPEBTI · Email otomatis, jangan balas</span>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function sendPriceAlertHtml(pair: string, condition: string, targetPrice: number, currentPrice: number, note: string | null): string {
  const condLabel: Record<string, string> = {
    above: 'Naik Di Atas', below: 'Turun Di Bawah',
    crosses_above: 'Menyeberang Ke Atas', crosses_below: 'Menyeberang Ke Bawah',
  };
  return emailBaseHtml(`
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 16px;">Price alert terpicu</p>
    <div style="background:#27272a;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="color:#f4f4f5;font-size:18px;font-weight:600;margin:0 0 4px;">${pair}</p>
      <p style="color:#10b981;font-size:14px;margin:0;">${condLabel[condition] || condition} ${targetPrice}</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Harga Target</td><td style="color:#f4f4f5;font-size:12px;text-align:right;padding:4px 0;">${targetPrice}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Harga Saat Ini</td><td style="color:#f4f4f5;font-size:12px;text-align:right;padding:4px 0;">${currentPrice}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Waktu</td><td style="color:#f4f4f5;font-size:12px;text-align:right;padding:4px 0;">${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>
    </table>
    ${note ? `<p style="color:#a1a1aa;font-size:12px;margin:0;">📝 ${note}</p>` : ''}
  `, `🔔 Price Alert: ${pair}`);
}

function positionOpenHtml(pair: string, direction: string, lotSize: number, entryPrice: number, stopLoss: number | null, takeProfit: number | null): string {
  return emailBaseHtml(`
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 16px;">Posisi baru dibuka</p>
    <div style="background:#27272a;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="color:#f4f4f5;font-size:18px;font-weight:600;margin:0 0 4px;">${pair}</p>
      <p style="color:${direction === 'BUY' ? '#10b981' : '#ef4444'};font-size:14px;font-weight:600;margin:0;">${direction === 'BUY' ? '📈 BUY' : '📉 SELL'} · ${lotSize} lot</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Entry</td><td style="color:#f4f4f5;font-size:12px;text-align:right;">${entryPrice}</td></tr>
      ${stopLoss ? `<tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Stop Loss</td><td style="color:#ef4444;font-size:12px;text-align:right;">${stopLoss}</td></tr>` : ''}
      ${takeProfit ? `<tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Take Profit</td><td style="color:#10b981;font-size:12px;text-align:right;">${takeProfit}</td></tr>` : ''}
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Waktu</td><td style="color:#f4f4f5;font-size:12px;text-align:right;">${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>
    </table>
  `, `📊 Posisi Dibuka: ${pair} ${direction}`);
}

function positionCloseHtml(pair: string, direction: string, lotSize: number, entryPrice: number, closePrice: number, pnl: number): string {
  const isProfit = pnl >= 0;
  return emailBaseHtml(`
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 16px;">Posisi ditutup</p>
    <div style="background:#27272a;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="color:#f4f4f5;font-size:18px;font-weight:600;margin:0 0 4px;">${pair}</p>
      <p style="color:${direction === 'BUY' ? '#10b981' : '#ef4444'};font-size:14px;margin:0 0 8px;">${direction === 'BUY' ? '📈 BUY' : '📉 SELL'} · ${lotSize} lot</p>
      <p style="color:${isProfit ? '#10b981' : '#ef4444'};font-size:20px;font-weight:700;margin:0;">${isProfit ? '+' : ''}$${pnl.toFixed(2)}</p>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Entry</td><td style="color:#f4f4f5;font-size:12px;text-align:right;">${entryPrice}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Close</td><td style="color:#f4f4f5;font-size:12px;text-align:right;">${closePrice}</td></tr>
      <tr><td style="color:#71717a;font-size:12px;padding:4px 0;">Waktu</td><td style="color:#f4f4f5;font-size:12px;text-align:right;">${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>
    </table>
  `, `${isProfit ? '✅' : '❌'} Posisi Ditutup: ${pair} ${isProfit ? 'Profit' : 'Loss'}`);
}

// ============================================================
// Core Send Functions
// ============================================================

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const client = getResendClient();
  if (!client) {
    safeLog({ level: 'warn', route: 'EmailService', message: 'RESEND_API_KEY not set — email skipped' });
    return false;
  }
  if (!to) {
    safeLog({ level: 'warn', route: 'EmailService', message: 'No target email configured — email skipped' });
    return false;
  }

  try {
    const { error } = await client.emails.send({
      from: DEFAULT_FROM,
      to: [to],
      subject,
      html,
    });
    if (error) {
      safeLog({ level: 'error', route: 'EmailService', message: `Resend error: ${error.message}` });
      return false;
    }
    safeLog({ level: 'info', route: 'EmailService', message: `Email sent: ${subject} → ${to}` });
    return true;
  } catch (err) {
    safeLog({ level: 'error', route: 'EmailService', message: `Email send failed: ${err instanceof Error ? err.message : String(err)}` });
    return false;
  }
}

export async function sendPriceAlertEmail(pair: string, condition: string, targetPrice: number, currentPrice: number, note: string | null): Promise<boolean> {
  const config = await getEmailConfig();
  if (!config.isReady || !config.toggles.alertTrigger) return false;

  const html = sendPriceAlertHtml(pair, condition, targetPrice, currentPrice, note);
  return sendEmail(config.targetEmail, `🔔 Price Alert: ${pair} ${condition} ${targetPrice}`, html);
}

export async function sendPositionOpenEmail(pair: string, direction: string, lotSize: number, entryPrice: number, stopLoss: number | null, takeProfit: number | null): Promise<boolean> {
  const config = await getEmailConfig();
  if (!config.isReady || !config.toggles.positionOpen) return false;

  const html = positionOpenHtml(pair, direction, lotSize, entryPrice, stopLoss, takeProfit);
  return sendEmail(config.targetEmail, `📊 Posisi Dibuka: ${pair} ${direction}`, html);
}

export async function sendPositionCloseEmail(pair: string, direction: string, lotSize: number, entryPrice: number, closePrice: number, pnl: number): Promise<boolean> {
  const config = await getEmailConfig();
  if (!config.isReady || !config.toggles.positionClose) return false;

  const html = positionCloseHtml(pair, direction, lotSize, entryPrice, closePrice, pnl);
  return sendEmail(config.targetEmail, `${pnl >= 0 ? '✅' : '❌'} Posisi Ditutup: ${pair} ${pnl >= 0 ? 'Profit' : 'Loss'}`, html);
}
