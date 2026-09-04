/**
 * Unit tests for trading-logger rotation & level state + weekend market awareness
 * (pure state functions only — DB flush paths are out of scope).
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  setRetentionDays,
  setMt5LogRetentionDays,
  setNewsLogRetentionDays,
  getRotationSettings,
  setMinLevel,
  getMinLevel,
} from '../src/lib/trading-logger'
import { getTradingPhase, isMarketOpen } from '../src/lib/mt5-connection'

describe('log rotation settings (env-driven, runtime-overridable)', () => {
  test('getRotationSettings exposes the current retention values', () => {
    const s = getRotationSettings()
    expect(s.retentionDays).toBeGreaterThanOrEqual(1)
    expect(s.mt5LogRetentionDays).toBeGreaterThanOrEqual(1)
    expect(s.newsLogRetentionDays).toBeGreaterThanOrEqual(1)
    expect(s.cleanupIntervalHours).toBeGreaterThanOrEqual(1)
    expect(s.totalDeleted).toBeGreaterThanOrEqual(0)
  })

  test('setRetentionDays updates TradingLog retention (valid input)', () => {
    setRetentionDays(45)
    expect(getRotationSettings().retentionDays).toBe(45)
    // restore
    setRetentionDays(30)
    expect(getRotationSettings().retentionDays).toBe(30)
  })

  test('setRetentionDays rejects invalid input (NaN / < 1 / fractional)', () => {
    const before = getRotationSettings().retentionDays
    setRetentionDays(Number.NaN)
    expect(getRotationSettings().retentionDays).toBe(before)
    setRetentionDays(0)
    expect(getRotationSettings().retentionDays).toBe(before)
    setRetentionDays(-5)
    expect(getRotationSettings().retentionDays).toBe(before)
    setRetentionDays(7.9) // fractional → floored to 7
    expect(getRotationSettings().retentionDays).toBe(7)
    setRetentionDays(before)
  })

  test('setMt5LogRetentionDays & setNewsLogRetentionDays update their own lanes', () => {
    setMt5LogRetentionDays(14)
    setNewsLogRetentionDays(21)
    const s = getRotationSettings()
    expect(s.mt5LogRetentionDays).toBe(14)
    expect(s.newsLogRetentionDays).toBe(21)
    // independent lanes
    expect(s.retentionDays).toBeGreaterThanOrEqual(1)
    // restore
    setMt5LogRetentionDays(7)
    setNewsLogRetentionDays(14)
  })
})

describe('minimum log level', () => {
  test('getMinLevel returns a valid level; setMinLevel applies', () => {
    const original = getMinLevel()
    setMinLevel('ERROR')
    expect(getMinLevel()).toBe('ERROR')
    setMinLevel(original)
  })
})

describe('IDX weekend market awareness', () => {
  // 2026-09-06 is a Sunday; 2026-09-04 is a Friday
  test('Sunday during trading hours → CLOSED (weekend)', () => {
    // 10:00 WIB = 03:00 UTC on Sunday
    const sunday = new Date('2026-09-06T03:00:00Z')
    expect(getTradingPhase(sunday)).toBe('CLOSED')
    expect(isMarketOpen(sunday)).toBe(false)
  })

  test('Saturday during trading hours → CLOSED (weekend)', () => {
    const saturday = new Date('2026-09-05T03:00:00Z')
    expect(getTradingPhase(saturday)).toBe('CLOSED')
    expect(isMarketOpen(saturday)).toBe(false)
  })

  test('Friday during Session 1 → OPEN', () => {
    const friday = new Date('2026-09-04T03:00:00Z')
    expect(getTradingPhase(friday)).toBe('OPEN')
    expect(isMarketOpen(friday)).toBe(true)
  })
})
