/**
 * FRxAI — Standardized API Error Responses with Recovery Hints
 * =============================================================
 * Addresses the audit finding "Error handling hanya log tanpa recovery
 * action": instead of bare `{ success: false, error: msg }` 500s, every
 * classified failure returns:
 *   - a stable machine-readable `code`
 *   - a human/actionable `recovery` hint (what to do next)
 *   - a `retryable` flag (+ `retryAfterMs` where known)
 *
 * The response shape is backward compatible with existing clients:
 * `error` remains the message string; new fields are additive.
 *
 * Design mirrors rate-limit.ts: pure `build*` functions (unit-testable,
 * no next/server dependency) + thin `apiErrorResponse()` wrapper for
 * route handlers.
 */

import { NextResponse } from 'next/server'
import { RetryExhaustedError, isTransientError, type HttpStatusError } from './retry'

// ============================================
// TYPES
// ============================================

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'MARKET_CLOSED'
  | 'BRIDGE_UNREACHABLE'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'BRIDGE_TIMEOUT'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR'

export interface ApiErrorInit {
  status: number
  code: ApiErrorCode
  message: string
  /** Actionable hint: what the caller should do next. */
  recovery: string
  /** Whether repeating the same request can succeed later. */
  retryable: boolean
  /** Suggested wait before retrying (ms), when known. */
  retryAfterMs?: number
}

/** Typed error that business logic can throw to carry recovery context. */
export class ApiError extends Error {
  public readonly status: number
  public readonly code: ApiErrorCode
  public readonly recovery: string
  public readonly retryable: boolean
  public readonly retryAfterMs?: number

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.recovery = init.recovery
    this.retryable = init.retryable
    this.retryAfterMs = init.retryAfterMs
  }
}

export interface ApiErrorResponseInit {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

// ============================================
// RECOVERY HINTS
// ============================================

const RECOVERY_HINTS: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR:
    'Fix the request payload: check field types and ranges in the error message, then retry. See API.md for the endpoint schema.',
  NOT_FOUND:
    'Verify the resource id — it may have been closed, deleted, or rotated. Refresh the list and retry with a current id.',
  CONFLICT:
    'The resource state changed concurrently. Re-fetch the current state before retrying (avoid double-submit).',
  RATE_LIMITED:
    'Slow down: respect the X-RateLimit-Limit / Retry-After headers and retry after the indicated window.',
  UNAUTHORIZED:
    'Check MT5 credentials (MT5_LOGIN/MT5_PASSWORD) and reconnect via POST /api/mt5/connect, then retry.',
  MARKET_CLOSED:
    'Wait for the next trading session (see /api/sessions for phase schedule) or switch to a symbol on an open market.',
  BRIDGE_UNREACHABLE:
    'Check that the MT5 bridge service is running (mini-services/mt5-bridge, port 3001) and MT5_BRIDGE_URL is correct; use GET /api/health for a readiness probe.',
  CIRCUIT_BREAKER_OPEN:
    'The bridge circuit breaker is open after repeated failures. Wait for the recovery window (default 30s, see CB_RECOVERY_TIMEOUT_MS), then retry once. Persistent tripping indicates bridge or MT5 server issues.',
  BRIDGE_TIMEOUT:
    'The bridge responded too slowly. Retry with exponential backoff; if it persists, check bridge load (GET /api/health) and increase BRIDGE_TIMEOUT_MS.',
  DATABASE_ERROR:
    'Database operation failed. Verify the SQLite file path (DATABASE_URL) and schema state (`bun run db:push`); check /api/health → database check.',
  INTERNAL_ERROR:
    'Inspect server logs (System Logs tab or /api/logs) for the stack trace. If the failure persists, restart the service and run GET /api/health for a full readiness check.',
}

// ============================================
// CLASSIFICATION (pure — unit-testable)
// ============================================

/** Prisma error shape (duck-typed to avoid a hard Prisma import here). */
interface PrismaLikeError {
  name?: string
  code?: string
  message?: string
}

function isPrismaError(err: unknown): err is PrismaLikeError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as PrismaLikeError).code === 'string' &&
    ((err as PrismaLikeError).code ?? '').startsWith('P')
  )
}

/** Extract a readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/**
 * Classify any thrown value into a structured API error with a recovery
 * hint. Handles: ApiError (passthrough), RetryExhaustedError, circuit
 * breaker open, Zod validation, Prisma codes, market-closed markers and
 * generic Error fallbacks.
 */
