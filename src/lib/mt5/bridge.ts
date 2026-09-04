// MT5 connection module — bridge HTTP client (retry-hardened).
// Split from src/lib/mt5-connection.ts (v2.1.0 refactor — pure code movement).
// Internal module: bridgeRequest was module-private before the split, so the
// facade does NOT re-export this file; ./connection-manager.ts imports it directly.

import logger, { type LogCategory } from "@/lib/trading-logger"
import { env } from "@/lib/env-validation"
import { executeWithRetry, isTransientError, withStatus, type RetryAttemptInfo } from "@/lib/retry"
import { observeHistogram, incrementCounter } from "@/lib/metrics"
import { getConfig } from "@/lib/app-config"

// ============================================
// MT5 BRIDGE CLIENT (retry-hardened)
// ============================================

const MT5_BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:3001'

/** Extra classifier: bridge HTTP-level errors + MT5 codes worth retrying. */
function isBridgeRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message ?? ''
    // Bridge transport hiccups
    if (/\bBridge (5\d\d|408|429)\b/.test(msg)) return true
    // MT5 bridge business errors that are documented transient
    if (/\b(10004|10006|10008|10021|10027)\b/.test(msg)) return true
  }
  return isTransientError(err)
}

/**
 * Bridge request with retry for TRANSIENT failures (timeouts, connection
 * resets, HTTP 408/425/429/5xx, MT5 retryable codes).
 *
 * Non-transient failures (HTTP 4xx validation, auth errors, MT5 hard
 * rejects) fail fast without burning retries.
 */
async function bridgeRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const timeoutMs = env().BRIDGE_TIMEOUT_MS
  const url = `${MT5_BRIDGE_URL}${path}`
  const startedAt = Date.now()

  const onRetry = (info: RetryAttemptInfo) => {
    logger.warn('MT5_CONNECTION' as LogCategory, `Bridge transient failure — retrying ${path}`, {
      metadata: {
        attempt: info.attempt,
        nextDelayMs: info.nextDelayMs,
        attemptsLeft: info.attemptsLeft,
        error: info.error instanceof Error ? info.error.message : String(info.error),
      },
    } as never)
  }

  const outcome = await executeWithRetry(
    async (attempt) => {
      const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw withStatus(new Error(`Bridge ${res.status}: ${body.slice(0, 300)}`), res.status)
      }
      // Empty-body success (204 etc.) → tolerate JSON parse
      const text = await res.text().catch(() => '')
      if (!text) return {} as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new Error(`Bridge 502: invalid JSON from ${path} (attempt ${attempt})`)
      }
    },
    {
      maxAttempts: 1 + getConfig<number>('bridge.maxRetries'),
      baseDelayMs: getConfig<number>('bridge.retryBaseDelayMs'),
      maxDelayMs: getConfig<number>('bridge.retryMaxDelayMs'),
      jitterRatio: 1,
      isRetryable: isBridgeRetryable,
      onRetry,
    }
  )

  // Observability
  const latency = Date.now() - startedAt
  observeHistogram('bridge_request_latency_ms', latency, { path })
  incrementCounter('bridge_requests_total', { path, outcome: outcome.succeededAfterRetry ? 'retried' : 'first_try' })

  return outcome.result
}

// Shared with ./connection-manager.ts (connect/heartbeat/order execution paths).
// Internal — never part of the original public API, hence not re-exported by the facade.
export { bridgeRequest }
