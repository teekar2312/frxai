/**
 * FRxAI — Generic Retry Engine for Transient Failures
 * ====================================================
 * Exponential backoff with full jitter, retryable-error classification,
 * and structured attempt metadata. Used by the MT5 bridge client, news
 * API fetches, and notification dispatch.
 *
 * Features:
 *   - Exponential backoff: delay = min(base * 2^attempt, maxDelay) ± jitter
 *   - Retryable classification: network errors, timeouts, HTTP 408/425/429,
 *     5xx, and MT5 retryable codes (10004/10006/10008...)
 *   - Abort support via AbortSignal
 *   - OnRetry hook for observability (metrics, logging)
 *   - Deterministic mode for unit tests (no jitter)
 */

import { env } from './env-validation'

// ============================================
// TYPES
// ============================================

export interface RetryConfig {
  /** Max attempts TOTAL (1 = no retry, only the initial call). Default from env: 4 */
  maxAttempts: number
  /** Base delay in ms. Default from env: 500 */
  baseDelayMs: number
  /** Upper bound for any computed backoff. Default from env: 8000 */
  maxDelayMs: number
  /** Multiplier — classic exponential = 2. */
  backoffMultiplier: number
  /** 0..1 fraction of jitter applied (0 = deterministic, 1 = full jitter). Default 1 */
  jitterRatio: number
  /** Extra classifier for domain-specific retryable errors. */
  isRetryable?: (err: unknown) => boolean
  /** Called before each retry with attempt info. */
  onRetry?: (info: RetryAttemptInfo) => void
  /** Abort signal propagation. */
  signal?: AbortSignal
}

export interface RetryAttemptInfo {
  /** 1-based attempt number that just failed */
  attempt: number
  error: unknown
  /** Delay before the NEXT attempt (ms) */
  nextDelayMs: number
  /** Remaining attempts after this one */
  attemptsLeft: number
}

export interface RetryOutcome<T> {
  result: T
  attempts: number
  totalDelayMs: number
  succeededAfterRetry: boolean
}

export class RetryExhaustedError extends Error {
  public readonly attempts: number
  public readonly lastError: unknown
  public readonly totalDelayMs: number

  constructor(attempts: number, totalDelayMs: number, lastError: unknown) {
    const msg =
      lastError instanceof Error
        ? `Retry exhausted after ${attempts} attempts (${totalDelayMs}ms total): ${lastError.message}`
        : `Retry exhausted after ${attempts} attempts (${totalDelayMs}ms total)`
    super(msg)
    this.name = 'RetryExhaustedError'
    this.attempts = attempts
    this.lastError = lastError
    this.totalDelayMs = totalDelayMs
  }
}

// ============================================
// RETRYABLE ERROR CLASSIFICATION
// ============================================

/** Node/Bun network error codes that indicate transient failures. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ETOOMANYREFS',
  'ENOTFOUND', // DNS — often transient in containers
  'EAI_AGAIN',
  'EPIPE',
  'ENETDOWN',
  'ENETUNREACH',
  'ENETRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'EINPROGRESS', // socket warm-up
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_ABORTED',
])

/** Transient error names. */
const TRANSIENT_NAMES = new Set([
  'TimeoutError',
  'AbortError', // AbortSignal.timeout() fires this on fetch timeout
  'NetworkError',
  'FetchError',
  'ServiceUnavailableError',
  'BadGatewayError',
  'RequestTimeoutError',
  'TooManyRequestsError',
])

/** HTTP status codes worth retrying. */
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524])

/** MT5 trade return codes the broker docs mark retryable (transient). */
export const MT5_RETRYABLE_CODES = new Set([10004, 10006, 10008, 10013, 10014, 10018, 10021, 10026, 10027])

export interface HttpStatusError extends Error {
  status?: number
  mt5Code?: number
}

/** Attach status to an error so classifiers can read it. */
export function withStatus(err: Error, status: number): HttpStatusError {
  ;(err as HttpStatusError).status = status
  return err as HttpStatusError
}

