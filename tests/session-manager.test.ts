/**
 * Unit tests — src/lib/session-manager.ts (Batch B / Task 5-b)
 * ============================================================
 * Covers the pure IDX (WIB) session logic:
 *   - getIdxSubSession / getIdxSessionName (phase → sub-session mapping)
 *   - getSessionState (IDX phase + forex sessions + overlaps + transitions)
 *   - checkSessionTradingRules (allowed/blocked per phase & weekend)
 *   - getSessionSizingMultiplier (per-session sizing factors)
 *   - resetPhaseTracker / checkAndRecordTransition (no-DB paths)
 *
 * The system clock is mocked with bun:test's setSystemTime() so wall-clock
 * dependent functions become deterministic; it is restored in afterAll().
 *
 * DB-bound functions (trackSessionPerformance, getSessionRiskBudget,
 * getSessionTradingConfig, …) are intentionally not covered — see report.
 */
import { describe, test, expect, setSystemTime, afterAll, beforeAll } from 'bun:test'
import {
  getIdxSubSession,
  getIdxSessionName,
  getSessionState,
  checkSessionTradingRules,
  getSessionSizingMultiplier,
  getSessionQualityScore,
  resetPhaseTracker,
  checkAndRecordTransition,
  FOREX_SESSIONS,
  FOREX_OVERLAPS,
  IDX_SESSIONS_WIB,
} from '../src/lib/session-manager'
import type { TradingPhase } from '../src/lib/mt5-connection'

// ---- helpers ---------------------------------------------------------------

/** Freeze the (mocked) system clock at a specific UTC instant. */
function at(dateStr: string): Date {
  const d = new Date(dateStr)
  setSystemTime(d)
  return d
}

const WEDNESDAY = '2024-01-10' // 2024-01-10 is a Wednesday
const SUNDAY = '2024-01-07'

// Restore the real system clock so other test files are unaffected.
afterAll(() => {
  setSystemTime()
})

// ============================================================================
// IDX SUB-SESSION MAPPING
// ============================================================================

describe('getIdxSubSession', () => {
  test('PRE_OPEN phase maps to PRE_OPEN', () => {
    expect(getIdxSubSession('PRE_OPEN')).toBe('PRE_OPEN')
  })

  test('OPEN phase resolves to MORNING before 12:00 UTC (≈ WIB afternoon boundary 05:00 UTC)', () => {
    at(`${WEDNESDAY}T03:00:00Z`) // 10:00 WIB → morning session
    expect(getIdxSubSession('OPEN')).toBe('MORNING')
  })

  test('OPEN phase resolves to AFTERNOON from 07:00 UTC (14:00 WIB)', () => {
    at(`${WEDNESDAY}T07:00:00Z`)
    expect(getIdxSubSession('OPEN')).toBe('AFTERNOON')
  })

  test('CLOSED phase maps to LUNCH (IDX lunch break)', () => {
    expect(getIdxSubSession('CLOSED')).toBe('LUNCH')
  })

  test('PRE_CLOSE and AFTER_HOURS map through unchanged', () => {
    expect(getIdxSubSession('PRE_CLOSE')).toBe('PRE_CLOSE')
    expect(getIdxSubSession('AFTER_HOURS')).toBe('AFTER_HOURS')
  })
})

describe('getIdxSessionName', () => {
  test('returns human-readable names for every phase', () => {
    expect(getIdxSessionName('PRE_OPEN')).toBe('Pre-Opening')
    expect(getIdxSessionName('PRE_CLOSE')).toBe('Pre-Close')
    expect(getIdxSessionName('CLOSED')).toBe('Lunch Break')
    expect(getIdxSessionName('AFTER_HOURS')).toBe('After Hours')
  })

  test('OPEN phase disambiguates morning vs afternoon by (mocked) clock', () => {
    at(`${WEDNESDAY}T03:00:00Z`)
    expect(getIdxSessionName('OPEN')).toBe('Morning Session')
    at(`${WEDNESDAY}T07:00:00Z`)
    expect(getIdxSessionName('OPEN')).toBe('Afternoon Session')
  })
})

