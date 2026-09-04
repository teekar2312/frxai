/**
 * Unit tests — src/lib/retry.ts
 * ==============================
 * Covers: computeBackoffDelay (deterministic + cap), isTransientError
 * classification, executeWithRetry (success / retry / exhaustion /
 * non-transient / onRetry / abort), sleep, retry wrapper, MT5_RETRYABLE_CODES.
 *
 * All timings use jitterRatio 0 + baseDelayMs 1 so tests run in milliseconds.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  computeBackoffDelay,
  isTransientError,
  executeWithRetry,
  retry,
  sleep,
  defaultRetryConfig,
  withStatus,
  withMt5Code,
  RetryExhaustedError,
  MT5_RETRYABLE_CODES,
  type RetryAttemptInfo,
} from '../src/lib/retry'
import { resetEnvCache } from '../src/lib/env-validation'

// ============================================
// helpers
// ============================================

interface CodedError extends Error {
  code?: string
}

function codedError(code: string, message = 'boom'): CodedError {
  return Object.assign(new Error(message), { code }) as CodedError
}

function namedError(name: string, message = 'boom'): Error {
  const err = new Error(message)
  err.name = name
  return err
}

/** Fast, deterministic retry config (no jitter, 1ms base). */
const FAST = {
  maxAttempts: 5,
  baseDelayMs: 1,
  maxDelayMs: 8,
  backoffMultiplier: 2,
  jitterRatio: 0,
} as const

// process.env save/restore for the defaultRetryConfig test
let envSnapshot: Record<string, string> = {}

function snapshotEnv(): void {
  envSnapshot = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) envSnapshot[key] = value
  }
}

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (process.env[key] !== value) process.env[key] = value
  }
}

beforeEach(() => {
  snapshotEnv()
  resetEnvCache()
})

afterEach(() => {
  restoreEnv()
  resetEnvCache()
})

// ============================================
// computeBackoffDelay
// ============================================

describe('computeBackoffDelay', () => {
  const cfg = { baseDelayMs: 100, maxDelayMs: 10_000, backoffMultiplier: 2, jitterRatio: 0 }

  test('deterministic exponential growth (jitterRatio 0)', () => {
    expect(computeBackoffDelay(1, cfg)).toBe(100)
    expect(computeBackoffDelay(2, cfg)).toBe(200)
    expect(computeBackoffDelay(3, cfg)).toBe(400)
    expect(computeBackoffDelay(4, cfg)).toBe(800)
  })

  test('attempt 1 equals the base delay', () => {
    expect(computeBackoffDelay(1, { ...cfg, baseDelayMs: 250 })).toBe(250)
  })

  test('delay is capped at maxDelayMs', () => {
    // 100 * 2^9 = 51_200 → capped
    expect(computeBackoffDelay(10, cfg)).toBe(10_000)
    expect(computeBackoffDelay(20, cfg)).toBe(10_000)
  })

  test('jitter never exceeds the capped base (jitterRatio 1)', () => {
    for (let i = 0; i < 50; i++) {
      const d = computeBackoffDelay(3, { ...cfg, jitterRatio: 1 })
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(400)
    }
  })
})

// ============================================
// isTransientError
// ============================================