export function withMt5Code(err: Error, mt5Code: number): HttpStatusError {
  ;(err as HttpStatusError).mt5Code = mt5Code
  return err as HttpStatusError
}

/**
 * Decide whether an error is transient (worth retrying).
 * Order: explicit domain classifier → HTTP status → MT5 code →
 * code/name heuristics → message sniffing as last resort.
 */
export function isTransientError(err: unknown, extra?: (err: unknown) => boolean): boolean {
  if (extra?.(err)) return true
  if (err instanceof Error) {
    const e = err as HttpStatusError
    if (typeof e.status === 'number' && RETRYABLE_HTTP_STATUS.has(e.status)) return true
    if (typeof e.mt5Code === 'number' && MT5_RETRYABLE_CODES.has(e.mt5Code)) return true
    if (TRANSIENT_NAMES.has(e.name)) return true
    const code = (e as NodeJS.ErrnoException).code
    if (code && TRANSIENT_CODES.has(code)) return true
    // 429 Too Many Requests detection in message text (bridges wrap errors)
    const msg = e.message ?? ''
    if (/\b(429|too many requests|rate ?limit|temporar|overloaded|try again|timeout|timed out)\b/i.test(msg)) {
      return true
    }
  }
  return false
}

// ============================================
// BACKOFF MATH (exported for tests)
// ============================================

export function computeBackoffDelay(attempt: number, cfg: Pick<RetryConfig, 'baseDelayMs' | 'maxDelayMs' | 'backoffMultiplier' | 'jitterRatio'>): number {
  const raw = cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, Math.max(0, attempt - 1))
  const capped = Math.min(raw, cfg.maxDelayMs)
  if (cfg.jitterRatio <= 0) return Math.round(capped)
  // Full jitter: uniform between (1 - ratio) * capped .. capped
  const low = capped * (1 - Math.min(1, cfg.jitterRatio))
  const jittered = low + Math.random() * (capped - low)
  return Math.max(0, Math.round(jittered))
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

// ============================================
// CORE RETRY EXECUTOR
// ============================================

/** Default config taken from validated environment. */
export function defaultRetryConfig(): RetryConfig {
  const e = env()
  return {
    maxAttempts: 1 + e.BRIDGE_MAX_RETRIES,
    baseDelayMs: e.BRIDGE_RETRY_BASE_DELAY_MS,
    maxDelayMs: e.BRIDGE_RETRY_MAX_DELAY_MS,
    backoffMultiplier: 2,
    jitterRatio: 1,
  }
}

/**
 * Execute `fn` with retry + exponential backoff on transient failures.
 * Non-transient errors rethrow immediately (no retry).
 */
export async function executeWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  cfg?: Partial<RetryConfig>
): Promise<RetryOutcome<T>> {
  const config: RetryConfig = { ...defaultRetryConfig(), ...cfg }
  const maxAttempts = Math.max(1, Math.floor(config.maxAttempts))

  let attempt = 0
  let totalDelayMs = 0

  // Immediate abort check
  if (config.signal?.aborted) throw new DOMException('Aborted before start', 'AbortError')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++
    try {
      const result = await fn(attempt)
      return { result, attempts: attempt, totalDelayMs, succeededAfterRetry: attempt > 1 }
    } catch (err) {
      const transient = isTransientError(err, config.isRetryable)
      const attemptsLeft = maxAttempts - attempt

      if (!transient || attemptsLeft <= 0) {
        if (transient) {
          throw new RetryExhaustedError(attempt, totalDelayMs, err)
        }
        throw err
      }

      const nextDelayMs = computeBackoffDelay(attempt, config)
      totalDelayMs += nextDelayMs

      config.onRetry?.({
        attempt,
        error: err,
        nextDelayMs,
        attemptsLeft: attemptsLeft - 1,
      })

      await sleep(nextDelayMs, config.signal)
    }
  }
}

/** Convenience wrapper — returns only the result. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, cfg?: Partial<RetryConfig>): Promise<T> {
  const outcome = await executeWithRetry(fn, cfg)
  return outcome.result
}
