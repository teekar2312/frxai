/**
 * Unit tests — CircuitBreaker (from src/lib/mt5-connection.ts)
 * =============================================================
 * Tests the pure CircuitBreaker class state machine:
 *   CLOSED → OPEN (threshold), OPEN → HALF_OPEN (recovery timeout),
 *   HALF_OPEN → CLOSED (probe success) / OPEN (probe failure),
 *   halfOpenMaxAttempts concurrency guard, reset(), trip(),
 *   snapshot()/restore() round-trip & age-aware restore.
 *
 * NOTE: importing mt5-connection also wires db/env-validation side effects
 * (scheduleCircuitBreakerRestore runs in the background) — irrelevant here;
 * all tests use local breakers built WITHOUT onStateChange so the DB is
 * never touched by the class under test.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { CircuitBreaker, CircuitBreakerOpenError } from '../src/lib/mt5-connection'

// ============================================
// helpers
// ============================================

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Fast breaker: trips after 3 failures, recovers after 50ms, 1 probe. */
function makeBreaker(): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: 3,
    recoveryTimeoutMs: 50,
    halfOpenMaxAttempts: 1,
  })
}

async function fail(cb: CircuitBreaker): Promise<void> {
  await expect(cb.execute(async () => { throw new Error('fail') })).rejects.toThrow('fail')
}

async function succeed(cb: CircuitBreaker, value = 'ok'): Promise<void> {
  await expect(cb.execute(async () => value)).resolves.toBe(value)
}

/** A promise that never settles — used to hold HALF_OPEN probes in flight. */
const never = (): Promise<never> => new Promise<never>(() => {})

beforeEach(() => {
  // fresh breakers per test; module-level side effects are left alone
})

// ============================================
// CLOSED state
// ============================================