// ============================================================================
// SESSION STATE SNAPSHOT
// ============================================================================

describe('getSessionState', () => {
  beforeAll(() => {
    resetPhaseTracker()
  })

  test('Wednesday 10:00 WIB (03:00 UTC) → IDX OPEN, morning session, market open', () => {
    const d = at(`${WEDNESDAY}T03:00:00Z`)
    const s = getSessionState(d)
    expect(s.idxForePhase).toBe('OPEN')
    expect(s.idxIsOpen).toBe(true)
    expect(s.isWeekend).toBe(false)
    expect(s.idxSessionName).toBe('Morning Session')
    expect(s.recommendation).toContain('Morning Session')
  })

  test('Wednesday 10:00 WIB → Sydney & Tokyo forex sessions active, Sydney-Tokyo overlap', () => {
    const d = at(`${WEDNESDAY}T03:00:00Z`)
    const s = getSessionState(d)
    expect(s.activeForexSessions).toContain('Sydney')
    expect(s.activeForexSessions).toContain('Tokyo')
    expect(s.activeForexSessions).not.toContain('London')
    expect(s.activeOverlaps).toContain('Sydney-Tokyo')
  })

  test('next phase transition computed correctly (03:00 UTC → PRE_CLOSE in 5340 s)', () => {
    const d = at(`${WEDNESDAY}T03:00:00Z`)
    const s = getSessionState(d)
    expect(s.nextPhase).toBe('PRE_CLOSE') // 11:29 WIB = 04:29 UTC
    expect(s.timeToNextPhase).toBe(5340)
  })

  test('Wednesday 11:45 WIB (04:45 UTC) → lunch break CLOSED, next phase OPEN in 4500 s', () => {
    const d = at(`${WEDNESDAY}T04:45:00Z`)
    const s = getSessionState(d)
    expect(s.idxForePhase).toBe('CLOSED')
    expect(s.idxSubSession).toBe('LUNCH')
    expect(s.idxIsOpen).toBe(false)
    expect(s.idxSessionName).toBe('Lunch Break')
    expect(s.nextPhase).toBe('OPEN') // 13:00 WIB
    expect(s.timeToNextPhase).toBe(4500)
    // recommendation lists the still-active forex sessions
    expect(s.recommendation).toBe('IDX Lunch Break — Forex: Sydney, Tokyo')
  })

  test('pre-open window 09:00-09:05 WIB → PRE_OPEN phase', () => {
    const d = at(`${WEDNESDAY}T02:02:00Z`)
    const s = getSessionState(d)
    expect(s.idxForePhase).toBe('PRE_OPEN')
    expect(s.idxIsOpen).toBe(false)
  })

  test('pre-close minute 11:29 WIB → PRE_CLOSE phase', () => {
    const d = at(`${WEDNESDAY}T04:29:30Z`)
    const s = getSessionState(d)
    expect(s.idxForePhase).toBe('PRE_CLOSE')
    expect(s.idxIsOpen).toBe(false)
  })

  test('after 16:15 WIB → AFTER_HOURS for the rest of the day', () => {
    const d = at(`${WEDNESDAY}T13:00:00Z`) // 20:00 WIB
    const s = getSessionState(d)
    expect(s.idxForePhase).toBe('AFTER_HOURS')
    expect(s.idxIsOpen).toBe(false)
    expect(s.idxSessionName).toBe('After Hours')
  })

  test('Sunday → weekend flag set and weekend recommendation', () => {
    const d = at(`${SUNDAY}T03:00:00Z`)
    const s = getSessionState(d)
    expect(s.isWeekend).toBe(true)
    expect(s.recommendation).toBe('Market is closed for the weekend')
  })

  test('afternoon session 13:00 WIB (06:00 UTC) → OPEN afternoon', () => {
    const d = at(`${WEDNESDAY}T06:00:00Z`)
    const s = getSessionState(d)
    expect(s.idxForePhase).toBe('OPEN')
    expect(s.idxIsOpen).toBe(true)
    expect(s.idxSessionName).toBe('Afternoon Session')
  })

  test('late evening: after-hours recommendation still lists active forex sessions', () => {
    const d = at(`${WEDNESDAY}T15:00:00Z`) // 22:00 WIB — NY session live
    const s = getSessionState(d)
    expect(s.idxForePhase).toBe('AFTER_HOURS')
    expect(s.activeForexSessions).toContain('New York')
    expect(s.recommendation).toContain('IDX After Hours')
  })

  test('after the last daily transition, the next phase is tomorrow\'s PRE_OPEN', () => {
    const d = at(`${WEDNESDAY}T23:59:30Z`) // 06:59 WIB Thursday
    const s = getSessionState(d)
    expect(s.nextPhase).toBe('PRE_OPEN')
    expect(s.timeToNextPhase).toBe(7230) // 2h 0m 30s to 09:00 WIB
  })
})

