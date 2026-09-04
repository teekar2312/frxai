// MT5 connection module — circuit breaker, DB-backed state persistence,
// rolling metrics aggregation, and connection quality score.
// Split from src/lib/mt5-connection.ts (v2.1.0 refactor — pure code movement).
// Re-exported unchanged through the facade at src/lib/mt5-connection.ts.

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"
import { env } from "@/lib/env-validation"

// ============================================
// CIRCUIT BREAKER PATTERN
// ============================================

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN"

/**
 * Error thrown when the circuit breaker is OPEN and rejects a call.
 */
export class CircuitBreakerOpenError extends Error {
  public readonly state: CircuitBreakerState
  public readonly failureCount: number
  public readonly nextRetryAt: Date

  constructor(failureCount: number, nextRetryAt: Date) {
    super(
      `Circuit breaker is OPEN (${failureCount} failures). Next retry allowed at ${nextRetryAt.toISOString()}`
    )
    this.name = "CircuitBreakerOpenError"
    this.state = "OPEN"
    this.failureCount = failureCount
    this.nextRetryAt = nextRetryAt
  }
}

interface CircuitBreakerConfig {
  /** Number of consecutive failures before tripping to OPEN */
  failureThreshold: number
  /** Milliseconds to wait before transitioning OPEN → HALF_OPEN */
  recoveryTimeoutMs: number
  /** Maximum calls allowed during HALF_OPEN probe */
  halfOpenMaxAttempts: number
  /**
   * Persistence hook — invoked (fire-and-forget) on every state transition
   * so the breaker survives process restarts. Wired to the database by
   * default (see CIRCUIT BREAKER STATE PERSISTENCE below).
   */
  onStateChange?: (snapshot: CircuitBreakerSnapshot) => void
}

/** Serializable state snapshot for persistence & restoration. */
export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState
  failureCount: number
  successCount: number
  halfOpenAttempts: number
  openedAt: string | null
  capturedAt: string
}

/**
 * Circuit breaker that wraps MT5 API calls to prevent cascading failures.
 *
 * States:
 *   CLOSED  — Normal operation. Failures are counted; successes reset the counter.
 *   OPEN    — Tripped. All calls are rejected immediately with CircuitBreakerOpenError.
 *   HALF_OPEN — Recovery probe. A limited number of calls are allowed to test the service.
 */