describe('CircuitBreaker — CLOSED', () => {
  test('starts CLOSED with zeroed counters and a CLOSED snapshot', () => {
    const cb = makeBreaker()
    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(0)
    expect(cb.successCount).toBe(0)
    const snap = cb.snapshot()
    expect(snap.state).toBe('CLOSED')
    expect(snap.openedAt).toBeNull()
    expect(snap.halfOpenAttempts).toBe(0)
  })

  test('successes keep the breaker CLOSED and increment successCount', async () => {
    const cb = makeBreaker()
    await succeed(cb)
    await succeed(cb)
    await succeed(cb)
    expect(cb.state).toBe('CLOSED')
    expect(cb.successCount).toBe(3)
    expect(cb.failureCount).toBe(0)
  })

  test('a success resets the failure counter while CLOSED', async () => {
    const cb = makeBreaker()
    await fail(cb)
    await fail(cb) // 2 < threshold 3 → still CLOSED
    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(2)
    await succeed(cb)
    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(0)
    expect(cb.successCount).toBe(1)
  })

  test('execute propagates async rejections and counts them as failures', async () => {
    const cb = makeBreaker()
    await expect(cb.execute(async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(cb.failureCount).toBe(1)
    expect(cb.state).toBe('CLOSED')
  })
})

// ============================================
// OPEN transitions
// ============================================

describe('CircuitBreaker — OPEN', () => {
  test('reaching the failure threshold trips the breaker to OPEN', async () => {
    const cb = makeBreaker()
    await fail(cb)
    await fail(cb)
    expect(cb.state).toBe('CLOSED')
    await fail(cb)
    expect(cb.state).toBe('OPEN')
    expect(cb.failureCount).toBe(3)
  })

  test('execute while OPEN rejects with CircuitBreakerOpenError and never calls fn', async () => {
    const cb = makeBreaker()
    for (let i = 0; i < 3; i++) await fail(cb)
    expect(cb.state).toBe('OPEN')

    let calls = 0
    let thrown: unknown
    try {
      await cb.execute(async () => { calls++; return 'never' })
    } catch (err) {
      thrown = err
    }

    expect(calls).toBe(0) // rejected before invoking fn
    expect(thrown).toBeInstanceOf(CircuitBreakerOpenError)
    const err = thrown as CircuitBreakerOpenError
    expect(err.name).toBe('CircuitBreakerOpenError')
    expect(err.state).toBe('OPEN')
    expect(err.failureCount).toBe(3)
    expect(err.nextRetryAt.getTime()).toBeGreaterThan(Date.now() - 10)
    expect(err.message).toContain('OPEN')
  })

  test('recovery timeout elapses → HALF_OPEN → successful probe closes the circuit', async () => {
    const cb = makeBreaker()
    for (let i = 0; i < 3; i++) await fail(cb)
    expect(cb.state).toBe('OPEN')

    await sleep(75) // > recoveryTimeoutMs 50
    expect(cb.state).toBe('HALF_OPEN')

    await succeed(cb, 'probe')
    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(0)
    expect(cb.successCount).toBe(1) // probe success counted
    // normal traffic flows again
    await succeed(cb)
    expect(cb.state).toBe('CLOSED')
  })

  test('HALF_OPEN probe failure re-opens the circuit with a fresh openedAt', async () => {
    const cb = makeBreaker()
    for (let i = 0; i < 3; i++) await fail(cb)
    await sleep(75)
    expect(cb.state).toBe('HALF_OPEN')

    await fail(cb) // probe fails
    expect(cb.state).toBe('OPEN')
    expect(cb.failureCount).toBe(4)

    // immediately after re-opening, calls are rejected again
    await expect(cb.execute(async () => 'x')).rejects.toBeInstanceOf(CircuitBreakerOpenError)
  })

  test('halfOpenMaxAttempts=1: a second concurrent HALF_OPEN attempt is rejected', async () => {
    const cb = makeBreaker()
    for (let i = 0; i < 3; i++) await fail(cb)
    await sleep(75)
    expect(cb.state).toBe('HALF_OPEN')

    // hold the single allowed probe in flight
    const pending = cb.execute(never)
    await expect(cb.execute(async () => 'second')).rejects.toBeInstanceOf(CircuitBreakerOpenError)
    void pending // intentionally never settles
  })

  test('halfOpenMaxAttempts=2: two concurrent probes allowed, third rejected', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 50, halfOpenMaxAttempts: 2 })
    await fail(cb)
    await fail(cb)
    expect(cb.state).toBe('OPEN')
    await sleep(75)
    expect(cb.state).toBe('HALF_OPEN')

    const p1 = cb.execute(never)
    const p2 = cb.execute(never) // second concurrent probe is allowed
    await expect(cb.execute(async () => 'third')).rejects.toBeInstanceOf(CircuitBreakerOpenError)
    void p1
    void p2
  })

  test('default config trips after 5 failures', async () => {
    const cb = new CircuitBreaker()
    for (let i = 0; i < 4; i++) await fail(cb)
    expect(cb.state).toBe('CLOSED')
    await fail(cb)
    expect(cb.state).toBe('OPEN')
  })
})

// ============================================
// manual controls
// ============================================

describe('CircuitBreaker — reset() / trip()', () => {
  test('reset() returns the breaker to a pristine CLOSED state', async () => {
    const cb = makeBreaker()
    for (let i = 0; i < 3; i++) await fail(cb)
    expect(cb.state).toBe('OPEN')

    cb.reset()
    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(0)
    expect(cb.successCount).toBe(0)
    expect(cb.snapshot().openedAt).toBeNull()
    await succeed(cb) // immediately usable again
    expect(cb.successCount).toBe(1)
  })

  test('trip() manually opens the breaker without counting a failure', async () => {
    const cb = makeBreaker()
    cb.trip()
    expect(cb.state).toBe('OPEN')
    expect(cb.failureCount).toBe(0)
    await expect(cb.execute(async () => 'x')).rejects.toBeInstanceOf(CircuitBreakerOpenError)
  })
})

// ============================================
// snapshot / restore
// ============================================

