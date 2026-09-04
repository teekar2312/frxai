/**
 * FRxAI — Runtime Environment Variable Validation
 * =================================================
 * Validates all environment variables at runtime using Zod schemas.
 *
 * Behavior:
 *   - DEV  mode  : invalid/missing values log a WARN and fall back to safe defaults
 *                  (app stays runnable for local development / demo).
 *   - PROD mode  : invalid REQUIRED variables throw EnvValidationError at first
 *                  access (fail-fast principle).
 *   - STRICT mode: env var VALIDATE_ENV_STRICT=true forces fail-fast in any mode.
 *
 * Usage:
 *   import { env, validateEnvironment, EnvValidationError } from '@/lib/env-validation'
 *
 *   const cfg = env()            // validated snapshot (cached)
 *   validateEnvironment()        // throws or warns, returns report
 */

import { z } from 'zod'

// ============================================
// ZOD SCHEMAS
// ============================================

const intFromString = (def: number, min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : v),
    z.coerce.number().int().min(min).max(max)
  )

const floatFromString = (def: number, min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : v),
    z.coerce.number().min(min).max(max)
  )

const boolFromString = z.preprocess(
  (v) => {
    if (v === undefined || v === '') return false
    if (typeof v === 'boolean') return v
    return ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase())
  },
  z.boolean()
)

const logLevelSchema = z.preprocess(
  (v) => (v === undefined || v === '' ? 'DEBUG' : String(v).toUpperCase()),
  z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL', 'FATAL'])
)

const severitySchema = z.preprocess(
  (v) => (v === undefined || v === '' ? 'WARN' : String(v).toUpperCase()),
  z.enum(['INFO', 'WARN', 'ERROR', 'CRITICAL'])
)

const urlSchema = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.string().url().or(z.literal('')).optional()
)

/** Full environment schema — every variable the system understands. */
export const EnvSchema = z.object({
  // --- Core ---
  NODE_ENV: z.preprocess(
    (v) => (v === undefined || v === '' ? 'development' : v),
    z.enum(['development', 'test', 'production'])
  ),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (e.g. file:./db/custom.db)'),
  BASE_BALANCE: floatFromString(10_000, 1, 100_000_000),
  MT5_BRIDGE_URL: z.preprocess(
    (v) => (v === undefined || v === '' ? 'http://localhost:3001' : v),
    z.string().url()
  ),

  // --- MT5 Broker (required in production only) ---
  MT5_LOGIN: z.string().optional(),
  MT5_PASSWORD: z.string().optional(),
  MT5_SERVER: z.preprocess(
    (v) => (v === undefined || v === '' ? 'FINEX-Server' : v),
    z.string().min(1)
  ),

  // --- News providers ---
  FINNHUB_API_KEY: z.string().optional(),
  MARKETAUX_API_KEY: z.string().optional(),

  // --- Logging ---
  LOG_LEVEL: logLevelSchema,
  LOG_RETENTION_DAYS: intFromString(30, 1, 3650),
  MT5_LOG_RETENTION_DAYS: intFromString(7, 1, 3650),
  NEWS_LOG_RETENTION_DAYS: intFromString(14, 1, 3650),
  LOG_CLEANUP_INTERVAL_HOURS: intFromString(6, 1, 168),
  LOG_DEDUP_WINDOW_MS: intFromString(60_000, 1000, 3_600_000),

  // --- Bridge retry / circuit breaker ---
  BRIDGE_TIMEOUT_MS: intFromString(15_000, 1000, 120_000),
  BRIDGE_MAX_RETRIES: intFromString(3, 0, 10),
  BRIDGE_RETRY_BASE_DELAY_MS: intFromString(500, 50, 30_000),
  BRIDGE_RETRY_MAX_DELAY_MS: intFromString(8_000, 100, 120_000),
  CB_FAILURE_THRESHOLD: intFromString(5, 1, 100),
  CB_RECOVERY_TIMEOUT_MS: intFromString(30_000, 1000, 3_600_000),
  CB_HALF_OPEN_MAX_ATTEMPTS: intFromString(1, 1, 10),
  CB_PERSIST_ENABLED: boolFromString.default(true),

  // --- Rate limiting ---
  RATE_LIMIT_ENABLED: z.preprocess(
    (v) => (v === undefined || v === '' ? true : ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase())),
    z.boolean()
  ),
  RATE_LIMIT_WINDOW_MS: intFromString(60_000, 1000, 600_000),
  RATE_LIMIT_MAX_REQUESTS: intFromString(100, 1, 100_000),
  RATE_LIMIT_WRITE_MAX_REQUESTS: intFromString(20, 1, 10_000),
  RATE_LIMIT_AI_MAX_REQUESTS: intFromString(10, 1, 10_000),
  RATE_LIMIT_DRAFT_MAX_REQUESTS: intFromString(5, 1, 1_000),

  // --- Notifications ---
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DISCORD_WEBHOOK_URL: urlSchema,
  NOTIFY_MIN_SEVERITY: severitySchema,
  NOTIFY_ENABLED: z.preprocess(
    (v) => {
      if (v === undefined || v === '') return undefined // auto: enabled if creds present
      return ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase())
    },
    z.boolean().optional()
  ),
  NOTIFY_RATE_PER_MIN: intFromString(20, 1, 60),
  NOTIFY_RATE_PER_HOUR: intFromString(100, 1, 3_600),

  // --- Metrics / health ---
  METRICS_ENABLED: z.preprocess(
    (v) => (v === undefined || v === '' ? true : ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase())),
    z.boolean()
  ),
  METRICS_SNAPSHOT_INTERVAL_MS: intFromString(300_000, 10_000, 86_400_000),
  HEALTH_SNAPSHOT_INTERVAL_MS: intFromString(60_000, 5_000, 3_600_000),

  // --- Backtest ---
  BACKTEST_MAX_CANDLES: intFromString(50_000, 100, 1_000_000),
  BACKTEST_MAX_TRADES_PERSIST: intFromString(1_000, 10, 100_000),

  // --- Misc ---
  SESSION_RISK_LIMIT_PCT: floatFromString(1.0, 0.01, 100),
  VALIDATE_ENV_STRICT: boolFromString,
})

