/* eslint-disable no-console -- console methods are intentionally stubbed/restored to mute module side effects */
/**
 * Unit tests — src/lib/env-validation.ts
 * =======================================
 * Covers: validateEnvironment (valid/invalid/production/strict/cross-field),
 * env() caching + fallback, resetEnvCache, ensureValidEnv, EnvValidationError.
 *
 * NOTE: every test manipulates process.env and restores the FULL original
 * snapshot afterwards so other test files are never polluted.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  validateEnvironment,
  resetEnvCache,
  env,
  ensureValidEnv,
  EnvValidationError,
  type Env,
} from '../src/lib/env-validation'

// ============================================
// process.env snapshot / restore helpers
// ============================================

let envSnapshot: Record<string, string> = {}
const originalLog = console.log
const originalWarn = console.warn
const originalError = console.error

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
  // mute env-validation console side effects (they are validated via the report)
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
})

afterEach(() => {
  console.log = originalLog
  console.warn = originalWarn
  console.error = originalError
  restoreEnv()
  resetEnvCache()
})

function parsedOf(ok: boolean, parsed: Env | null): Env {
  expect(ok).toBe(true)
  expect(parsed).not.toBeNull()
  if (!parsed) throw new Error('parsed expected to be non-null')
  return parsed
}

// ============================================
// VALID ENVIRONMENT
// ============================================

describe('validateEnvironment — valid environment', () => {
  test('valid env → ok:true, no errors, parsed filled, non-strict in dev', () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'file:./db/custom.db'

    const report = validateEnvironment({ fresh: true })

    expect(report.ok).toBe(true)
    expect(report.errors).toHaveLength(0)
    expect(report.mode).toBe('development')
    expect(report.strict).toBe(false)
    expect(Array.isArray(report.warnings)).toBe(true)

    const parsed = parsedOf(report.ok, report.parsed)
    expect(parsed.NODE_ENV).toBe('development')
    expect(parsed.DATABASE_URL).toBe('file:./db/custom.db')
    expect(parsed.MT5_BRIDGE_URL).toBe('http://localhost:3001')
    expect(typeof parsed.BRIDGE_MAX_RETRIES).toBe('number')
    expect(typeof parsed.RATE_LIMIT_MAX_REQUESTS).toBe('number')
  })

  test('missing optional keys fall back to documented defaults', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL
    delete process.env.LOG_RETENTION_DAYS
    delete process.env.BRIDGE_MAX_RETRIES
    delete process.env.MT5_SERVER
    delete process.env.RATE_LIMIT_MAX_REQUESTS

    const report = validateEnvironment({ fresh: true })
    const parsed = parsedOf(report.ok, report.parsed)

    expect(parsed.LOG_LEVEL).toBe('DEBUG')
    expect(parsed.LOG_RETENTION_DAYS).toBe(30)
    expect(parsed.BRIDGE_MAX_RETRIES).toBe(3)
    expect(parsed.MT5_SERVER).toBe('FINEX-Server')
    expect(parsed.RATE_LIMIT_MAX_REQUESTS).toBe(100)
  })

  test('NODE_ENV=test is an accepted mode', () => {
    process.env.NODE_ENV = 'test'
    const report = validateEnvironment({ fresh: true })
    expect(report.ok).toBe(true)
    expect(report.mode).toBe('test')
    expect(report.strict).toBe(false)
  })
})

// ============================================
// INVALID VALUES (dev mode — never throws)
// ============================================

describe('validateEnvironment — invalid values', () => {
  test('empty DATABASE_URL is recorded as an error', () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = ''

    const report = validateEnvironment({ fresh: true, failFast: false })

    expect(report.ok).toBe(false)
    expect(report.parsed).toBeNull()
    const vars = report.errors.map((e) => e.variable)
    expect(vars).toContain('DATABASE_URL')
    const dbErr = report.errors.find((e) => e.variable === 'DATABASE_URL')
    expect(dbErr?.problem).toBe('invalid')
  })

  test('LOG_LEVEL invalid string → error recorded; empty/missing → fallback DEBUG', () => {
    process.env.NODE_ENV = 'development'

    // invalid value
    process.env.LOG_LEVEL = 'BOGUS'
    const bad = validateEnvironment({ fresh: true, failFast: false })
    expect(bad.ok).toBe(false)
    expect(bad.errors.map((e) => e.variable)).toContain('LOG_LEVEL')
    expect(bad.parsed).toBeNull()

    // empty string → fallback
    process.env.LOG_LEVEL = ''
    const empty = validateEnvironment({ fresh: true, failFast: false })
    const parsedEmpty = parsedOf(empty.ok, empty.parsed)
    expect(parsedEmpty.LOG_LEVEL).toBe('DEBUG')

    // missing → fallback
    delete process.env.LOG_LEVEL
    const missing = validateEnvironment({ fresh: true, failFast: false })
    const parsedMissing = parsedOf(missing.ok, missing.parsed)
    expect(parsedMissing.LOG_LEVEL).toBe('DEBUG')
  })

  test('LOG_LEVEL is case-normalized (warn → WARN)', () => {
    process.env.NODE_ENV = 'development'
    process.env.LOG_LEVEL = 'warn'
    const report = validateEnvironment({ fresh: true })
    const parsed = parsedOf(report.ok, report.parsed)
    expect(parsed.LOG_LEVEL).toBe('WARN')
  })

  test('BASE_BALANCE outside allowed range is rejected; valid float is coerced', () => {
    process.env.NODE_ENV = 'development'

    process.env.BASE_BALANCE = '0'
    const tooLow = validateEnvironment({ fresh: true, failFast: false })
    expect(tooLow.ok).toBe(false)
    expect(tooLow.errors.map((e) => e.variable)).toContain('BASE_BALANCE')

    process.env.BASE_BALANCE = '200000000'
    const tooHigh = validateEnvironment({ fresh: true, failFast: false })
    expect(tooHigh.ok).toBe(false)
    expect(tooHigh.errors.map((e) => e.variable)).toContain('BASE_BALANCE')

    process.env.BASE_BALANCE = '5000.5'
    const valid = validateEnvironment({ fresh: true })
    const parsed = parsedOf(valid.ok, valid.parsed)
    expect(parsed.BASE_BALANCE).toBe(5000.5)
  })

  test('cross-field: BRIDGE_RETRY_BASE_DELAY_MS > BRIDGE_RETRY_MAX_DELAY_MS → error', () => {
    process.env.NODE_ENV = 'development'
    process.env.BRIDGE_RETRY_BASE_DELAY_MS = '2000'
    process.env.BRIDGE_RETRY_MAX_DELAY_MS = '1000'

    const report = validateEnvironment({ fresh: true, failFast: false })

    expect(report.ok).toBe(false)
    // schema itself parsed fine — the error comes from the cross-field check
    expect(report.parsed).not.toBeNull()
    const crossErr = report.errors.find((e) => e.variable === 'BRIDGE_RETRY_BASE_DELAY_MS')
    expect(crossErr).toBeDefined()
    expect(crossErr?.message).toContain('must be <=')
  })

  test('cross-field control: base <= max produces no cross-field error', () => {
    process.env.NODE_ENV = 'development'
    process.env.BRIDGE_RETRY_BASE_DELAY_MS = '500'
    process.env.BRIDGE_RETRY_MAX_DELAY_MS = '8000'

    const report = validateEnvironment({ fresh: true })
    expect(report.ok).toBe(true)
    expect(report.errors.map((e) => e.variable)).not.toContain('BRIDGE_RETRY_BASE_DELAY_MS')
  })
})

// ============================================
// PRODUCTION MODE
// ============================================

describe('validateEnvironment — production mode', () => {
  function breakProduction(): void {
    process.env.NODE_ENV = 'production'
    delete process.env.MT5_LOGIN
    delete process.env.MT5_PASSWORD
    delete process.env.MT5_SERVER
  }

  test('missing MT5 credentials → PROD_REQUIRED errors with problem "missing"', () => {
    breakProduction()

    const report = validateEnvironment({ fresh: true, failFast: false })

    expect(report.ok).toBe(false)
    expect(report.mode).toBe('production')
    for (const key of ['MT5_LOGIN', 'MT5_PASSWORD', 'MT5_SERVER']) {
      const err = report.errors.find((e) => e.variable === key)
      expect(err).toBeDefined()
      expect(err?.problem).toBe('missing')
      expect(err?.message).toContain('required in production')
    }
  })

  test('TELEGRAM_BOT_TOKEN without TELEGRAM_CHAT_ID → warning (prod only)', () => {
    breakProduction()
    process.env.TELEGRAM_BOT_TOKEN = 'some-bot-token'
    delete process.env.TELEGRAM_CHAT_ID

    const report = validateEnvironment({ fresh: true, failFast: false })
    expect(report.warnings.map((w) => w.variable)).toContain('TELEGRAM_CHAT_ID')
  })

  test('production default options are strict → throws EnvValidationError', () => {
    breakProduction()

    let thrown: unknown
    try {
      validateEnvironment({ fresh: true })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(EnvValidationError)
    const err = thrown as EnvValidationError
    expect(err.name).toBe('EnvValidationError')
    expect(err.message).toContain('Environment validation failed')

    // the report was cached before throwing — retrievable without re-run
    const cached = validateEnvironment()
    expect(cached.strict).toBe(true)
    expect(cached.errors.map((e) => e.variable)).toContain('MT5_LOGIN')
  })

  test('development mode with missing MT5 credentials → no errors (warnings only)', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.MT5_LOGIN
    delete process.env.MT5_PASSWORD
    process.env.TELEGRAM_BOT_TOKEN = 'some-bot-token'
    delete process.env.TELEGRAM_CHAT_ID

    const report = validateEnvironment({ fresh: true, failFast: false })

    expect(report.ok).toBe(true)
    expect(report.errors).toHaveLength(0)
    expect(report.mode).toBe('development')
    // the TELEGRAM_CHAT_ID warning is production-only
    expect(report.warnings.map((w) => w.variable)).not.toContain('TELEGRAM_CHAT_ID')
  })
})

// ============================================
// STRICT MODE (VALIDATE_ENV_STRICT)
// ============================================

describe('validateEnvironment — strict mode', () => {
  test('VALIDATE_ENV_STRICT=true + invalid value → throws EnvValidationError with issues', () => {
    process.env.NODE_ENV = 'development'
    process.env.VALIDATE_ENV_STRICT = 'true'
    process.env.DATABASE_URL = ''

    let thrown: unknown
    try {
      validateEnvironment({ fresh: true })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(EnvValidationError)
    const err = thrown as EnvValidationError
    expect(err.name).toBe('EnvValidationError')
    expect(err.message).toContain('Environment validation failed')
    expect(err.message).toContain('DATABASE_URL')
    expect(err.issues.length).toBeGreaterThanOrEqual(1)
    expect(err.issues[0]?.path).toBe('DATABASE_URL')
    expect(err.issues[0]?.message).toBeTruthy()
  })

  test('failFast:false overrides strict mode → report returned without throwing', () => {
    process.env.NODE_ENV = 'development'
    process.env.VALIDATE_ENV_STRICT = 'true'
    process.env.DATABASE_URL = ''

    const report = validateEnvironment({ fresh: true, failFast: false })
    expect(report.ok).toBe(false)
    expect(report.strict).toBe(false)
    expect(report.errors.map((e) => e.variable)).toContain('DATABASE_URL')
  })
})

// ============================================
// CACHING, env() AND ensureValidEnv
// ============================================

describe('env() caching & resetEnvCache', () => {
  test('env() is cached — changes to process.env are invisible until resetEnvCache()', () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'file:./db/one.db'

    const first = env()
    expect(first.DATABASE_URL).toBe('file:./db/one.db')

    process.env.DATABASE_URL = 'file:./db/two.db'
    const cached = env()
    expect(cached).toBe(first) // same memoized object
    expect(cached.DATABASE_URL).toBe('file:./db/one.db')

    resetEnvCache()
    const fresh = env()
    expect(fresh).not.toBe(first)
    expect(fresh.DATABASE_URL).toBe('file:./db/two.db')
  })

  test('validateEnvironment report caching: fresh bypasses cache, resetEnvCache recomputes', () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'file:./db/one.db'

    const r1 = validateEnvironment({ fresh: true })
    expect(r1.ok).toBe(true)

    process.env.DATABASE_URL = '' // make invalid
    const cached = validateEnvironment() // no fresh → cached report
    expect(cached).toBe(r1)
    expect(cached.ok).toBe(true)

    resetEnvCache()
    const recomputed = validateEnvironment({ fresh: true })
    expect(recomputed).not.toBe(r1)
    expect(recomputed.ok).toBe(false)
    expect(recomputed.errors.map((e) => e.variable)).toContain('DATABASE_URL')
  })

  test('env() fallback path: schema-invalid env still boots in dev with safe fallback', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.DATABASE_URL // required key missing → schema fails → fallback layer

    const e = env()
    expect(e.DATABASE_URL).toBe('file:./db/custom.db')
    expect(e.NODE_ENV).toBe('development')
  })
})

describe('ensureValidEnv', () => {
  test('valid env → { ok: true, env } with parsed values', () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = 'file:./db/custom.db'

    const result = ensureValidEnv()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.env.DATABASE_URL).toBe('file:./db/custom.db')
      expect(result.env.NODE_ENV).toBe('development')
    }
  })

  test('production + missing MT5_LOGIN → { ok: false, error: EnvValidationError }', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MT5_LOGIN
    delete process.env.MT5_PASSWORD
    delete process.env.MT5_SERVER

    const result = ensureValidEnv()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(EnvValidationError)
      expect(result.error.name).toBe('EnvValidationError')
    }
  })
})
