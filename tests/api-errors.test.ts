/**
 * Unit tests — src/lib/api-errors.ts
 * ====================================
 * Covers the standardized API error classification and recovery-hint
 * response builders (pure functions only; the NextResponse wrapper is
 * exercised via route integration).
 */

import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import {
  ApiError,
  classifyApiError,
  buildApiErrorBody,
  buildApiErrorResponse,
  errorMessage,
} from '../src/lib/api-errors'
import { RetryExhaustedError, withStatus } from '../src/lib/retry'

// ============================================
// helpers
// ============================================

/** Duck-typed circuit-breaker-open error (mirrors CircuitBreakerOpenError). */
function makeCircuitBreakerError(nextRetryAt: Date): Error {
  return Object.assign(new Error(`Circuit breaker is OPEN (5 failures). Next retry allowed at ${nextRetryAt.toISOString()}`), {
    name: 'CircuitBreakerOpenError',
    nextRetryAt,
  })
}

/** Duck-typed Prisma error. */
function makePrismaError(code: string, message: string): Error {
  return Object.assign(new Error(message), {
    name: 'PrismaClientKnownRequestError',
    code,
    clientVersion: '6.11.1',
  })
}

function zodError(): z.ZodError {
  const result = z.object({ a: z.number(), b: z.string() }).safeParse({ a: 'x', c: 1 })
  if (result.success) throw new Error('expected parse failure')
  return result.error
}

// ============================================
// classifyApiError
// ============================================

describe('classifyApiError — ApiError passthrough', () => {
  test('preserves status, code, recovery, retryable', () => {
    const err = new ApiError({
      status: 409,
      code: 'MARKET_CLOSED',
      message: 'IDX closed',
      recovery: 'Wait for next session',
      retryable: true,
    })
    const c = classifyApiError(err)
    expect(c.status).toBe(409)
    expect(c.code).toBe('MARKET_CLOSED')
    expect(c.message).toBe('IDX closed')
    expect(c.recovery).toBe('Wait for next session')
    expect(c.retryable).toBe(true)
  })
})

describe('classifyApiError — RetryExhaustedError', () => {
  test('transient cause → 502 BRIDGE_UNREACHABLE, retryable', () => {
    // Node network failures carry errno codes on the `code` property
    const cause = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })
    const err = new RetryExhaustedError(3, 1500, cause)
    const c = classifyApiError(err)
    expect(c.status).toBe(502)
    expect(c.code).toBe('BRIDGE_UNREACHABLE')
    expect(c.retryable).toBe(true)
    expect(c.message).toContain('3 attempts')
    expect(c.recovery).toContain('MT5 bridge')
  })

  test('non-transient cause → 502 BRIDGE_TIMEOUT', () => {
    const err = new RetryExhaustedError(2, 400, new Error('invalid symbol BBRI'))
    const c = classifyApiError(err)
    expect(c.status).toBe(502)
    expect(c.code).toBe('BRIDGE_TIMEOUT')
    expect(c.retryable).toBe(true)
  })
})

describe('classifyApiError — circuit breaker open (duck-typed)', () => {
  test('503 CIRCUIT_BREAKER_OPEN with retryAfterMs derived from nextRetryAt', () => {
    const in30s = new Date(Date.now() + 30_000)
    const c = classifyApiError(makeCircuitBreakerError(in30s))
    expect(c.status).toBe(503)
    expect(c.code).toBe('CIRCUIT_BREAKER_OPEN')
    expect(c.retryable).toBe(true)
    expect(c.retryAfterMs).toBeDefined()
    expect(c.retryAfterMs as number).toBeGreaterThanOrEqual(29_000)
    expect(c.retryAfterMs as number).toBeLessThanOrEqual(30_500)
    expect(c.recovery).toContain('recovery window')
  })

  test('past nextRetryAt → retryAfterMs clamps to 0', () => {
    const c = classifyApiError(makeCircuitBreakerError(new Date(Date.now() - 5_000)))
    expect(c.retryAfterMs).toBe(0)
  })

  test('missing nextRetryAt → no retryAfterMs field', () => {
    const bare = Object.assign(new Error('circuit breaker open'), { name: 'CircuitBreakerOpenError' })
    const c = classifyApiError(bare)
    expect(c.status).toBe(503)
    expect(c.retryAfterMs).toBeUndefined()
  })
})

