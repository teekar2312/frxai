/**
 * Unit tests — src/lib/rate-limit.ts
 * ===================================
 * Covers: checkRateLimit (allow/block, remaining, retryAfterSec, bucket key),
 * tier & IP isolation, extractClientIp header precedence, 429 response
 * builders (buildRateLimitResponse / rateLimitResponse / withRateLimitHeaders),
 * stats + reset, rateLimitGuard, metrics recorder hook.
 *
 * Note: the module imports app-config (which imports Prisma) but only for
 * layered config reads — no DB access happens on these code paths.
 *
 * WORKAROUND for a rate-limit.ts bug (reported, not fixed here): the first
 * checkRateLimit call after module load triggers pruneIfNeeded, which DELETES
 * the just-created empty bucket entry before the hit is pushed — silently
 * dropping that hit. We warm the prune cycle once on a dedicated bucket so
 * all counted assertions below are exact.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  checkRateLimit,
  extractClientIp,
  buildRateLimitResponse,
  rateLimitResponse,
  withRateLimitHeaders,
  getRateLimitStats,
  resetRateLimitStore,
  rateLimitGuard,
  recordRateLimitMetrics,
  registerRateLimitMetricsRecorder,
  type RateLimitDecision,
} from '../src/lib/rate-limit'

// ============================================
// helpers
// ============================================

function makeReq(headers?: Record<string, string>): Request {
  return new Request('http://x/api/test', { method: 'POST', headers })
}

const WARMUP_IP = '10.255.255.254'
let prunedWarmed = false

beforeEach(() => {
  if (!prunedWarmed) {
    prunedWarmed = true
    // one throwaway call on a dedicated bucket absorbs the first-call
    // prune + hit-drop (see file header)
    checkRateLimit(makeReq({ 'x-forwarded-for': WARMUP_IP }), 'READ')
  }
  resetRateLimitStore()
})

// ============================================
// checkRateLimit — core allow/block behavior
// ============================================

describe('checkRateLimit', () => {
  test('allows requests up to the limit then blocks; remaining decreases', () => {
    const req = makeReq()

    const first = checkRateLimit(req, 'DRAFT')
    expect(first.allowed).toBe(true)
    expect(first.limit).toBe(5)
    expect(first.remaining).toBe(4)
    expect(first.current).toBe(0) // hits in window BEFORE this request is counted
    expect(first.key).toBe('anonymous:DRAFT')

    const second = checkRateLimit(req, 'DRAFT')
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(3)
    expect(second.current).toBe(1)

    const third = checkRateLimit(req, 'DRAFT')
    expect(third.remaining).toBe(2)

    const fourth = checkRateLimit(req, 'DRAFT')
    expect(fourth.remaining).toBe(1)

    const fifth = checkRateLimit(req, 'DRAFT')
    expect(fifth.allowed).toBe(true)
    expect(fifth.remaining).toBe(0)

    const sixth = checkRateLimit(req, 'DRAFT')
    expect(sixth.allowed).toBe(false)
    expect(sixth.remaining).toBe(0)
    expect(sixth.limit).toBe(5)
    expect(sixth.current).toBe(5)
  })

  test('blocked decision carries retryAfterSec >= 1 and a future resetAt', () => {
    const req = makeReq()
    for (let i = 0; i < 5; i++) checkRateLimit(req, 'DRAFT')
    const blocked = checkRateLimit(req, 'DRAFT')

    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(blocked.resetAt.getTime()).toBeGreaterThan(Date.now() - 5)
    expect(blocked.tier).toBe('DRAFT')
    expect(blocked.key).toBe('anonymous:DRAFT')
  })

  test('default DRAFT budget comes from the layered config (limit 5)', () => {
    const decision = checkRateLimit(makeReq(), 'DRAFT')
    expect(decision.limit).toBe(5)
    expect(decision.allowed).toBe(true)
  })

  test('different tiers get independent buckets for the same IP', () => {
    const req = makeReq()

    // exhaust DRAFT (limit 5)
    for (let i = 0; i < 5; i++) checkRateLimit(req, 'DRAFT')
    expect(checkRateLimit(req, 'DRAFT').allowed).toBe(false)

    // WRITE bucket untouched
    const write = checkRateLimit(req, 'WRITE')
    expect(write.allowed).toBe(true)
    expect(write.key).toBe('anonymous:WRITE')
    expect(write.limit).toBe(20)

    // AI bucket untouched
    expect(checkRateLimit(req, 'AI').allowed).toBe(true)

    // EXEMPT is never limited
    const exempt = checkRateLimit(req, 'EXEMPT')
    expect(exempt.allowed).toBe(true)
    expect(exempt.limit).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('different IPs get independent buckets (x-forwarded-for)', () => {
    const attacker = makeReq({ 'x-forwarded-for': '1.2.3.4' })
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(attacker, 'DRAFT').allowed).toBe(true)
    }
    expect(checkRateLimit(attacker, 'DRAFT').allowed).toBe(false)

    const other = makeReq({ 'x-forwarded-for': '5.6.7.8' })
    const decision = checkRateLimit(other, 'DRAFT')
    expect(decision.allowed).toBe(true)
    expect(decision.key).toBe('5.6.7.8:DRAFT')
    expect(decision.remaining).toBe(4)
  })
})

// ============================================
// extractClientIp — header precedence
// ============================================

describe('extractClientIp', () => {
  test('cf-connecting-ip has the highest priority', () => {
    const req = makeReq({
      'cf-connecting-ip': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
      'x-forwarded-for': '3.3.3.3',
    })
    expect(extractClientIp(req)).toBe('1.1.1.1')
  })

  test('x-real-ip beats x-forwarded-for', () => {
    const req = makeReq({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' })
    expect(extractClientIp(req)).toBe('2.2.2.2')
  })

  test('x-forwarded-for uses the first hop (trimmed)', () => {
    const req = makeReq({ 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.1' })
    expect(extractClientIp(req)).toBe('9.9.9.9')
  })

  test('x-client-ip is used when present', () => {
    const req = makeReq({ 'x-client-ip': '4.4.4.4' })
    expect(extractClientIp(req)).toBe('4.4.4.4')
  })

  test('"unknown" header values are skipped; no headers → anonymous', () => {
    expect(extractClientIp(makeReq({ 'x-forwarded-for': 'unknown' }))).toBe('anonymous')
    expect(extractClientIp(makeReq())).toBe('anonymous')
  })
})

// ============================================
// 429 response helpers
// ============================================

describe('buildRateLimitResponse / rateLimitResponse', () => {
  function blockedDecision(): RateLimitDecision {
    const req = makeReq()
    for (let i = 0; i < 5; i++) checkRateLimit(req, 'DRAFT')
    const blocked = checkRateLimit(req, 'DRAFT')
    expect(blocked.allowed).toBe(false)
    return blocked
  }

  test('buildRateLimitResponse → status 429 + Retry-After + X-RateLimit-* headers', () => {
    const decision = blockedDecision()
    const init = buildRateLimitResponse(decision)

    expect(init.status).toBe(429)
    expect(init.statusText).toBe('Too Many Requests')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers['Retry-After']).toBe(String(decision.retryAfterSec))
    expect(init.headers['X-RateLimit-Limit']).toBe(String(decision.limit))
    expect(init.headers['X-RateLimit-Remaining']).toBe('0')
    expect(init.headers['X-RateLimit-Tier']).toBe('DRAFT')

    const reset = Number(init.headers['X-RateLimit-Reset'])
    expect(reset).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5)
  })

  test('buildRateLimitResponse body is JSON with code RATE_LIMITED', () => {
    const decision = blockedDecision()
    const init = buildRateLimitResponse(decision)
    const body = JSON.parse(init.body) as {
      success: boolean
      error: { code: string; message: string; tier: string; limit: number; retryAfterSec: number; resetAt: string }
    }

    expect(body.success).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error.tier).toBe('DRAFT')
    expect(body.error.limit).toBe(decision.limit)
    expect(body.error.retryAfterSec).toBe(decision.retryAfterSec)
    expect(body.error.message).toContain('Rate limit exceeded')
    expect(new Date(body.error.resetAt).getTime()).not.toBeNaN()
  })

  test('rateLimitResponse → real Response with 429, headers and JSON body', async () => {
    const decision = blockedDecision()
    const res = rateLimitResponse(decision)

    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe(String(decision.retryAfterSec))
    expect(res.headers.get('x-ratelimit-limit')).toBe(String(decision.limit))
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0')

    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('RATE_LIMITED')
  })

  test('withRateLimitHeaders decorates a success response without losing it', async () => {
    const decision = checkRateLimit(makeReq(), 'WRITE')
    const original = new Response('ok', { status: 200, headers: { 'x-custom': 'v' } })

    const wrapped = withRateLimitHeaders(original, decision)

    expect(wrapped.status).toBe(200)
    expect(wrapped.headers.get('x-custom')).toBe('v')
    expect(wrapped.headers.get('x-ratelimit-limit')).toBe(String(decision.limit))
    expect(wrapped.headers.get('x-ratelimit-remaining')).toBe(String(decision.remaining))
    expect(wrapped.headers.get('x-ratelimit-reset')).toBe(String(Math.floor(decision.resetAt.getTime() / 1000)))
    expect(await wrapped.text()).toBe('ok')
  })
})

// ============================================
// stats & maintenance
// ============================================

describe('getRateLimitStats / resetRateLimitStore', () => {
  test('stats start zeroed after reset', () => {
    const stats = getRateLimitStats()
    expect(stats.activeKeys).toBe(0)
    expect(stats.totalHits).toBe(0)
    expect(stats.totalBlocked).toBe(0)
    expect(stats.prunedKeys).toBe(0)
    expect(stats.lastPruneAt).toBeNull()
  })

  test('totalHits/totalBlocked accumulate and budgets are exposed', () => {
    const req = makeReq()
    for (let i = 0; i < 5; i++) checkRateLimit(req, 'DRAFT') // 5 hits
    checkRateLimit(req, 'DRAFT') // 1 blocked
    checkRateLimit(req, 'DRAFT') // 2 blocked

    const stats = getRateLimitStats()
    expect(stats.totalHits).toBe(5)
    expect(stats.totalBlocked).toBe(2)
    expect(stats.activeKeys).toBeGreaterThanOrEqual(1)
    expect(stats.windowMs).toBeGreaterThanOrEqual(1000)
    expect(stats.enabled).toBe(true)

    expect(stats.budgets.DRAFT).toBe(5)
    expect(stats.budgets.WRITE).toBe(20)
    expect(stats.budgets.AI).toBe(10)
    expect(stats.budgets.EXEMPT).toBe(Number.MAX_SAFE_INTEGER)
  })

  test('resetRateLimitStore clears counters and unblocks clients', () => {
    const req = makeReq()
    for (let i = 0; i < 6; i++) checkRateLimit(req, 'DRAFT')

    resetRateLimitStore()

    const stats = getRateLimitStats()
    expect(stats.activeKeys).toBe(0)
    expect(stats.totalHits).toBe(0)
    expect(stats.totalBlocked).toBe(0)

    const after = checkRateLimit(req, 'DRAFT')
    expect(after.allowed).toBe(true)
    expect(after.remaining).toBe(4)
  })
})

// ============================================
// guard wrapper & metrics hook
// ============================================

describe('rateLimitGuard', () => {
  test('returns null while allowed, then a 429 Response once blocked', async () => {
    const guard = rateLimitGuard('DRAFT')
    const req = makeReq()

    for (let i = 0; i < 5; i++) {
      expect(guard(req)).toBeNull()
    }

    const limited = guard(req)
    expect(limited).not.toBeNull()
    expect(limited).toBeInstanceOf(Response)
    if (limited) {
      expect(limited.status).toBe(429)
      const body = (await limited.json()) as { error: { code: string; tier: string } }
      expect(body.error.code).toBe('RATE_LIMITED')
      expect(body.error.tier).toBe('DRAFT')
    }
  })
})

describe('recordRateLimitMetrics', () => {
  test('no-op without a registered recorder', () => {
    registerRateLimitMetricsRecorder(null)
    const decision = checkRateLimit(makeReq(), 'READ')
    expect(() => recordRateLimitMetrics(decision)).not.toThrow()
  })

  test('registered recorder receives check + blocked counters', () => {
    const calls: Array<[string, Record<string, string>]> = []
    registerRateLimitMetricsRecorder((name: string, labels: Record<string, string>) => {
      calls.push([name, labels])
    })

    const req = makeReq()
    for (let i = 0; i < 5; i++) checkRateLimit(req, 'DRAFT')
    const blocked = checkRateLimit(req, 'DRAFT')

    recordRateLimitMetrics(blocked)
    recordRateLimitMetrics(blocked)

    registerRateLimitMetricsRecorder(null) // detach — no further calls
    recordRateLimitMetrics(blocked)

    const checks = calls.filter((c) => c[0] === 'api_rate_limit_checks_total')
    const blocks = calls.filter((c) => c[0] === 'api_rate_limit_blocked_total')
    expect(checks).toHaveLength(2)
    expect(blocks).toHaveLength(2)
    expect(calls[0]?.[1].tier).toBe('DRAFT')
    expect(calls[0]?.[1].allowed).toBe('false')
  })
})