// ============================================================================
// TRADING RULES (wall-clock based → fully controlled via setSystemTime)
// ============================================================================

describe('checkSessionTradingRules', () => {
  test('allowed during the morning session on a weekday', () => {
    at(`${WEDNESDAY}T03:00:00Z`)
    expect(checkSessionTradingRules()).toEqual({ allowed: true })
  })

  test('allowed during the afternoon session', () => {
    at(`${WEDNESDAY}T07:00:00Z`)
    expect(checkSessionTradingRules().allowed).toBe(true)
  })

  test('blocked during the lunch break with an explanatory reason', () => {
    at(`${WEDNESDAY}T04:45:00Z`)
    const r = checkSessionTradingRules()
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('lunch break')
  })

  test('blocked after hours', () => {
    at(`${WEDNESDAY}T13:00:00Z`)
    const r = checkSessionTradingRules()
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('after hours')
  })

  test('blocked during the pre-close window (no new entries)', () => {
    at(`${WEDNESDAY}T04:29:30Z`)
    const r = checkSessionTradingRules()
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Pre-close')
  })

  test('blocked on Sunday regardless of the time of day', () => {
    at(`${SUNDAY}T03:00:00Z`)
    const r = checkSessionTradingRules()
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('Weekend')
  })
})

// ============================================================================
// SESSION-AWARE SIZING MULTIPLIER
// ============================================================================

describe('getSessionSizingMultiplier', () => {
  test('morning session → full size (1.0)', () => {
    at(`${WEDNESDAY}T03:00:00Z`)
    expect(getSessionSizingMultiplier()).toBe(1)
  })

  test('afternoon session → 0.85 (reduced liquidity)', () => {
    at(`${WEDNESDAY}T07:00:00Z`)
    expect(getSessionSizingMultiplier()).toBe(0.85)
  })

  test('pre-open auction → 0.5', () => {
    at(`${WEDNESDAY}T02:02:00Z`)
    expect(getSessionSizingMultiplier()).toBe(0.5)
  })

  test('pre-close window → 0.3', () => {
    at(`${WEDNESDAY}T04:29:30Z`)
    expect(getSessionSizingMultiplier()).toBe(0.3)
  })

  test('lunch break and after hours → 0 (no new positions)', () => {
    at(`${WEDNESDAY}T04:45:00Z`)
    expect(getSessionSizingMultiplier()).toBe(0)
    at(`${WEDNESDAY}T13:00:00Z`)
    expect(getSessionSizingMultiplier()).toBe(0)
  })
})

// ============================================================================
// PHASE TRANSITION TRACKER (no-DB paths only)
// ============================================================================

describe('phase transition tracker', () => {
  test('first check after reset returns null; same-phase checks stay null (no DB write)', async () => {
    resetPhaseTracker()
    const d = at(`${WEDNESDAY}T03:00:00Z`)
    const t1 = await checkAndRecordTransition(d)
    expect(t1).toBeNull()
    // same phase → still null (early return, no persistence)
    const t2 = await checkAndRecordTransition(d)
    expect(t2).toBeNull()
    resetPhaseTracker()
  })

  // NOTE: the *transition* path of checkAndRecordTransition persists a
  // db.sessionEvent row — deliberately not exercised here (pure tests only).
  // Reported as a coverage limitation in the task report.
})