export class CircuitBreaker {
  private _state: CircuitBreakerState = "CLOSED"
  private _failureCount = 0
  private _successCount = 0
  private _halfOpenAttempts = 0
  private _openedAt: Date | null = null
  private readonly _config: CircuitBreakerConfig

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this._config = {
      failureThreshold: config?.failureThreshold ?? 5,
      recoveryTimeoutMs: config?.recoveryTimeoutMs ?? 30_000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 1,
    }
  }

  get state(): CircuitBreakerState {
    this._maybeTransitionToHalfOpen()
    return this._state
  }

  get failureCount(): number {
    return this._failureCount
  }

  get successCount(): number {
    return this._successCount
  }

  /** Execute a function through the circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this._maybeTransitionToHalfOpen()

    if (this._state === "OPEN") {
      throw new CircuitBreakerOpenError(this._failureCount, this._nextRetryAt())
    }

    if (this._state === "HALF_OPEN") {
      if (this._halfOpenAttempts >= this._config.halfOpenMaxAttempts) {
        throw new CircuitBreakerOpenError(this._failureCount, this._nextRetryAt())
      }
      this._halfOpenAttempts++
    }

    try {
      const result = await fn()
      this._onSuccess()
      return result
    } catch (err) {
      this._onFailure()
      throw err
    }
  }

  /** Manually reset the circuit breaker to CLOSED. */
  reset(): void {
    this._state = "CLOSED"
    this._failureCount = 0
    this._successCount = 0
    this._halfOpenAttempts = 0
    this._openedAt = null
    logger.info("MT5_CONNECTION", "Circuit breaker manually reset to CLOSED")
    this._emitStateChange()
  }

  /** Manually trip the circuit breaker to OPEN. */
  trip(): void {
    this._state = "OPEN"
    this._openedAt = new Date()
    logger.warn("MT5_CONNECTION", `Circuit breaker manually tripped to OPEN (${this._failureCount} failures)`)
    this._emitStateChange()
  }

  /** Capture a serializable snapshot (for persistence/tests). */
  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this._state,
      failureCount: this._failureCount,
      successCount: this._successCount,
      halfOpenAttempts: this._halfOpenAttempts,
      openedAt: this._openedAt ? this._openedAt.toISOString() : null,
      capturedAt: new Date().toISOString(),
    }
  }

  /**
   * Restore state from a persisted snapshot (e.g. after a server restart).
   * Age-aware: an OPEN breaker whose recovery timeout already elapsed is
   * restored as HALF_OPEN so recovery probing resumes immediately.
   */
  restore(snapshot: CircuitBreakerSnapshot): void {
    this._failureCount = snapshot.failureCount ?? 0
    this._successCount = snapshot.successCount ?? 0
    this._halfOpenAttempts = snapshot.halfOpenAttempts ?? 0
    const openedAt = snapshot.openedAt ? new Date(snapshot.openedAt) : null
    const validOpenedAt = openedAt && !isNaN(openedAt.getTime()) ? openedAt : null

    this._state = snapshot.state === "OPEN" || snapshot.state === "HALF_OPEN" ? snapshot.state : "CLOSED"
    this._openedAt = validOpenedAt

    if (this._state === "OPEN" && validOpenedAt) {
      // If recovery timeout already elapsed while the server was down,
      // resume as HALF_OPEN so probes start immediately.
      if (Date.now() - validOpenedAt.getTime() >= this._config.recoveryTimeoutMs) {
        this._state = "HALF_OPEN"
        this._halfOpenAttempts = 0
        logger.info("MT5_CONNECTION", "Circuit breaker restored OPEN→HALF_OPEN (recovery timeout elapsed during downtime)")
      }
    }

    logger.info("MT5_CONNECTION", `Circuit breaker state restored: ${this._state} (failures: ${this._failureCount})`)
  }

  private _emitStateChange(): void {
    try {
      this._config.onStateChange?.(this.snapshot())
    } catch { /* persistence must never break the breaker */ }
  }

  private _onSuccess(): void {
    this._successCount++
    if (this._state === "HALF_OPEN") {
      // Recovery probe succeeded → close the circuit
      this._state = "CLOSED"
      this._failureCount = 0
      this._halfOpenAttempts = 0
      this._openedAt = null
      logger.info("MT5_CONNECTION", "HALF_OPEN probe succeeded → CLOSED")
      this._emitStateChange()
    } else {
      // In CLOSED state, reset failure counter on success
      if (this._failureCount !== 0) {
        this._failureCount = 0
        this._emitStateChange()
      }
    }
  }

  private _onFailure(): void {
    this._failureCount++
    if (this._state === "HALF_OPEN") {
      // Recovery probe failed → back to OPEN
      this._state = "OPEN"
      this._openedAt = new Date()
      this._halfOpenAttempts = 0
      logger.warn(
        "MT5_CONNECTION",
        `HALF_OPEN probe failed → OPEN (failures: ${this._failureCount})`
      )
      this._emitStateChange()
    } else if (this._failureCount >= this._config.failureThreshold) {
      // Threshold reached → trip to OPEN
      this._state = "OPEN"
      this._openedAt = new Date()
      logger.warn(
        "MT5_CONNECTION",
        `CLOSED → OPEN (failures: ${this._failureCount}/${this._config.failureThreshold})`
      )
      this._emitStateChange()
    } else if (this._failureCount % 1 === 0) {
      // Persist failure counter growth (debounced: only meaningful counts)
      if (this._failureCount >= Math.max(1, Math.floor(this._config.failureThreshold / 2))) {
        this._emitStateChange()
      }
    }
  }

  private _maybeTransitionToHalfOpen(): void {
    if (this._state === "OPEN" && this._openedAt) {
      const elapsed = Date.now() - this._openedAt.getTime()
      if (elapsed >= this._config.recoveryTimeoutMs) {
        this._state = "HALF_OPEN"
        this._halfOpenAttempts = 0
        logger.info("MT5_CONNECTION", "OPEN → HALF_OPEN (recovery timeout elapsed)")
        this._emitStateChange()
      }
    }
  }

  private _nextRetryAt(): Date {
    if (!this._openedAt) return new Date()
    return new Date(this._openedAt.getTime() + this._config.recoveryTimeoutMs)
  }
}