export function classifyApiError(err: unknown): ApiErrorInit {
  // 1. Typed ApiError — passthrough
  if (err instanceof ApiError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      recovery: err.recovery,
      retryable: err.retryable,
      retryAfterMs: err.retryAfterMs,
    }
  }

  const msg = errorMessage(err)

  // 2. Retry engine exhausted → bridge unreachable (already retried N times)
  if (err instanceof RetryExhaustedError) {
    const transient = isTransientError(err.lastError)
    return {
      status: 502,
      code: transient ? 'BRIDGE_UNREACHABLE' : 'BRIDGE_TIMEOUT',
      message: `Bridge request failed after ${err.attempts} attempts: ${msg}`,
      recovery: RECOVERY_HINTS[transient ? 'BRIDGE_UNREACHABLE' : 'BRIDGE_TIMEOUT'],
      retryable: true,
    }
  }

  // 3. Circuit breaker open (detected by name to avoid importing the heavy
  //    mt5-connection → db module into this classifier's import graph)
  if (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'CircuitBreakerOpenError') {
    const nextRetryAt = (err as { nextRetryAt?: Date }).nextRetryAt
    const retryAfterMs = nextRetryAt instanceof Date ? Math.max(0, nextRetryAt.getTime() - Date.now()) : undefined
    return {
      status: 503,
      code: 'CIRCUIT_BREAKER_OPEN',
      message: msg,
      recovery: RECOVERY_HINTS.CIRCUIT_BREAKER_OPEN,
      retryable: true,
      retryAfterMs,
    }
  }

  // 4. Zod validation errors
  if (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ZodError') {
    const issues = (err as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues ?? []
    const detail = issues
      .slice(0, 5)
      .map(i => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: detail ? `Invalid request: ${detail}` : msg,
      recovery: RECOVERY_HINTS.VALIDATION_ERROR,
      retryable: false,
    }
  }

  // 5. Prisma error codes
  if (isPrismaError(err)) {
    switch (err.code) {
      case 'P2025':
        return {
          status: 404,
          code: 'NOT_FOUND',
          message: `Record not found: ${msg}`,
          recovery: RECOVERY_HINTS.NOT_FOUND,
          retryable: false,
        }
      case 'P2002':
        return {
          status: 409,
          code: 'CONFLICT',
          message: `Unique constraint violated: ${msg}`,
          recovery: RECOVERY_HINTS.CONFLICT,
          retryable: false,
        }
      case 'P1003':
      case 'P2021':
        return {
          status: 500,
          code: 'DATABASE_ERROR',
          message: `Database/schema problem: ${msg}`,
          recovery: RECOVERY_HINTS.DATABASE_ERROR,
          retryable: false,
        }
      default:
        return {
          status: 500,
          code: 'DATABASE_ERROR',
          message: `Database error (${err.code}): ${msg}`,
          recovery: RECOVERY_HINTS.DATABASE_ERROR,
          retryable: false,
        }
    }
  }

  // 6. Status-tagged errors (via withStatus from retry.ts)
  const statusTag = (err as HttpStatusError | undefined)?.status
  if (typeof statusTag === 'number') {
    if (statusTag === 401)
      return { status: 401, code: 'UNAUTHORIZED', message: msg, recovery: RECOVERY_HINTS.UNAUTHORIZED, retryable: false }
    if (statusTag === 404)
      return { status: 404, code: 'NOT_FOUND', message: msg, recovery: RECOVERY_HINTS.NOT_FOUND, retryable: false }
    if (statusTag === 409)
      return { status: 409, code: 'CONFLICT', message: msg, recovery: RECOVERY_HINTS.CONFLICT, retryable: false }
    if (statusTag === 429)
      return { status: 429, code: 'RATE_LIMITED', message: msg, recovery: RECOVERY_HINTS.RATE_LIMITED, retryable: true }
    if (statusTag >= 500)
      return {
        status: 502,
        code: 'BRIDGE_UNREACHABLE',
        message: msg,
        recovery: RECOVERY_HINTS.BRIDGE_UNREACHABLE,
        retryable: isTransientError(err),
      }
  }

  // 7. Market-closed / session markers emitted by the trading stack
  if (/market (is )?closed|outside trading (hours|session)|weekend|IDX closed/i.test(msg)) {
    return {
      status: 409,
      code: 'MARKET_CLOSED',
      message: msg,
      recovery: RECOVERY_HINTS.MARKET_CLOSED,
      retryable: true,
    }
  }

  // 8. Fallback — internal error (still carries a recovery hint)
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: msg,
    recovery: RECOVERY_HINTS.INTERNAL_ERROR,
    retryable: false,
  }
}

// ============================================
// RESPONSE BUILDERS (pure — unit-testable)
// ============================================

export interface ApiErrorContext {
  /** Route identifier for logs/metrics, e.g. 'POST /api/trades/execute'. */
  route?: string
  /** Correlation id — mirrored into the response headers. */
  requestId?: string
}

/** Build the JSON body fields for a classified error. */
export function buildApiErrorBody(classified: ApiErrorInit, context?: ApiErrorContext) {
  return {
    success: false as const,
    error: classified.message,
    code: classified.code,
    recovery: classified.recovery,
    retryable: classified.retryable,
    ...(classified.retryAfterMs !== undefined ? { retryAfterMs: classified.retryAfterMs } : {}),
    ...(context?.route ? { route: context.route } : {}),
  }
}

/** Pure ResponseInit for a classified error (mirrors rate-limit.ts pattern). */
export function buildApiErrorResponse(err: unknown, context?: ApiErrorContext): ApiErrorResponseInit {
  const classified = classifyApiError(err)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (classified.retryAfterMs !== undefined) headers['Retry-After'] = String(Math.ceil(classified.retryAfterMs / 1000))
  if (context?.requestId) headers['X-Request-Id'] = context.requestId
  return {
    status: classified.status,
    statusText: STATUS_TEXT[classified.status] ?? 'Error',
    headers,
    body: JSON.stringify(buildApiErrorBody(classified, context)),
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

// ============================================
// ROUTE HELPER (thin wrapper — imports next/server)
// ============================================

/**
 * Convert any caught error into a standardized NextResponse.
 * Usage in a route handler:
 *
 *   } catch (err) {
 *     return apiErrorResponse(err, { route: 'POST /api/trades/execute' })
 *   }
 */
export function apiErrorResponse(err: unknown, context?: ApiErrorContext): NextResponse {
  const init = buildApiErrorResponse(err, context)
  return new NextResponse(init.body, {
    status: init.status,
    statusText: init.statusText,
    headers: init.headers,
  })
}