describe('classifyApiError — Zod validation', () => {
  test('400 VALIDATION_ERROR with field paths in message', () => {
    const c = classifyApiError(zodError())
    expect(c.status).toBe(400)
    expect(c.code).toBe('VALIDATION_ERROR')
    expect(c.retryable).toBe(false)
    expect(c.message).toContain('a:')
    expect(c.recovery).toContain('payload')
  })
})

describe('classifyApiError — Prisma codes', () => {
  test('P2025 → 404 NOT_FOUND', () => {
    const c = classifyApiError(makePrismaError('P2025', 'An operation failed because it depends on one or more records that were required but not found'))
    expect(c.status).toBe(404)
    expect(c.code).toBe('NOT_FOUND')
    expect(c.message).toContain('not found')
  })

  test('P2002 → 409 CONFLICT', () => {
    const c = classifyApiError(makePrismaError('P2002', 'Unique constraint failed on the fields: (`name`)'))
    expect(c.status).toBe(409)
    expect(c.code).toBe('CONFLICT')
  })

  test('P2021 → 500 DATABASE_ERROR (schema problem)', () => {
    const c = classifyApiError(makePrismaError('P2021', 'The table does not exist in the current database'))
    expect(c.status).toBe(500)
    expect(c.code).toBe('DATABASE_ERROR')
    expect(c.recovery).toContain('db:push')
  })

  test('other P-codes → 500 DATABASE_ERROR with code in message', () => {
    const c = classifyApiError(makePrismaError('P1001', "Can't reach database server"))
    expect(c.status).toBe(500)
    expect(c.code).toBe('DATABASE_ERROR')
    expect(c.message).toContain('P1001')
  })
})

describe('classifyApiError — status-tagged errors (withStatus)', () => {
  test('401 → UNAUTHORIZED with credential recovery hint', () => {
    const c = classifyApiError(withStatus(new Error('invalid credentials'), 401))
    expect(c.status).toBe(401)
    expect(c.code).toBe('UNAUTHORIZED')
    expect(c.recovery).toContain('MT5_LOGIN')
  })

  test('404 → NOT_FOUND', () => {
    const c = classifyApiError(withStatus(new Error('no such position'), 404))
    expect(c.status).toBe(404)
    expect(c.code).toBe('NOT_FOUND')
  })

  test('409 → CONFLICT', () => {
    const c = classifyApiError(withStatus(new Error('position already closed'), 409))
    expect(c.status).toBe(409)
    expect(c.code).toBe('CONFLICT')
  })

  test('429 → RATE_LIMITED, retryable', () => {
    const c = classifyApiError(withStatus(new Error('too many requests'), 429))
    expect(c.status).toBe(429)
    expect(c.code).toBe('RATE_LIMITED')
    expect(c.retryable).toBe(true)
  })

  test('503 → 502 BRIDGE_UNREACHABLE, transient 5xx retryable', () => {
    const c = classifyApiError(withStatus(new Error('service unavailable'), 503))
    expect(c.status).toBe(502)
    expect(c.code).toBe('BRIDGE_UNREACHABLE')
    expect(c.retryable).toBe(true)
  })
})