describe('CircuitBreaker — snapshot()', () => {
  test('snapshot shape: state, counters, ISO timestamps', async () => {
    const cb = makeBreaker()
    await fail(cb)
    await fail(cb)

    const snap = cb.snapshot()
    expect(snap.state).toBe('CLOSED')
    expect(snap.failureCount).toBe(2)
    expect(snap.successCount).toBe(0)
    expect(snap.halfOpenAttempts).toBe(0)
    expect(snap.openedAt).toBeNull()
    expect(Number.isNaN(Date.parse(snap.capturedAt))).toBe(false)
    expect(Math.abs(Date.parse(snap.capturedAt) - Date.now())).toBeLessThan(5000)
  })

  test('snapshot of an OPEN breaker carries a valid ISO openedAt', async () => {
    const cb = makeBreaker()
    for (let i = 0; i < 3; i++) await fail(cb)
    const snap = cb.snapshot()
    expect(snap.state).toBe('OPEN')
    expect(snap.openedAt).not.toBeNull()
    expect(Number.isNaN(Date.parse(String(snap.openedAt)))).toBe(false)
    expect(Math.abs(Date.parse(String(snap.openedAt)) - Date.now())).toBeLessThan(5000)
  })
})

describe('CircuitBreaker — restore()', () => {
  test('fresh OPEN snapshot → stays OPEN and rejects calls', async () => {
    const cb = makeBreaker()
    cb.restore({
      state: 'OPEN',
      failureCount: 2,
      successCount: 0,
      halfOpenAttempts: 0,
      openedAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
    })

    expect(cb.state).toBe('OPEN')
    expect(cb.failureCount).toBe(2)
    await expect(cb.execute(async () => 'x')).rejects.toBeInstanceOf(CircuitBreakerOpenError)
  })

  test('expired OPEN snapshot (older than recoveryTimeout) → HALF_OPEN', async () => {
    const cb = makeBreaker()
    cb.restore({
      state: 'OPEN',
      failureCount: 3,
      successCount: 0,
      halfOpenAttempts: 0,
      openedAt: new Date(Date.now() - 5000).toISOString(), // way past 50ms recovery
      capturedAt: new Date().toISOString(),
    })

    expect(cb.state).toBe('HALF_OPEN')
    await succeed(cb, 'probe') // probe allowed & closes the circuit
    expect(cb.state).toBe('CLOSED')
  })

  test('CLOSED snapshot with failures restores the failure counter', async () => {
    const cb = makeBreaker()
    cb.restore({
      state: 'CLOSED',
      failureCount: 5,
      successCount: 2,
      halfOpenAttempts: 0,
      openedAt: null,
      capturedAt: new Date().toISOString(),
    })

    expect(cb.state).toBe('CLOSED')
    expect(cb.failureCount).toBe(5)
    expect(cb.successCount).toBe(2)
    await fail(cb) // 6 >= threshold 3 → trips
    expect(cb.state).toBe('OPEN')
  })

  test('invalid openedAt is treated as absent (no crash, stays OPEN)', () => {
    const cb = makeBreaker()
    cb.restore({
      state: 'OPEN',
      failureCount: 1,
      successCount: 0,
      halfOpenAttempts: 0,
      openedAt: 'not-a-date',
      capturedAt: new Date().toISOString(),
    })
    expect(cb.state).toBe('OPEN')
    expect(cb.failureCount).toBe(1)
  })

  test('HALF_OPEN snapshot is restored as-is', async () => {
    const cb = makeBreaker()
    cb.restore({
      state: 'HALF_OPEN',
      failureCount: 3,
      successCount: 0,
      halfOpenAttempts: 1,
      openedAt: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
    })
    expect(cb.state).toBe('HALF_OPEN')
    // halfOpenAttempts already 1 with max 1 → next probe rejected
    await expect(cb.execute(async () => 'x')).rejects.toBeInstanceOf(CircuitBreakerOpenError)
  })
})

describe('CircuitBreakerOpenError', () => {
  test('exposes state, failureCount and nextRetryAt', () => {
    const nextRetryAt = new Date(Date.now() + 1000)
    const err = new CircuitBreakerOpenError(7, nextRetryAt)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CircuitBreakerOpenError')
    expect(err.state).toBe('OPEN')
    expect(err.failureCount).toBe(7)
    expect(err.nextRetryAt).toBe(nextRetryAt)
    expect(err.message).toContain('7 failures')
    expect(err.message).toContain('OPEN')
  })
})