/**
 * Shared module-level circuit breaker instance — preserves state across
 * calls AND restarts:
 *   - onStateChange → auto-persists every transition to the database
 *     (both the Mt5ConnectionState columns and a rich SystemConfig snapshot)
 *   - scheduleCircuitBreakerRestore() → reloads state at process boot
 */
const defaultCircuitBreaker = new CircuitBreaker({
  onStateChange: (snapshot) => {
    // Fire-and-forget persistence — never blocks the protected call
    void persistCircuitBreakerSnapshot(snapshot)
    void mirrorSnapshotToSystemConfig(snapshot)
  },
})

// ============================================
// CIRCUIT BREAKER STATE PERSISTENCE (v2)
// ============================================

/** Row id for the singleton MT5 connection state. */
const CB_STATE_ROW_ID = 'main'
let restoreAttempted = false

/** Mirror the full snapshot into SystemConfig for lossless restore. */
function mirrorSnapshotToSystemConfig(snapshot: CircuitBreakerSnapshot): void {
  void db.systemConfig
    .upsert({
      where: { key: '__circuit_breaker_snapshot__' },
      create: { key: '__circuit_breaker_snapshot__', value: JSON.stringify(snapshot) },
      update: { value: JSON.stringify(snapshot) },
    })
    .catch(() => { /* best effort mirror */ })
}

/** Persist a snapshot to Mt5ConnectionState (columns incl. openUntil). */
export async function persistCircuitBreakerSnapshot(snapshot: CircuitBreakerSnapshot): Promise<void> {
  if (!env().CB_PERSIST_ENABLED) return
  try {
    const openedAt = snapshot.openedAt ? new Date(snapshot.openedAt) : null
    const openUntil =
      snapshot.state === 'OPEN' && openedAt && !isNaN(openedAt.getTime())
        ? new Date(openedAt.getTime() + env().CB_RECOVERY_TIMEOUT_MS)
        : null
    await db.mt5ConnectionState.upsert({
      where: { id: CB_STATE_ROW_ID },
      create: {
        id: CB_STATE_ROW_ID,
        circuitState: snapshot.state,
        circuitFailureCount: snapshot.failureCount,
        circuitLastFailure: snapshot.state === 'OPEN' || snapshot.state === 'HALF_OPEN' ? new Date() : null,
        circuitOpenUntil: openUntil,
      },
      update: {
        circuitState: snapshot.state,
        circuitFailureCount: snapshot.failureCount,
        circuitLastFailure: snapshot.state === 'OPEN' || snapshot.state === 'HALF_OPEN' ? new Date() : null,
        circuitOpenUntil: openUntil,
      },
    })
  } catch (err) {
    logger.error('MT5_CONNECTION', 'Failed to persist circuit breaker state', {
      details: err instanceof Error ? err.stack : undefined,
    } as never)
  }
}

/**
 * Back-compat wrapper — persist a breaker's current state.
 */
export async function persistCircuitBreakerState(cb: CircuitBreaker): Promise<void> {
  await persistCircuitBreakerSnapshot(cb.snapshot())
}