describe('classifyApiError — market closed heuristics', () => {
  test.each([
    'Market is closed for BBRI',
    'Trading blocked: outside trading hours',
    'Cannot trade: weekend',
    'IDX closed — no active session',
  ])('message %p → 409 MARKET_CLOSED, retryable', (msg: string) => {
    const c = classifyApiError(new Error(msg))
    expect(c.status).toBe(409)
    expect(c.code).toBe('MARKET_CLOSED')
    expect(c.retryable).toBe(true)
    expect(c.recovery).toContain('session')
  })

  test('normal message does NOT match market-closed', () => {
    const c = classifyApiError(new Error('insufficient margin'))
    expect(c.code).not.toBe('MARKET_CLOSED')
  })
})

describe('classifyApiError — fallback', () => {
  test('generic Error → 500 INTERNAL_ERROR with actionable recovery', () => {
    const c = classifyApiError(new Error('unexpected failure'))
    expect(c.status).toBe(500)
    expect(c.code).toBe('INTERNAL_ERROR')
    expect(c.retryable).toBe(false)
    expect(c.recovery).toContain('/api/health')
  })

  test('string throw → classified with message preserved', () => {
    const c = classifyApiError('plain string failure')
    expect(c.status).toBe(500)
    expect(c.message).toBe('plain string failure')
  })

  test('non-Error object → JSON-stringified message', () => {
    const c = classifyApiError({ weird: true })
    expect(c.message).toContain('weird')
  })
})

// ============================================
// errorMessage
// ============================================

describe('errorMessage', () => {
  test('Error → message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
  test('string → itself', () => {
    expect(errorMessage('oops')).toBe('oops')
  })
  test('object → JSON', () => {
    expect(errorMessage({ a: 1 })).toBe('{"a":1}')
  })
  test('circular object → does not throw', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => errorMessage(circular)).not.toThrow()
  })
})

// ============================================
// buildApiErrorBody / buildApiErrorResponse
// ============================================

describe('buildApiErrorBody', () => {
  test('includes code, recovery, retryable + route context', () => {
    const classified = classifyApiError(new Error('kaboom'))
    const body = buildApiErrorBody(classified, { route: 'POST /api/trades/execute' })
    expect(body.success).toBe(false)
    expect(body.error).toBe('kaboom')
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(body.recovery).toBeTruthy()
    expect(body.retryable).toBe(false)
    expect(body.route).toBe('POST /api/trades/execute')
  })

  test('retryAfterMs included only when defined', () => {
    const withRetry = classifyApiError(makeCircuitBreakerError(new Date(Date.now() + 30_000)))
    expect('retryAfterMs' in buildApiErrorBody(withRetry)).toBe(true)
    const noRetry = classifyApiError(new Error('x'))
    expect('retryAfterMs' in buildApiErrorBody(noRetry)).toBe(false)
  })
})

describe('buildApiErrorResponse', () => {
  test('status, statusText, JSON headers and parseable body', () => {
    const init = buildApiErrorResponse(new Error('bad thing'), { route: 'GET /api/backtest' })
    expect(init.status).toBe(500)
    expect(init.statusText).toBe('Internal Server Error')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.success).toBe(false)
    expect(body.code).toBe('INTERNAL_ERROR')
  })

  test('circuit breaker → Retry-After header in whole seconds', () => {
    const init = buildApiErrorResponse(makeCircuitBreakerError(new Date(Date.now() + 30_000)))
    expect(init.status).toBe(503)
    expect(init.statusText).toBe('Service Unavailable')
    const retryAfter = Number(init.headers['Retry-After'])
    expect(retryAfter).toBeGreaterThanOrEqual(29)
    expect(retryAfter).toBeLessThanOrEqual(31)
  })

  test('requestId mirrored into X-Request-Id header', () => {
    const init = buildApiErrorResponse(new Error('x'), { requestId: 'req-abc-123' })
    expect(init.headers['X-Request-Id']).toBe('req-abc-123')
  })

  test('validation error → 400 Bad Request', () => {
    const init = buildApiErrorResponse(zodError())
    expect(init.status).toBe(400)
    expect(init.statusText).toBe('Bad Request')
  })
})
