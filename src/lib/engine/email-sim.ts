// ============================================================
// Email notification simulation (DEMO mode)
// Real delivery is replaced by a LogEntry so the dashboard's
// notification center shows the same flow without SMTP.
// ============================================================

import { db } from '@/lib/db'

function parseCsv(s: string | null | undefined): string[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

/**
 * Simulate sending an email for `event` (e.g. 'trade_open', 'alert', ...).
 * Only writes a log when email notifications are enabled AND the event
 * is subscribed in settings.emailEvents. Never throws.
 */
export async function simulateEmailSend(event: string, subject: string, body: string): Promise<void> {
  try {
    const s = await db.settings.findUnique({ where: { id: 'main' } })
    if (!s || !s.emailEnabled) return
    const events = parseCsv(s.emailEvents)
    if (!events.includes(event)) return
    await db.logEntry.create({
      data: {
        level: 'INFO',
        category: 'EMAIL',
        message: `[EMAIL-SIM] ${event}: ${subject}`,
        details: body.slice(0, 2000),
      },
    })
  } catch {
    // notification simulation must never break the trading flow
  }
}
