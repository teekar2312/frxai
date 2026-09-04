/**
 * FRxAI — Notification Dispatcher (Telegram + Discord)
 * ======================================================
 * Server-side notification pipeline:
 *
 *   Event producers ──> notify() ──> severity/event filters
 *                                     ├─> channel queue (in-memory)
 *                                     ├─> rate limiter (per channel)
 *                                     ├─> retry w/ backoff (retry.ts)
 *                                     └─> NotificationLog persistence
 *
 * Channels:
 *   - Telegram Bot API (sendMessage, MarkdownV2/HTML)
 *   - Discord Webhooks (rich embeds)
 *
 * Configuration sources (per channel, precedence):
 *   env creds (TELEGRAM_BOT_TOKEN/CHAT_ID, DISCORD_WEBHOOK_URL)
 *   → NotificationConfig DB rows (enable/disable, filters, budgets)
 *
 * All dispatch is fire-and-forget from producers' perspective:
 * notify() never throws — failures land in NotificationLog + logger.
 */

import { db } from './db'
import { env } from './env-validation'
import { getConfig } from './app-config'
import { retry, isTransientError } from './retry'
import logger, { LogCategory } from './trading-logger'

// ============================================
// TYPES
// ============================================

export type NotificationChannel = 'TELEGRAM' | 'DISCORD'
export type NotificationSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'

export type NotificationEventType =
  | 'TRADE_OPENED'
  | 'TRADE_CLOSED'
  | 'RISK_EVENT'
  | 'CIRCUIT_BREAKER'
  | 'SYSTEM_ERROR'
  | 'SYSTEM_STARTUP'
  | 'SESSION_CHANGE'
  | 'TEST'

export interface NotificationPayload {
  eventType: NotificationEventType
  title: string
  body: string
  severity: NotificationSeverity
  /** Structured fields appended to the message. */
  fields?: Record<string, string | number | boolean | null | undefined>
  /** Extra Telegram/Discord-specific overrides. */
  meta?: Record<string, unknown>
}

export interface NotificationDispatchResult {
  channel: NotificationChannel
  status: 'SENT' | 'FAILED' | 'SKIPPED'
  logId?: string
  error?: string
  attempts?: number
}

export interface ChannelRuntimeConfig {
  enabled: boolean
  target: string
  minSeverity: NotificationSeverity
  events: NotificationEventType[] | 'ALL'
  ratePerMin: number
  ratePerHour: number
}

// ============================================
// SEVERITY ORDERING & FILTERS
// ============================================

const SEVERITY_ORDER: Record<NotificationSeverity, number> = { INFO: 0, WARN: 1, ERROR: 2, CRITICAL: 3 }

export function severityPassesFilter(severity: NotificationSeverity, min: NotificationSeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[min]
}

export function eventPassesFilter(eventType: NotificationEventType, allowed: NotificationEventType[] | 'ALL'): boolean {
  if (allowed === 'ALL') return true
  return allowed.includes(eventType)
}

// ============================================
// CHANNEL CONFIG RESOLUTION (env → DB)
// ============================================

