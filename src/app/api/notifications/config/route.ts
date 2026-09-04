/**
 * /api/notifications/config — Channel configuration
 * ====================================================
 * GET  — current Telegram/Discord channel state (credentials masked)
 * PUT  — update channel config (enable/disable, severity filter, events, targets)
 *
 * Body (PUT):
 *   { channel: 'TELEGRAM' | 'DISCORD',
 *     enabled?: boolean, chatId?: string, webhookUrl?: string, botToken?: string,
 *     minSeverity?: 'INFO'|'WARN'|'ERROR'|'CRITICAL', events?: string[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/lib/env-validation'
import { updateChannelConfig } from '@/lib/notifier'
import { rateLimitGuard } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const guard = rateLimitGuard('WRITE')

function maskSecret(s: string | null | undefined): string {
  if (!s) return ''
  if (s.length <= 8) return '****'
  return `${s.slice(0, 4)}...${s.slice(-4)}`
}

export async function GET(request: NextRequest) {
  const limited = guard(request)
  if (limited) return limited

  try {
    const [tgRow, dcRow] = await Promise.all([
      db.notificationConfig.findUnique({ where: { channel: 'TELEGRAM' } }),
      db.notificationConfig.findUnique({ where: { channel: 'DISCORD' } }),
    ])
    const e = env()

    const telegram = {
      channel: 'TELEGRAM',
      envConfigured: Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
      tokenPreview: maskSecret(e.TELEGRAM_BOT_TOKEN),
      chatId: tgRow?.chatId ?? e.TELEGRAM_CHAT_ID ?? null,
      enabled: tgRow?.enabled ?? Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
      minSeverity: tgRow?.minSeverity ?? e.NOTIFY_MIN_SEVERITY,
      events: (() => {
        try { return JSON.parse(tgRow?.events ?? '[]') as string[] } catch { return [] }
      })(),
      rateLimitPerMin: tgRow?.rateLimitPerMin ?? e.NOTIFY_RATE_PER_MIN,
      consecutiveErrors: tgRow?.consecutiveErrors ?? 0,
      lastError: tgRow?.lastError ?? null,
      lastSentAt: tgRow?.lastSentAt ?? null,
    }

    const discord = {
      channel: 'DISCORD',
      envConfigured: Boolean(e.DISCORD_WEBHOOK_URL),
      webhookPreview: maskSecret(e.DISCORD_WEBHOOK_URL),
      enabled: dcRow?.enabled ?? Boolean(e.DISCORD_WEBHOOK_URL),
      minSeverity: dcRow?.minSeverity ?? e.NOTIFY_MIN_SEVERITY,
      events: (() => {
        try { return JSON.parse(dcRow?.events ?? '[]') as string[] } catch { return [] }
      })(),
      rateLimitPerMin: dcRow?.rateLimitPerMin ?? e.NOTIFY_RATE_PER_MIN,
      consecutiveErrors: dcRow?.consecutiveErrors ?? 0,
      lastError: dcRow?.lastError ?? null,
      lastSentAt: dcRow?.lastSentAt ?? null,
    }

    return NextResponse.json({ success: true, data: { telegram, discord } })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : 'Failed to load config' } },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const limited = guard(request)
  if (limited) return limited

  try {
    const body = (await request.json()) as Record<string, unknown>
    const channel = String(body.channel ?? '').toUpperCase()
    if (channel !== 'TELEGRAM' && channel !== 'DISCORD') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_CHANNEL', message: 'channel must be TELEGRAM or DISCORD' } },
        { status: 400 }
      )
    }

    const patch: Parameters<typeof updateChannelConfig>[1] = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (typeof body.chatId === 'string' && body.chatId.trim()) patch.chatId = body.chatId.trim()
    if (typeof body.webhookUrl === 'string' && body.webhookUrl.trim()) {
      try {
        new URL(body.webhookUrl.trim())
        patch.webhookUrl = body.webhookUrl.trim()
      } catch {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_URL', message: 'webhookUrl is not a valid URL' } },
          { status: 400 }
        )
      }
    }
    if (typeof body.botToken === 'string' && body.botToken.trim()) patch.botToken = body.botToken.trim()
    if (typeof body.minSeverity === 'string' && ['INFO', 'WARN', 'ERROR', 'CRITICAL'].includes(body.minSeverity)) {
      patch.minSeverity = body.minSeverity
    }
    if (Array.isArray(body.events)) {
      const valid = ['TRADE_OPENED', 'TRADE_CLOSED', 'RISK_EVENT', 'CIRCUIT_BREAKER', 'SYSTEM_ERROR', 'SYSTEM_STARTUP', 'SESSION_CHANGE', 'TEST', 'ALL']
      const events = body.events.map(String).filter((e) => valid.includes(e))
      patch.events = events
    }

    const result = await updateChannelConfig(channel, patch)
    if (!result.ok) {
      return NextResponse.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error } }, { status: 400 })
    }
    return NextResponse.json({ success: true, data: { channel, updated: patch } })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: err instanceof Error ? err.message : 'Invalid request body' } },
      { status: 400 }
    )
  }
}
