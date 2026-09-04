/**
 * Unit tests — pure formatting helpers from src/lib/notifier.ts
 * ==============================================================
 * Covers: severityPassesFilter (severity ordering), eventPassesFilter,
 * formatNotification (Telegram HTML escaping + Discord embeds),
 * escapeTelegramHtml.
 *
 * Only PURE functions are tested — notify()/sendTelegram()/sendDiscord()
 * hit the network and are intentionally excluded.
 */
import { describe, test, expect } from 'bun:test'
import {
  severityPassesFilter,
  eventPassesFilter,
  formatNotification,
  escapeTelegramHtml,
  type NotificationPayload,
  type NotificationSeverity,
  type NotificationEventType,
} from '../src/lib/notifier'

// ============================================
// severityPassesFilter
// ============================================

describe('severityPassesFilter', () => {
  const severities: NotificationSeverity[] = ['INFO', 'WARN', 'ERROR', 'CRITICAL']

  test('CRITICAL passes every minimum severity', () => {
    for (const min of severities) {
      expect(severityPassesFilter('CRITICAL', min)).toBe(true)
    }
  })

  test('INFO fails every minimum above INFO', () => {
    expect(severityPassesFilter('INFO', 'INFO')).toBe(true)
    expect(severityPassesFilter('INFO', 'WARN')).toBe(false)
    expect(severityPassesFilter('INFO', 'ERROR')).toBe(false)
    expect(severityPassesFilter('INFO', 'CRITICAL')).toBe(false)
  })

  test('severity ordering INFO < WARN < ERROR < CRITICAL', () => {
    // each severity passes at its own level…
    for (const s of severities) {
      expect(severityPassesFilter(s, s)).toBe(true)
    }
    // …and fails at every strictly-higher minimum
    for (let i = 0; i < severities.length; i++) {
      for (let j = i + 1; j < severities.length; j++) {
        expect(severityPassesFilter(severities[i], severities[j])).toBe(false)
      }
    }
    // …and passes at every lower-or-equal minimum
    for (let i = 0; i < severities.length; i++) {
      for (let j = 0; j <= i; j++) {
        expect(severityPassesFilter(severities[i], severities[j])).toBe(true)
      }
    }
  })
})

// ============================================
// eventPassesFilter
// ============================================

describe('eventPassesFilter', () => {
  test("'ALL' allows every event type", () => {
    const events: NotificationEventType[] = [
      'TRADE_OPENED',
      'TRADE_CLOSED',
      'RISK_EVENT',
      'CIRCUIT_BREAKER',
      'SYSTEM_ERROR',
      'SYSTEM_STARTUP',
      'SESSION_CHANGE',
      'TEST',
    ]
    for (const evt of events) {
      expect(eventPassesFilter(evt, 'ALL')).toBe(true)
    }
  })

  test('specific allow-lists match exactly', () => {
    const allowed: NotificationEventType[] = ['TRADE_OPENED', 'RISK_EVENT', 'TEST']
    expect(eventPassesFilter('TRADE_OPENED', allowed)).toBe(true)
    expect(eventPassesFilter('RISK_EVENT', allowed)).toBe(true)
    expect(eventPassesFilter('TEST', allowed)).toBe(true)
    expect(eventPassesFilter('TRADE_CLOSED', allowed)).toBe(false)
    expect(eventPassesFilter('SYSTEM_ERROR', allowed)).toBe(false)
  })

  test('empty allow-list rejects everything', () => {
    expect(eventPassesFilter('TRADE_CLOSED', [])).toBe(false)
    expect(eventPassesFilter('TEST', [])).toBe(false)
  })
})

// ============================================
// escapeTelegramHtml
// ============================================

describe('escapeTelegramHtml', () => {
  test("escapes & < > correctly", () => {
    expect(escapeTelegramHtml('& < >')).toBe('&amp; &lt; &gt;')
  })

  test('escapes every special char, leaves the rest untouched', () => {
    expect(escapeTelegramHtml('a&b<c>d')).toBe('a&amp;b&lt;c&gt;d')
    expect(escapeTelegramHtml('plain text 123')).toBe('plain text 123')
    expect(escapeTelegramHtml('quote " and apostrophe \'')).toBe("quote \" and apostrophe '")
  })

  test('escapes & first so entities are not double-escaped into new entities', () => {
    expect(escapeTelegramHtml('&lt;')).toBe('&amp;lt;')
  })
})

// ============================================
// formatNotification
// ============================================

const samplePayload: NotificationPayload = {
  eventType: 'TRADE_CLOSED',
  title: 'Trade <Closed>',
  body: 'Profit & loss report',
  severity: 'ERROR',
  fields: {
    symbol: 'BBCA',
    profit: 123.45,
    win: true,
  },
}