async function resolveChannelConfig(channel: NotificationChannel): Promise<ChannelRuntimeConfig | null> {
  const e = env()
  const masterEnabled = getConfig<boolean | undefined>('notifications.enabled')
  const globalMin = getConfig<NotificationSeverity>('notifications.minSeverity')

  let enabled: boolean
  let target: string
  let minSeverity = globalMin
  let events: NotificationEventType[] | 'ALL' = ['RISK_EVENT', 'CIRCUIT_BREAKER', 'TRADE_CLOSED', 'SYSTEM_ERROR', 'TEST']
  let ratePerMin = getConfig<number>('notifications.ratePerMin')
  let ratePerHour = getConfig<number>('notifications.ratePerHour')

  if (channel === 'TELEGRAM') {
    target = e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID ? `${e.TELEGRAM_CHAT_ID}` : ''
    enabled = Boolean(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID)
  } else {
    target = e.DISCORD_WEBHOOK_URL ?? ''
    enabled = Boolean(e.DISCORD_WEBHOOK_URL && e.DISCORD_WEBHOOK_URL.length > 0)
  }

  // Database layer overrides (NotificationConfig row)
  try {
    const row = await db.notificationConfig.findUnique({ where: { channel } })
    if (row) {
      enabled = row.enabled
      minSeverity = row.minSeverity as NotificationSeverity
      if (row.events) {
        try {
          const parsed = JSON.parse(row.events) as string[]
          events = parsed.includes('ALL') ? 'ALL' : (parsed as NotificationEventType[])
        } catch { /* keep default */ }
      }
      ratePerMin = row.rateLimitPerMin
      ratePerHour = row.rateLimitPerHour
      if (row.consecutiveErrors >= 10) {
        // Circuit-like protection: auto-disable after 10 consecutive errors
        enabled = false
      }
      if (channel === 'TELEGRAM' && row.chatId && !target) target = row.chatId
      if (channel === 'DISCORD' && row.webhookUrl && !target) target = row.webhookUrl
    }
  } catch (err) {
    logger.warn('NOTIFICATION' as LogCategory, `notifier: DB config load failed for ${channel}`, {
      details: err instanceof Error ? err.message : String(err),
    } as never)
  }

  if (masterEnabled === false) enabled = false
  if (masterEnabled === true && target) enabled = true

  if (!enabled || !target) return null
  return { enabled, target, minSeverity, events, ratePerMin, ratePerHour }
}

// ============================================
// OUTBOUND RATE LIMITING (per channel)
// ============================================

const channelWindows = new Map<NotificationChannel, { minute: number[]; hour: number[] }>()

function channelRateAllows(channel: NotificationChannel, cfg: ChannelRuntimeConfig): boolean {
  const now = Date.now()
  let w = channelWindows.get(channel)
  if (!w) {
    w = { minute: [], hour: [] }
    channelWindows.set(channel, w)
  }
  w.minute = w.minute.filter((t) => now - t < 60_000)
  w.hour = w.hour.filter((t) => now - t < 3_600_000)
  return w.minute.length < cfg.ratePerMin && w.hour.length < cfg.ratePerHour
}

function channelRateConsume(channel: NotificationChannel): void {
  const now = Date.now()
  const w = channelWindows.get(channel)
  if (w) {
    w.minute.push(now)
    w.hour.push(now)
  }
}

export function resetChannelRateWindows(): void {
  channelWindows.clear()
}

// ============================================
// MESSAGE FORMATTERS (pure — unit tested)
// ============================================

export interface FormattedMessage {
  telegram: { text: string; parseMode: 'HTML' }
  discord: { embeds: Array<Record<string, unknown>>; content?: string }
}

const SEVERITY_EMOJI: Record<NotificationSeverity, string> = {
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '🔴',
  CRITICAL: '🚨',
}

/** Escape Telegram HTML special chars. */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Format a payload for both channels (pure function). */
export function formatNotification(payload: NotificationPayload): FormattedMessage {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const emoji = SEVERITY_EMOJI[payload.severity] ?? 'ℹ️'
  const fields = payload.fields ?? {}
  const fieldLines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `<b>${escapeTelegramHtml(String(k))}:</b> ${escapeTelegramHtml(String(v))}`)

  // --- Telegram (HTML parse mode — safest with escaping) ---
  const tgText = [
    `${emoji} <b>FRxAI</b> — ${escapeTelegramHtml(payload.title)}`,
    '',
    escapeTelegramHtml(payload.body),
    ...(fieldLines.length > 0 ? ['', ...fieldLines] : []),
    '',
    `<i>${stamp} · ${payload.eventType}</i>`,
  ].join('\n')

  // --- Discord (rich embed) ---
  const embedFields = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, 25) // Discord embed field cap
    .map(([k, v]) => ({ name: String(k).slice(0, 256), value: String(v).slice(0, 1024), inline: true }))

  const colorMap: Record<NotificationSeverity, number> = {
    INFO: 0x3498db,
    WARN: 0xf39c12,
    ERROR: 0xe74c3c,
    CRITICAL: 0xc0392b,
  }

  const discord = {
    content: `${emoji} **FRxAI** — ${payload.title}`,
    embeds: [
      {
        title: payload.title.slice(0, 256),
        description: payload.body.slice(0, 4096),
        color: colorMap[payload.severity] ?? 0x3498db,
        timestamp: new Date().toISOString(),
        footer: { text: `FRxAI · ${payload.eventType} · ${payload.severity}` },
        fields: embedFields,
      },
    ],
  }

  return { telegram: { text: tgText, parseMode: 'HTML' }, discord }
}

