import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSimulator } from '@/lib/engine/simulator'
import { simulateEmailSend } from '@/lib/engine/email-sim'

export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/notify — body { action: 'test' }
// Sends a demo-mode test notification (email simulation).
// ============================================================

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { action?: unknown } | null
    if (!body || body.action !== 'test') {
      return NextResponse.json({ error: "Invalid action — expected { action: 'test' }" }, { status: 400 })
    }

    const sim = getSimulator()
    const settings = await sim.getSettings()
    if (!settings.emailEnabled) {
      return NextResponse.json({ error: 'Email notifications disabled — enable in Settings' }, { status: 400 })
    }

    // Compose the test body: account snapshot + open positions
    const account = await sim.getAccount()
    const positions = await sim.getPositions()
    const lines = [
      'FINEX AI Trading System — Test Notification',
      '',
      `Account : ${account.login} (${account.server})`,
      `Mode    : ${account.mode} | Leverage 1:${account.leverage}`,
      `Balance : $${account.balance.toFixed(2)}`,
      `Equity  : $${account.equity.toFixed(2)}`,
      `Floating: $${account.floatingPnl.toFixed(2)} | Daily: $${account.dailyPnl.toFixed(2)} (${account.dailyPnlPct.toFixed(2)}%)`,
      '',
      `Open positions: ${positions.length}`,
    ]
    if (positions.length === 0) {
      lines.push('(no open positions)')
    } else {
      for (const p of positions.slice(0, 10)) {
        lines.push(`- ${p.pair} ${p.side} ${p.volume} lot @ ${p.openPrice} → PnL $${p.profit.toFixed(2)} (${p.pips.toFixed(1)} pips)`)
      }
      if (positions.length > 10) lines.push(`... and ${positions.length - 10} more`)
    }
    lines.push('', `Time: ${new Date().toISOString()}`)

    const subject = 'FINEX AI — Test Notification'
    const emailBody = lines.join('\n')

    // Demo-mode delivery: the simulator's email simulation (never throws).
    await simulateEmailSend('test', subject, emailBody)

    // 'test' is a user-initiated event and is not part of the configurable
    // emailEvents list, so make sure the test is always visible in the Logs /
    // notification center (skip when simulateEmailSend already logged it).
    if (!settings.emailEvents.includes('test')) {
      await db.logEntry.create({
        data: {
          level: 'INFO',
          category: 'EMAIL',
          message: `[EMAIL-SIM] test: ${subject}`,
          details: emailBody.slice(0, 2000),
        },
      })
    }

    return NextResponse.json({
      success: true,
      note: 'Email simulation logged (demo mode) — real SMTP sending runs in the Python engine on your PC',
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'notify failed' }, { status: 500 })
  }
}