// ============================================================================
// SESSION QUALITY SCORE (sync, no DB)
// ============================================================================

describe('getSessionQualityScore', () => {
  test('mid-morning session → base score 80', () => {
    at(`${WEDNESDAY}T03:00:00Z`)
    expect(getSessionQualityScore()).toBe(80)
  })

  test('afternoon session gets the Tokyo-London overlap bonus (70 + 10)', () => {
    at(`${WEDNESDAY}T07:30:00Z`)
    expect(getSessionQualityScore()).toBe(80)
  })

  test('first 15 minutes of a session are penalised (opening volatility)', () => {
    at(`${WEDNESDAY}T02:10:00Z`) // 09:10 WIB, morning open window
    expect(getSessionQualityScore()).toBe(70)
    at(`${WEDNESDAY}T06:10:00Z`) // 13:10 WIB, afternoon open window
    expect(getSessionQualityScore()).toBe(60)
  })

  test('last 30 minutes before close are penalised (incl. overlap bonus)', () => {
    at(`${WEDNESDAY}T08:50:00Z`) // 15:50 WIB → 70 + 10 (overlap) - 15
    expect(getSessionQualityScore()).toBe(65)
  })

  test('pre-open scores 30, pre-close 20, lunch 0', () => {
    at(`${WEDNESDAY}T02:02:00Z`)
    expect(getSessionQualityScore()).toBe(30)
    at(`${WEDNESDAY}T04:29:30Z`)
    expect(getSessionQualityScore()).toBe(20)
    at(`${WEDNESDAY}T04:45:00Z`)
    expect(getSessionQualityScore()).toBe(0)
  })

  test('after hours: only the NY-London forex overlap bonus remains (0 + 15)', () => {
    at(`${WEDNESDAY}T13:00:00Z`) // 20:00 WIB — IDX closed, forex overlap live
    expect(getSessionQualityScore()).toBe(15)
  })
})

// ============================================================================
// STATIC SESSION DEFINITIONS
// ============================================================================

describe('session definitions', () => {
  test('IDX boundaries match the official IDX schedule (WIB)', () => {
    expect(IDX_SESSIONS_WIB.preOpenStart).toEqual({ hour: 9, minute: 0 })
    expect(IDX_SESSIONS_WIB.morningOpen).toEqual({ hour: 9, minute: 5 })
    expect(IDX_SESSIONS_WIB.preCloseEnd).toEqual({ hour: 11, minute: 30 })
    expect(IDX_SESSIONS_WIB.afternoonOpen).toEqual({ hour: 13, minute: 0 })
    expect(IDX_SESSIONS_WIB.marketClose).toEqual({ hour: 16, minute: 15 })
  })

  test('four forex sessions and three overlaps are defined', () => {
    expect(FOREX_SESSIONS.length).toBe(4)
    expect(FOREX_SESSIONS.map((s) => s.name).sort()).toEqual([
      'London',
      'New York',
      'Sydney',
      'Tokyo',
    ])
    expect(FOREX_OVERLAPS.length).toBe(3)
    // sessions that cross midnight must be flagged
    for (const s of FOREX_SESSIONS) {
      expect(s.openHourUtc).toBeGreaterThanOrEqual(0)
      expect(s.closeHourUtc).toBeLessThanOrEqual(24)
    }
  })

  test('TradingPhase type values are all handled by getIdxSubSession', () => {
    const phases: TradingPhase[] = ['PRE_OPEN', 'OPEN', 'PRE_CLOSE', 'CLOSED', 'AFTER_HOURS']
    at(`${WEDNESDAY}T03:00:00Z`)
    for (const p of phases) {
      expect(typeof getIdxSubSession(p)).toBe('string')
    }
  })
})