// ============================================
// TRANSPORTS (with retry on transient failures)
// ============================================

async function sendTelegram(target: string, text: string, parseMode: 'HTML'): Promise<void> {
  const token = env().TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing')
  await retry(
    async () => {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: target, text, parse_mode: parseMode, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = new Error(`Telegram API ${res.status}: ${body.slice(0, 300)}`)
        ;(err as { status?: number }).status = res.status
        throw err
      }
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 15_000,
      jitterRatio: 0.5,
      isRetryable: (err) => isTransientError(err) || (err instanceof Error && /\b(429|500|502|503|504)\b/.test(err.message)),
    }
  )
}

async function sendDiscord(webhookUrl: string, body: unknown): Promise<void> {
  await retry(
    async () => {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => '')
        const err = new Error(`Discord webhook ${res.status}: ${text.slice(0, 300)}`)
        ;(err as { status?: number }).status = res.status
        throw err
      }
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 15_000,
      jitterRatio: 0.5,
      isRetryable: (err) => isTransientError(err) || (err instanceof Error && /\b(429|500|502|503|504)\b/.test(err.message)),
    }
  )
}

// ============================================
// DISPATCH PIPELINE
// ============================================

async function persistLog(channel: NotificationChannel, target: string, payload: NotificationPayload, formatted: unknown): Promise<string | undefined> {
  try {
    const row = await db.notificationLog.create({
      data: {
        channel,
        channelTarget: channel === 'TELEGRAM' ? String(target).slice(0, 16) : 'webhook',
        eventType: payload.eventType,
        title: payload.title.slice(0, 200),
        body: payload.body.slice(0, 2000),
        severity: payload.severity,
        status: 'PENDING',
        payload: JSON.stringify(formatted).slice(0, 20_000),
      },
    })
    return row.id
  } catch (err) {
    logger.warn('NOTIFICATION' as LogCategory, 'notifier: failed to persist log', {
      details: err instanceof Error ? err.message : String(err),
    } as never)
    return undefined
  }
}

async function updateLog(logId: string | undefined, patch: { status: string; attempts?: number; lastError?: string | null; sentAt?: Date }): Promise<void> {
  if (!logId) return
  try {
    await db.notificationLog.update({ where: { id: logId }, data: { ...patch, ...(patch.status === 'SENT' ? { sentAt: patch.sentAt ?? new Date() } : {}) } })
  } catch { /* best effort */ }
}

/**
 * Dispatch a notification to all configured channels.
 * Never throws. Returns per-channel results.
 */