describe('isTransientError', () => {
  test('network errno codes are transient', () => {
    expect(isTransientError(codedError('ECONNRESET'))).toBe(true)
    expect(isTransientError(codedError('ECONNREFUSED'))).toBe(true)
    expect(isTransientError(codedError('ETIMEDOUT'))).toBe(true)
    expect(isTransientError(codedError('ENOTFOUND'))).toBe(true)
    expect(isTransientError(codedError('EPIPE'))).toBe(true)
  })

  test('transient error names (TimeoutError etc.)', () => {
    expect(isTransientError(namedError('TimeoutError'))).toBe(true)
    expect(isTransientError(namedError('AbortError'))).toBe(true)
    expect(isTransientError(namedError('NetworkError'))).toBe(true)
    expect(isTransientError(namedError('FetchError'))).toBe(true)
  })

  test('retryable HTTP statuses', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isTransientError(withStatus(new Error(`HTTP ${status}`), status))).toBe(true)
    }
  })

  test('non-retryable HTTP statuses', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(isTransientError(withStatus(new Error(`HTTP ${status}`), status))).toBe(false)
    }
  })

  test('MT5 retryable codes via withMt5Code', () => {
    expect(isTransientError(withMt5Code(new Error('MT5 reject'), 10004))).toBe(true)
    expect(isTransientError(withMt5Code(new Error('MT5 reject'), 10006))).toBe(true)
    expect(isTransientError(withMt5Code(new Error('MT5 hard reject'), 10009))).toBe(false)
  })

  test('message sniffing detects rate limiting as last resort', () => {
    expect(isTransientError(new Error('too many requests'))).toBe(true)
    expect(isTransientError(new Error('Rate limit exceeded for key'))).toBe(true)
    expect(isTransientError(new Error('service temporarily overloaded'))).toBe(true)
    expect(isTransientError(new Error('plain invalid input'))).toBe(false)
  })

  test('non-Error values and plain Errors are not transient', () => {
    expect(isTransientError('just a string')).toBe(false)
    expect(isTransientError({ status: 503 })).toBe(false)
    expect(isTransientError(new Error('ordinary failure'))).toBe(false)
    expect(isTransientError(null)).toBe(false)
  })

  test('extra domain classifier takes precedence', () => {
    expect(isTransientError('custom-marker', (err) => err === 'custom-marker')).toBe(true)
    expect(isTransientError(new Error('x'), () => false)).toBe(false)
  })

  test('MT5_RETRYABLE_CODES export contains documented codes', () => {
    expect(MT5_RETRYABLE_CODES.has(10004)).toBe(true)
    expect(MT5_RETRYABLE_CODES.has(10021)).toBe(true)
    expect(MT5_RETRYABLE_CODES.has(10027)).toBe(true)
    expect(MT5_RETRYABLE_CODES.size).toBeGreaterThanOrEqual(9)
    expect(MT5_RETRYABLE_CODES.has(10009)).toBe(false)
  })
})

// ============================================
// executeWithRetry
// ============================================