export type Env = z.infer<typeof EnvSchema>

// ============================================
// ERRORS
// ============================================

export class EnvValidationError extends Error {
  public readonly issues: Array<{ path: string; message: string; received: unknown }>

  constructor(issues: z.ZodIssue[]) {
    const summary = issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    super(`Environment validation failed — ${summary}`)
    this.name = 'EnvValidationError'
    this.issues = issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
      received: (i as { received?: unknown }).received,
    }))
  }
}

// ============================================
// VALIDATION REPORT
// ============================================

export interface EnvIssue {
  variable: string
  problem: 'missing' | 'invalid' | 'warn'
  message: string
  value?: string
}

export interface EnvValidationReport {
  ok: boolean
  mode: 'development' | 'test' | 'production'
  strict: boolean
  warnings: EnvIssue[]
  errors: EnvIssue[]
  parsed: Env | null
}

/** Variables required only when NODE_ENV === 'production'. */
const PROD_REQUIRED = ['MT5_LOGIN', 'MT5_PASSWORD', 'MT5_SERVER'] as const

let cachedEnv: Env | null = null
let cachedReport: EnvValidationReport | null = null

/**
 * Run full environment validation.
 * @param opts.failFast — throw EnvValidationError when invalid (default: prod or VALIDATE_ENV_STRICT)
 */