describe('formatNotification — telegram', () => {
  test('HTML parse mode with escaped title and body', () => {
    const formatted = formatNotification(samplePayload)
    expect(formatted.telegram.parseMode).toBe('HTML')

    const text = formatted.telegram.text
    // title and body are present AND html-escaped
    expect(text).toContain('Trade &lt;Closed&gt;')
    expect(text).toContain('Profit &amp; loss report')
    expect(text).not.toContain('Trade <Closed>')
    // no raw unescaped special chars from the payload remain
    expect(text).not.toContain('Profit & loss')
    // bold FRxAI header + event type footer
    expect(text).toContain('<b>FRxAI</b>')
    expect(text).toContain('TRADE_CLOSED')
  })

  test('fields are rendered as bold label + escaped value lines', () => {
    const text = formatNotification(samplePayload).telegram.text
    expect(text).toContain('<b>symbol:</b> BBCA')
    expect(text).toContain('<b>profit:</b> 123.45')
    expect(text).toContain('<b>win:</b> true')
  })

  test('null/undefined field values are omitted; numbers/booleans are stringified', () => {
    const text = formatNotification({
      eventType: 'TEST',
      title: 't',
      body: 'b',
      severity: 'INFO',
      fields: { keep: 'yes', dropNull: null, dropUndefined: undefined, num: 7, flag: false },
    }).telegram.text

    expect(text).toContain('<b>keep:</b> yes')
    expect(text).toContain('<b>num:</b> 7')
    expect(text).toContain('<b>flag:</b> false')
    expect(text).not.toContain('dropNull')
    expect(text).not.toContain('dropUndefined')
  })

  test('payload without fields produces no field lines', () => {
    const text = formatNotification({
      eventType: 'SYSTEM_STARTUP',
      title: 'startup',
      body: 'boot ok',
      severity: 'INFO',
    }).telegram.text
    expect(text).not.toMatch(/<b>[a-zA-Z0-9_]+:<\/b>/)
  })

  test('field keys and values are HTML-escaped too', () => {
    const text = formatNotification({
      eventType: 'TEST',
      title: 't',
      body: 'b',
      severity: 'WARN',
      fields: { 'weird&key': 'value<1>' },
    }).telegram.text
    expect(text).toContain('<b>weird&amp;key:</b> value&lt;1&gt;')
  })
})

describe('formatNotification — discord', () => {
  test('embed carries title, description, severity color, footer and fields', () => {
    const formatted = formatNotification(samplePayload)
    const discord = formatted.discord

    expect(formatted.discord.content).toContain('**FRxAI**')
    expect(formatted.discord.content).toContain('Trade <Closed>') // plain content, no HTML escaping needed
    expect(discord.embeds).toHaveLength(1)

    const embed = discord.embeds[0] as {
      title: string
      description: string
      color: number
      timestamp: string
      footer: { text: string }
      fields: Array<{ name: string; value: string; inline: boolean }>
    }

    expect(embed.title).toBe('Trade <Closed>')
    expect(embed.description).toBe('Profit & loss report')
    expect(embed.color).toBe(0xe74c3c) // ERROR severity color
    expect(Number.isNaN(Date.parse(embed.timestamp))).toBe(false)
    expect(embed.footer.text).toContain('TRADE_CLOSED')
    expect(embed.footer.text).toContain('ERROR')
    expect(embed.footer.text).toContain('FRxAI')

    expect(embed.fields).toHaveLength(3)
    expect(embed.fields[0]).toEqual({ name: 'symbol', value: 'BBCA', inline: true })
    expect(embed.fields[1]).toEqual({ name: 'profit', value: '123.45', inline: true })
    expect(embed.fields[2]).toEqual({ name: 'win', value: 'true', inline: true })
  })

  test('severity → color mapping for all severities', () => {
    const cases: Array<[NotificationSeverity, number]> = [
      ['INFO', 0x3498db],
      ['WARN', 0xf39c12],
      ['ERROR', 0xe74c3c],
      ['CRITICAL', 0xc0392b],
    ]
    for (const [severity, color] of cases) {
      const embed = formatNotification({ eventType: 'TEST', title: 't', body: 'b', severity }).discord
        .embeds[0] as { color: number }
      expect(embed.color).toBe(color)
    }
  })

  test('embed fields are capped at the Discord limit of 25', () => {
    const fields: Record<string, string> = {}
    for (let i = 0; i < 30; i++) fields[`f${String(i).padStart(2, '0')}`] = `v${i}`

    const embed = formatNotification({ eventType: 'TEST', title: 't', body: 'b', severity: 'INFO', fields })
      .discord.embeds[0] as { fields: Array<{ name: string }> }

    expect(embed.fields).toHaveLength(25)
    expect(embed.fields[0]?.name).toBe('f00')
    expect(embed.fields[24]?.name).toBe('f24')
    expect(embed.fields.some((f) => f.name === 'f25')).toBe(false)
  })

  test('payload without fields yields an empty embed field array', () => {
    const embed = formatNotification({ eventType: 'TEST', title: 't', body: 'b', severity: 'INFO' }).discord
      .embeds[0] as { fields: unknown[] }
    expect(embed.fields).toHaveLength(0)
  })

  test('long titles are truncated to the Discord limit (256 chars)', () => {
    const embed = formatNotification({
      eventType: 'TEST',
      title: 'x'.repeat(300),
      body: 'b',
      severity: 'INFO',
    }).discord.embeds[0] as { title: string }

    expect(embed.title.length).toBeLessThanOrEqual(256)
  })
})