/**
 * RESTORE the circuit breaker state from the database.
 *
 * Called automatically once per process (lazy, idempotent) so a restart
 * does not wipe a tripped breaker — the OPEN state and failure count
 * survive, and an expired OPEN becomes HALF_OPEN for immediate probing.
 *
 * Returns the restored snapshot (or null when nothing was persisted).
 */
export async function restoreCircuitBreakerFromDb(cb: CircuitBreaker = defaultCircuitBreaker): Promise<CircuitBreakerSnapshot | null> {
  try {
    // Prefer the rich snapshot stored in SystemConfig (v2)
    const sys = await db.systemConfig.findUnique({ where: { key: '__circuit_breaker_snapshot__' } })
    if (sys) {
      try {
        const snapshot = JSON.parse(sys.value) as CircuitBreakerSnapshot
        if (snapshot && typeof snapshot.state === 'string' && snapshot.state !== 'CLOSED') {
          cb.restore(snapshot)
          return snapshot
        }
        if (snapshot && typeof snapshot.state === 'string' && snapshot.state === 'CLOSED' && (snapshot.failureCount ?? 0) > 0) {
          cb.restore(snapshot)
          return snapshot
        }
      } catch { /* fall through to legacy restore */ }
    }

    // Legacy restore from Mt5ConnectionState columns
    const row = await db.mt5ConnectionState.findUnique({ where: { id: CB_STATE_ROW_ID } })
    if (!row) return null
    const snapshot: CircuitBreakerSnapshot = {
      state: (row.circuitState as CircuitBreakerState) ?? 'CLOSED',
      failureCount: row.circuitFailureCount ?? 0,
      successCount: 0,
      halfOpenAttempts: 0,
      openedAt: row.circuitLastFailure ? row.circuitLastFailure.toISOString() : null,
      capturedAt: new Date().toISOString(),
    }
    if (snapshot.state === 'CLOSED' && snapshot.failureCount === 0) return null
    cb.restore(snapshot)
    return snapshot
  } catch (err) {
    logger.error('MT5_CONNECTION', 'Failed to restore circuit breaker state', {
      details: err instanceof Error ? err.message : String(err),
    } as never)
    return null
  }
}

/**
 * Lazy one-shot restore wired at module load. Runs in the background so
 * imports never block; double invocation is a no-op.
 */
function scheduleCircuitBreakerRestore(): void {
  if (restoreAttempted) return
  restoreAttempted = true
  void (async () => {
    const snapshot = await restoreCircuitBreakerFromDb(defaultCircuitBreaker)
    if (snapshot && snapshot.state !== 'CLOSED') {
      logger.warn('MT5_CONNECTION', `Restored non-closed circuit breaker after restart: ${snapshot.state} (failures: ${snapshot.failureCount})`)
      // Also dispatch a notification so operators know the breaker carried over
      try {
        const { notifyAsync } = await import('@/lib/notifier')
        notifyAsync({
          eventType: 'CIRCUIT_BREAKER',
          title: 'Circuit breaker state restored after restart',
          body: `The MT5 circuit breaker resumed in ${snapshot.state} state with ${snapshot.failureCount} recorded failure(s).`,
          severity: snapshot.state === 'OPEN' ? 'ERROR' : 'WARN',
          fields: { state: snapshot.state, failures: snapshot.failureCount, opened_at: snapshot.openedAt ?? 'n/a' },
        })
      } catch { /* notifier is optional */ }
    }
  })()
}

scheduleCircuitBreakerRestore()

// ============================================
// CONNECTION QUALITY SCORE
// ============================================

// ============================================
// CONNECTION METRICS ROLLING AGGREGATION
// ============================================

/**
 * Rolling window metrics aggregator for MT5 connection quality.
 */
export class ConnectionMetricsAggregator {
  private latencies: number[] = []
  private results: Array<{ success: boolean; time: Date }> = []
  private readonly maxSamples: number

