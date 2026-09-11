import "server-only";
import { log } from "./server-config";

/**
 * Email sending utility.
 *
 * In production: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * env vars and install nodemailer (bun add nodemailer).
 *
 * In sandbox/development: logs the email to the Log table and console
 * instead of actually sending (graceful no-op).
 */

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

export async function sendAlertEmail(payload: EmailPayload): Promise<{ sent: boolean; reason?: string }> {
  const { to, subject, body } = payload;

  // Basic email validation
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { sent: false, reason: "Invalid email address" };
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || "noreply@frxai.local";

  // If SMTP not configured, log to DB (sandbox/dev mode)
  if (!smtpHost || !smtpUser) {
    await log("INFO", "EMAIL", `Email (sandbox mode — SMTP not configured): To=${to} | Subject=${subject} | Body=${body.slice(0, 200)}`);
    return { sent: false, reason: "SMTP not configured — email logged to system logs. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env to enable real delivery." };
  }

  try {
    // Dynamic import nodemailer only if SMTP is configured
    // (avoids requiring the package in sandbox)
    const nodemailer = await import("nodemailer").catch(() => null);

    if (!nodemailer) {
      await log("WARN", "EMAIL", `nodemailer not installed — email to ${to} logged but not sent. Run: bun add nodemailer`);
      return { sent: false, reason: "nodemailer not installed" };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort) || 587,
      secure: (Number(smtpPort) || 587) === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      text: body,
    });

    await log("INFO", "EMAIL", `Email sent to ${to}: ${subject}`);
    return { sent: true };
  } catch (e: any) {
    await log("ERROR", "EMAIL", `Failed to send email to ${to}: ${e?.message ?? e}`);
    return { sent: false, reason: e?.message ?? "SMTP error" };
  }
}

export async function sendTestEmail(to: string): Promise<{ sent: boolean; reason?: string }> {
  return sendAlertEmail({
    to,
    subject: "[FXQuant AI] Test Email — Alert System",
    body: `Ini adalah email test dari FXQuant AI Alert System.

Jika Anda menerima email ini, konfigurasi SMTP berfungsi dengan benar.

Sistem akan mengirim notifikasi ke alamat ini saat:
- Price alert ter-trigger (harga mencapai threshold)
- News alert match (keyword ditemukan di berita)
- Daily loss limit tercapai (Anti-MC)

Waktu: ${new Date().toISOString()}

— FXQuant AI Dashboard`,
  });
}