export function validateEnvironment(opts?: { failFast?: boolean; fresh?: boolean }): EnvValidationReport {
  if (cachedReport && !opts?.fresh) return cachedReport

  const raw = process.env as Record<string, unknown>
  const result = EnvSchema.safeParse(raw)

  const warnings: EnvIssue[] = []
  const errors: EnvIssue[] = []

  const mode = (result.success ? result.data.NODE_ENV : 'development') as Env['NODE_ENV']
  const strict =
    opts?.failFast ??
    (mode === 'production' ||
      ['true', '1', 'yes', 'on'].includes(String(raw.VALIDATE_ENV_STRICT ?? '').toLowerCase()))

  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        variable: issue.path.join('.') || '(root)',
        problem: 'invalid',
        message: issue.message,
      })
    }
  }

  // Production-only required keys
  if (mode === 'production') {
    for (const key of PROD_REQUIRED) {
      const v = process.env[key]
      if (!v || v.trim() === '' || v.includes('your_')) {
        errors.push({
          variable: key,
          problem: 'missing',
          message: `${key} is required in production`,
          value: v,
        })
      }
    }
  }

  // Advisory warnings (any mode) — never fatal
  const advisory: Array<[string, string]> = [
    ['FINNHUB_API_KEY', 'News fetching disabled without Finnhub key'],
    ['MARKETAUX_API_KEY', 'MarketAux news source disabled without key'],
    ['TELEGRAM_BOT_TOKEN', 'Telegram notifications disabled without bot token'],
    ['DISCORD_WEBHOOK_URL', 'Discord notifications disabled without webhook URL'],
  ]
  for (const [key, msg] of advisory) {
    const v = process.env[key]
    if (!v || v.trim() === '' || v.includes('your_')) {
      warnings.push({ variable: key, problem: 'warn', message: msg })
    }
  }

  // Cross-field consistency checks
  if (result.success) {
    const e = result.data
    if (e.BRIDGE_RETRY_BASE_DELAY_MS > e.BRIDGE_RETRY_MAX_DELAY_MS) {
      errors.push({
        variable: 'BRIDGE_RETRY_BASE_DELAY_MS',
        problem: 'invalid',
        message: 'BRIDGE_RETRY_BASE_DELAY_MS must be <= BRIDGE_RETRY_MAX_DELAY_MS',
      })
    }
    if (e.TELEGRAM_BOT_TOKEN && !e.TELEGRAM_CHAT_ID && mode === 'production') {
      warnings.push({
        variable: 'TELEGRAM_CHAT_ID',
        problem: 'warn',
        message: 'TELEGRAM_BOT_TOKEN set but TELEGRAM_CHAT_ID missing — Telegram disabled',
      })
    }
    if (e.RATE_LIMIT_MAX_REQUESTS < e.RATE_LIMIT_WRITE_MAX_REQUESTS) {
      warnings.push({
        variable: 'RATE_LIMIT_MAX_REQUESTS',
        problem: 'warn',
        message: 'General rate limit is lower than the write rate limit — write limit will be capped',
      })
    }
  }

  const report: EnvValidationReport = {
    ok: errors.length === 0,
    mode,
    strict,
    warnings,
    errors,
    parsed: result.success ? result.data : null,
  }

  cachedReport = report

  // --- Side effects: log & (optionally) throw ---
  const tag = '[env-validation]'
  for (const w of warnings) console.warn(`${tag} WARN ${w.variable}: ${w.message}`)
  if (errors.length > 0) {
    for (const e of errors) console.error(`${tag} ERROR ${e.variable}: ${e.message}`)
    if (strict) throw new EnvValidationError(result.success ? [] : result.error.issues)
  } else if (result.success) {
    // Silent success in prod; dev prints a compact summary once
    if (mode !== 'production') {
      console.log(`${tag} OK — ${warnings.length} warning(s), all required variables valid`)
    }
  }

  return report
}

/**
 * Get the validated environment snapshot (cached after first call).
 * Applies safe defaults for missing values in non-strict modes.
 */
export function env(): Env {
  if (cachedEnv) return cachedEnv
  const report = validateEnvironment()
  if (report.parsed) {
    cachedEnv = report.parsed
    return cachedEnv
  }
  // Fallback path: schema failed entirely (extremely malformed env).
  // Re-parse ignoring invalid extras so the app can still boot in dev.
  try {
    const fallback = EnvSchema.parse({
      DATABASE_URL: process.env.DATABASE_URL ?? 'file:./db/custom.db',
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    })
    cachedEnv = fallback
    return cachedEnv
  } catch {
    // Last-resort: hard-coded safe defaults (dev-only; strict mode already threw)
    const safe = EnvSchema.parse({ DATABASE_URL: 'file:./db/custom.db', NODE_ENV: 'development' })
    cachedEnv = safe
    return cachedEnv
  }
}

/** Test helper — clears the memoized env/report. */
export function resetEnvCache(): void {
  cachedEnv = null
  cachedReport = null
}

/**
 * Express/Next-friendly middleware helper: validates env once and
 * surfaces a 500 JSON error when strict validation fails.
 */
export function ensureValidEnv(): { ok: true; env: Env } | { ok: false; error: EnvValidationError } {
  try {
    return { ok: true, env: env() }
  } catch (err) {
    if (err instanceof EnvValidationError) return { ok: false, error: err }
    throw err
  }
}