  constructor(maxSamples: number = 100) {
    this.maxSamples = maxSamples
  }

  recordLatency(ms: number): void {
    this.latencies.push(ms)
    if (this.latencies.length > this.maxSamples) this.latencies.shift()
  }

  recordResult(success: boolean): void {
    this.results.push({ success, time: new Date() })
    if (this.results.length > this.maxSamples) this.results.shift()
  }

  getAvgLatency(): number {
    if (this.latencies.length === 0) return 0
    return Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length)
  }

  getP99Latency(): number {
    if (this.latencies.length === 0) return 0
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * 0.99)
    return sorted[Math.min(idx, sorted.length - 1)]
  }

  getSuccessRate(): number {
    if (this.results.length === 0) return 1
    const recent = this.results.slice(-60) // last 60 calls
    return recent.filter(r => r.success).length / recent.length
  }

  getSuccessRateLastHour(): number {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recent = this.results.filter(r => r.time >= oneHourAgo)
    if (recent.length === 0) return 1
    return recent.filter(r => r.success).length / recent.length
  }
}

/** Singleton metrics aggregator */
export const connectionMetrics = new ConnectionMetricsAggregator()

// ============================================
// CONNECTION QUALITY SCORE
// ============================================

interface ConnectionQualityParams {
  latencyMs: number
  successRate: number       // 0.0 – 1.0
  consecutiveFailures: number
  uptimeSeconds: number
}

/**
 * Calculate a single 0–100 connection quality score from multiple metrics.
 *
 * Components:
 *   - Latency score:   <50ms → 100, 50–100 → 90, 100–200 → 70, 200–500 → 40, >500 → 10
 *   - Success rate:    weighted 40%
 *   - Consecutive failures: 0 → 100, 1 → 80, 2 → 50, 3+ → 10
 *   - Uptime:          <1min → 50, 1–10min → 70, >10min → 90, >1h → 100
 *
 * Final = latency*30% + successRate*40% + consecutiveFailures*15% + uptime*15%
 */
export function calculateConnectionQuality(params: ConnectionQualityParams): number {
  const { latencyMs, successRate, consecutiveFailures, uptimeSeconds } = params

  // --- Latency score (30% weight) ---
  let latencyScore: number
  if (latencyMs < 50) {
    latencyScore = 100
  } else if (latencyMs <= 100) {
    latencyScore = 90
  } else if (latencyMs <= 200) {
    latencyScore = 70
  } else if (latencyMs <= 500) {
    latencyScore = 40
  } else {
    latencyScore = 10
  }

  // --- Success rate score (40% weight, already 0-100 when multiplied) ---
  const successRateScore = successRate * 100

  // --- Consecutive failures score (15% weight) ---
  let failureScore: number
  if (consecutiveFailures === 0) {
    failureScore = 100
  } else if (consecutiveFailures === 1) {
    failureScore = 80
  } else if (consecutiveFailures === 2) {
    failureScore = 50
  } else {
    failureScore = 10
  }

  // --- Uptime score (15% weight) ---
  let uptimeScore: number
  if (uptimeSeconds < 60) {
    uptimeScore = 50
  } else if (uptimeSeconds <= 600) {
    uptimeScore = 70
  } else if (uptimeSeconds <= 3600) {
    uptimeScore = 90
  } else {
    uptimeScore = 100
  }

  const total =
    latencyScore * 0.30 +
    successRateScore * 0.40 +
    failureScore * 0.15 +
    uptimeScore * 0.15

  // Clamp to 0-100
  return Math.round(Math.max(0, Math.min(100, total)))
}

// ---- Cross-part sharing (internal plumbing) ----
// defaultCircuitBreaker was module-private before the split; it is the shared
// singleton consumed by ./connection-manager.ts (executeOrderWithRetry fallback).
// Declared exactly once here (its owning module) and shared via export-list so
// the facade's re-exported declaration set stays identical to the pre-split module.

export { defaultCircuitBreaker }