export async function notify(payload: NotificationPayload): Promise<NotificationDispatchResult[]> {
  const channels: NotificationChannel[] = ['TELEGRAM', 'DISCORD']
  const results: NotificationDispatchResult[] = []

  for (const channel of channels) {
    try {
      const cfg = await resolveChannelConfig(channel)
      if (!cfg) {
        results.push({ channel, status: 'SKIPPED', error: 'Channel disabled or not configured' })
        continue
      }

      if (!severityPassesFilter(payload.severity, cfg.minSeverity)) {
        results.push({ channel, status: 'SKIPPED', error: `Severity ${payload.severity} below minimum ${cfg.minSeverity}` })
        continue
      }
      if (!eventPassesFilter(payload.eventType, cfg.events)) {
        results.push({ channel, status: 'SKIPPED', error: `Event ${payload.eventType} not subscribed` })
        continue
      }
      if (!channelRateAllows(channel, cfg)) {
        results.push({ channel, status: 'SKIPPED', error: 'Outbound rate limit reached' })
        continue
      }

      const formatted = formatNotification(payload)
      const logId = await persistLog(channel, cfg.target, payload, formatted)

      let attempts = 0
      try {
        if (channel === 'TELEGRAM') {
          await sendTelegram(cfg.target, formatted.telegram.text, formatted.telegram.parseMode)
        } else {
          await sendDiscord(cfg.target, formatted.discord)
        }
        attempts = 1
        channelRateConsume(channel)
        await updateLog(logId, { status: 'SENT', attempts: 1 })
        // Reset consecutive error counter
        try {
          await db.notificationConfig.update({ where: { channel }, data: { consecutiveErrors: 0, lastSentAt: new Date(), lastError: null } })
        } catch { /* row may not exist */ }
        results.push({ channel, status: 'SENT', logId, attempts: 1 })
      } catch (err) {
        attempts = 1
        const msg = err instanceof Error ? err.message : String(err)
        await updateLog(logId, { status: 'FAILED', attempts, lastError: msg.slice(0, 500) })
        try {
          await db.notificationConfig.update({ where: { channel }, data: { consecutiveErrors: { increment: 1 }, lastError: msg.slice(0, 500) } })
        } catch { /* row may not exist */ }
        logger.error('NOTIFICATION' as LogCategory, `notifier: ${channel} dispatch failed`, { details: msg } as never)
        results.push({ channel, status: 'FAILED', logId, error: msg, attempts })
      }
    } catch (err) {
      // resolveChannelConfig or unexpected failures — never propagate
      results.push({ channel, status: 'FAILED', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return results
}

/** Fire-and-forget variant for hot paths (trade execution, risk engine). */
export function notifyAsync(payload: NotificationPayload): void {
  void notify(payload).catch(() => { /* swallow — logged inside notify */ })
}

// ============================================
// CONFIG API HELPERS
// ============================================

/** Upsert channel config (admin UI). */
export async function updateChannelConfig(
  channel: NotificationChannel,
  patch: Partial<{ enabled: boolean; chatId: string; webhookUrl: string; botToken: string; minSeverity: string; events: string[] }>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const data: Record<string, unknown> = {}
    if (patch.enabled !== undefined) data.enabled = patch.enabled
    if (patch.chatId !== undefined) data.chatId = patch.chatId
    if (patch.webhookUrl !== undefined) data.webhookUrl = patch.webhookUrl
    if (patch.botToken !== undefined) data.botToken = patch.botToken
    if (patch.minSeverity !== undefined) data.minSeverity = patch.minSeverity
    if (patch.events !== undefined) data.events = JSON.stringify(patch.events)
    if (Object.keys(data).length === 0) return { ok: false, error: 'No fields to update' }

    await db.notificationConfig.upsert({
      where: { channel },
      create: { channel, ...data } as never,
      update: data as never,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Send a TEST notification through configured channels (admin UI button). */
export async function sendTestNotification(): Promise<NotificationDispatchResult[]> {
  return notify({
    eventType: 'TEST',
    title: 'Test Notification',
    body: 'This is a test message from FRxAI. If you can read this, your notification channel is working correctly.',
    severity: 'INFO',
    fields: { server_time: new Date().toISOString(), version: 'v2.0' },
  })
}

// ============================================
// BACKGROUND LOG RETENTION
// ============================================

/** Clean old notification logs (called from logger rotation cycle). */
export async function cleanupNotificationLogs(retentionDays: number): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000)
    const res = await db.notificationLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
    return res.count
  } catch {
    return 0
  }
}