describe('executeWithRetry', () => {
  test('success on first attempt → attempts=1, succeededAfterRetry=false', async () => {
    let calls = 0
    const outcome = await executeWithRetry(
      async () => {
        calls++
        return 42
      },
      { ...FAST },
    )

    expect(calls).toBe(1)
    expect(outcome.result).toBe(42)
    expect(outcome.attempts).toBe(1)
    expect(outcome.succeededAfterRetry).toBe(false)
    expect(outcome.totalDelayMs).toBe(0)
  })

  test('transient failures retried until success → attempts=3, succeededAfterRetry=true', async () => {
    let calls = 0
    const outcome = await executeWithRetry(
      async () => {
        calls++
        if (calls < 3) throw codedError('ECONNRESET')
        return 'ok'
      },
      { ...FAST },
    )

    expect(calls).toBe(3)
    expect(outcome.result).toBe('ok')
    expect(outcome.attempts).toBe(3)
    expect(outcome.succeededAfterRetry).toBe(true)
    // jitter 0, base 1, mult 2 → delays 1 + 2 = 3ms total
    expect(outcome.totalDelayMs).toBe(3)
  })

  test('maxAttempts exhausted → throws RetryExhaustedError with attempts & lastError', async () => {
    let calls = 0
    const errors: Error[] = []
    let thrown: unknown

    try {
      await executeWithRetry(
        async () => {
          calls++
          const err = codedError('ECONNRESET', `failure ${calls}`)
          errors.push(err)
          throw err
        },
        { ...FAST, maxAttempts: 3 },
      )
    } catch (err) {
      thrown = err
    }

    expect(calls).toBe(3)
    expect(thrown).toBeInstanceOf(RetryExhaustedError)
    const exhausted = thrown as RetryExhaustedError
    expect(exhausted.name).toBe('RetryExhaustedError')
    expect(exhausted.attempts).toBe(3)
    expect(exhausted.lastError).toBe(errors[2])
    expect(exhausted.totalDelayMs).toBeGreaterThanOrEqual(3) // 1 + 2 backoff
    expect(exhausted.message).toContain('Retry exhausted')
    expect(exhausted.message).toContain('failure 3')
  })

  test('non-transient error → immediate rethrow, fn called exactly once', async () => {
    let calls = 0
    const original = withStatus(new Error('bad request'), 400)
    let thrown: unknown

    try {
      await executeWithRetry(
        async () => {
          calls++
          throw original
        },
        { ...FAST },
      )
    } catch (err) {
      thrown = err
    }

    expect(calls).toBe(1)
    expect(thrown).toBe(original) // same instance rethrown, not wrapped
    expect(thrown).not.toBeInstanceOf(RetryExhaustedError)
  })

  test('onRetry callback receives correct attempt metadata', async () => {
    const infos: RetryAttemptInfo[] = []
    const firstErr = codedError('ECONNRESET', 'err1')
    const secondErr = codedError('ECONNRESET', 'err2')

    const outcome = await executeWithRetry(
      async (attempt) => {
        if (attempt === 1) throw firstErr
        if (attempt === 2) throw secondErr
        return 'done'
      },
      { ...FAST, maxAttempts: 4, onRetry: (info) => infos.push(info) },
    )

    expect(outcome.result).toBe('done')
    expect(infos).toHaveLength(2)

    expect(infos[0]?.attempt).toBe(1)
    expect(infos[0]?.error).toBe(firstErr)
    expect(infos[0]?.nextDelayMs).toBe(1) // base delay (jitter 0)
    expect(infos[0]?.attemptsLeft).toBe(2) // 4 max − 1 failed − 1 next = 2 remaining after next

    expect(infos[1]?.attempt).toBe(2)
    expect(infos[1]?.error).toBe(secondErr)
    expect(infos[1]?.nextDelayMs).toBe(2) // base * 2^1
    expect(infos[1]?.attemptsLeft).toBe(1)
  })

  test('pre-aborted signal → AbortError before the first call', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    let thrown: unknown

    try {
      await executeWithRetry(
        async () => {
          calls++
          return 'never'
        },
        { ...FAST, signal: controller.signal },
      )
    } catch (err) {
      thrown = err
    }

    expect(calls).toBe(0)
    expect((thrown as Error).name).toBe('AbortError')
    expect((thrown as Error).message).toContain('Aborted')
  })

  test('abort during backoff sleep → AbortError, fn called once', async () => {
    const controller = new AbortController()
    let calls = 0
    let thrown: unknown

    const promise = executeWithRetry(
      async () => {
        calls++
        throw codedError('ECONNRESET')
      },
      { ...FAST, maxAttempts: 10, baseDelayMs: 80, maxDelayMs: 80, signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 15)

    try {
      await promise
    } catch (err) {
      thrown = err
    }

    expect(calls).toBe(1)
    expect((thrown as Error).name).toBe('AbortError')
  })

  test('maxAttempts below 1 is clamped to a single attempt', async () => {
    let calls = 0
    let thrown: unknown

    try {
      await executeWithRetry(
        async () => {
          calls++
          throw codedError('ECONNRESET')
        },
        { ...FAST, maxAttempts: 0 },
      )
    } catch (err) {
      thrown = err
    }

    expect(calls).toBe(1)
    expect(thrown).toBeInstanceOf(RetryExhaustedError)
    expect((thrown as RetryExhaustedError).attempts).toBe(1)
  })

  test('retry() convenience wrapper returns only the result', async () => {
    let calls = 0
    const value = await retry(
      async () => {
        calls++
        if (calls < 2) throw codedError('ECONNRESET')
        return 'wrapped'
      },
      { ...FAST },
    )
    expect(value).toBe('wrapped')
    expect(calls).toBe(2)
  })
})

// ============================================
// sleep
// ============================================

describe('sleep', () => {
  test('sleep(0) resolves immediately', async () => {
    await sleep(0)
    expect(true).toBe(true)
  })

  test('sleep resolves after the requested duration', async () => {
    const start = Date.now()
    await sleep(5)
    expect(Date.now() - start).toBeGreaterThanOrEqual(4) // allow tiny clock slack
  })

  test('sleep with a pre-aborted signal rejects with AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    let thrown: unknown
    try {
      await sleep(50, controller.signal)
    } catch (err) {
      thrown = err
    }
    expect((thrown as Error).name).toBe('AbortError')
  })
})

// ============================================
// defaultRetryConfig (env-driven)
// ============================================

describe('defaultRetryConfig', () => {
  test('config is derived from validated env values', () => {
    process.env.BRIDGE_MAX_RETRIES = '3'
    process.env.BRIDGE_RETRY_BASE_DELAY_MS = '500'
    process.env.BRIDGE_RETRY_MAX_DELAY_MS = '8000'
    resetEnvCache()

    const cfg = defaultRetryConfig()

    expect(cfg.maxAttempts).toBe(4) // 1 + BRIDGE_MAX_RETRIES
    expect(cfg.baseDelayMs).toBe(500)
    expect(cfg.maxDelayMs).toBe(8000)
    expect(cfg.backoffMultiplier).toBe(2)
    expect(cfg.jitterRatio).toBe(1)
  })
})
