// MT5 connection module — Mt5ConnectionManager class, timeout utility,
// order execution pipeline, bridge helper functions, and the `mt5Connection`
// singleton (default export).
// Split from src/lib/mt5-connection.ts (v2.1.0 refactor — pure code movement).
// Re-exported unchanged through the facade at src/lib/mt5-connection.ts.

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"
import { AsyncMutex } from "./mutex"
import { SYMBOL_MAP, MT5_ERROR_CODE_MAP, seedMt5ErrorCodes, getTradingPhase, isMarketOpen } from "./symbols"
import { DEFAULT_CONFIG, emitStatusChange } from "./config"
import type { Mt5Config, ConnectionMetrics } from "./config"
import { bridgeRequest } from "./bridge"
import { CircuitBreaker, CircuitBreakerOpenError, defaultCircuitBreaker } from "./circuit-breaker"
import type { Mt5Status, TradingPhase, SymbolMappingEntry, Mt5ErrorCodeEntry } from "./types"

// ============================================
// CONNECTION MANAGER CLASS
// ============================================

class Mt5ConnectionManager {
  private status: Mt5Status = "DISCONNECTED"
  private config: Mt5Config | null = null
  private metrics: ConnectionMetrics = {
    latencyMs: 0,
    uptimeSeconds: 0,
    reconnectCount: 0,
    lastHeartbeat: null,
    connectedAt: null,
    lastError: null,
    consecutiveHeartbeatFailures: 0,
    currentTradingPhase: getTradingPhase(),
    marketIsOpen: isMarketOpen(),
  }
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private uptimeTimer: ReturnType<typeof setInterval> | null = null
  private tradingPhaseTimer: ReturnType<typeof setInterval> | null = null
  private isShuttingDown = false
  private previousPhase: TradingPhase | null = null
  private previousMarketOpen: boolean | null = null

  /** Deep Audit Fix #3: Counter to throttle DB writes on heartbeat */
  private _heartbeatCountSinceLastPersist = 0

  /** Async mutex to serialize all MT5 API calls */
  public readonly mutex = new AsyncMutex()

  // ---- Public API ----

  getStatus(): Mt5Status {
    return this.status
  }

  getMetrics(): ConnectionMetrics {
    return { ...this.metrics }
  }

  isConnected(): boolean {
    return this.status === "CONNECTED" || this.status === "DEGRADED"
  }

  getTradingPhase(): TradingPhase {
    return this.metrics.currentTradingPhase
  }

  isMarketOpen(): boolean {
    return this.metrics.marketIsOpen
  }

  getSymbolMapping(symbol: string): SymbolMappingEntry | undefined {
    return SYMBOL_MAP[symbol.toUpperCase()]
  }

  getAllSymbols(): SymbolMappingEntry[] {
    return Object.values(SYMBOL_MAP)
  }

  getErrorCode(code: number): Mt5ErrorCodeEntry | undefined {
    return MT5_ERROR_CODE_MAP.get(code)
  }

  /**
   * Validate MT5 API return data for silent failures.
   * Checks for: empty arrays, null values, zero ticks outside trading hours.
   */
  validateReturn<T>(
    data: T,
    context: string,
    options?: {
      expectArray?: boolean
      expectNonEmpty?: boolean
      expectNonNull?: boolean
      symbol?: string
    }
  ): { valid: boolean; issue?: string; data: T } {
    const { expectArray, expectNonEmpty, expectNonNull, symbol } = options || {}

    // Null/undefined check
    if (data == null) {
      const msg = `MT5 API silent failure: ${context} returned ${data === null ? "null" : "undefined"}`
      logger.warn("MT5_CONNECTION", msg, { symbol, metadata: { context, value: String(data) } })
      return { valid: false, issue: msg, data }
    }

    // Array checks
    if (expectArray && !Array.isArray(data)) {
      const msg = `MT5 API silent failure: ${context} expected array but got ${typeof data}`
      logger.warn("MT5_CONNECTION", msg, { symbol, metadata: { context, type: typeof data } })
      return { valid: false, issue: msg, data }
    }

    if (expectArray && expectNonEmpty && Array.isArray(data) && data.length === 0) {
      // Empty array is OK if market is closed
      if (!this.metrics.marketIsOpen) {
        logger.debug("MT5_CONNECTION", `${context} returned empty array but market is closed (expected)`, { symbol })
        return { valid: true, data }
      }
      // During trading hours, empty array = silent failure
      const msg = `MT5 API silent failure: ${context} returned empty array during market hours`
      logger.warn("MT5_CONNECTION", msg, { symbol, metadata: { context, tradingPhase: this.metrics.currentTradingPhase } })
      return { valid: false, issue: msg, data }
    }

    // Zero-tick check for tick data
    if (expectNonNull && (data as unknown) === 0) {
      if (!this.metrics.marketIsOpen) {
        return { valid: true, data }
      }
      const msg = `MT5 API silent failure: ${context} returned zero value during market hours`
      logger.warn("MT5_CONNECTION", msg, { symbol, metadata: { context } })
      return { valid: false, issue: msg, data }
    }

    return { valid: true, data }
  }

  async connect(login: number, password: string, server?: string): Promise<{ success: boolean; error?: string }> {
    // Clear any pending reconnect timer to prevent duplicate connection attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.status === "CONNECTED" || this.status === "DEGRADED") {
      return { success: true }
    }

    // Reset shutdown flag so auto-reconnect works after manual disconnect → reconnect
    this.isShuttingDown = false

    this.config = {
      ...DEFAULT_CONFIG,
      login,
      password,
      server: server || DEFAULT_CONFIG.server,
    }

    // Lazy seed error codes on first connection
    await seedMt5ErrorCodes()

    logger.info("MT5_CONNECTION", `Initiating connection to ${this.config.server}`, {
      metadata: { login: this.config.login, server: this.config.server },
    })

    try {
      const result = await this.mutex.runExclusive(() => this.attemptConnection())
      if (result.success) {
        await this.onConnected()
        return { success: true }
      } else {
        await this.onConnectionFailed(result.error || "Unknown error")
        return { success: false, error: result.error }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.onConnectionFailed(msg)
      return { success: false, error: msg }
    }
  }

  async disconnect(): Promise<void> {
    this.isShuttingDown = true
    // Notify bridge of disconnect
    try { await bridgeRequest('/disconnect', { method: 'POST' }) } catch { /* bridge may be down */ }
    this.clearTimers()
    await this.setStatus("DISCONNECTED")
    await this.persistState()
    logger.info("MT5_CONNECTION", "Disconnected from MT5 server")
  }

  /**
   * Graceful shutdown: clear all timers, persist state, flush logger.
   * Call this on process exit (SIGTERM, SIGINT) or during hot reload.
   */
  async gracefulShutdown(): Promise<void> {
    logger.info("MT5_CONNECTION", "Initiating graceful shutdown")
    this.isShuttingDown = true

    // 1. Clear all timers
    this.clearTimers()

    // 2. Set status to DISCONNECTED
    const previousStatus = this.status
    this.status = "DISCONNECTED"

    // 3. Persist final state to DB
    try {
      await this.persistState()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error("MT5_CONNECTION", `Failed to persist state during shutdown: ${msg}`)
    }

    // 4. Log the shutdown event
    try {
      await this.logConnectionEvent("DISCONNECTED", `Graceful shutdown (was ${previousStatus})`)
    } catch {
      // Best effort
    }

    // 5. Flush the trading logger buffer
    try {
      await logger.shutdown()
    } catch {
      // Best effort
    }

    logger.info("MT5_CONNECTION", "Graceful shutdown complete")
  }

  // ---- Connection Logic ----

  private async attemptConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.config) {
      return { success: false, error: "No configuration provided" }
    }

    try {
      const startMs = Date.now()
      const result = await bridgeRequest<{ success: boolean; account?: Record<string, unknown>; error?: string }>('/connect', {
        method: 'POST',
        body: JSON.stringify({
          login: this.config.login,
          password: this.config.password,
          server: this.config.server,
        }),
      })
      this.metrics.latencyMs = Date.now() - startMs
      if (!result.success) {
        return { success: false, error: result.error || 'Connection rejected by bridge' }
      }
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.metrics.latencyMs = 5000
      return { success: false, error: `Bridge unreachable: ${msg}` }
    }
  }

  private async onConnected(): Promise<void> {
    // Clear any existing timers before starting new ones (prevents duplicates on reconnect)
    this.clearTimers()

    this.reconnectAttempt = 0
    this.metrics.connectedAt = new Date()
    this.metrics.lastError = null
    this.metrics.consecutiveHeartbeatFailures = 0
    this.metrics.reconnectCount =
      this.status === "RECONNECTING" ? this.metrics.reconnectCount : 0
    this.status = "CONNECTED"

    // Start heartbeat
    this.heartbeatTimer = setInterval(
      () => this.heartbeat(),
      this.config?.heartbeatIntervalMs || 5000
    )

    // Start uptime counter
    this.uptimeTimer = setInterval(() => {
      if (this.metrics.connectedAt) {
        this.metrics.uptimeSeconds = Math.floor(
          (Date.now() - this.metrics.connectedAt.getTime()) / 1000
        )
      }
    }, 1000)

    // Start trading phase monitor
    this.tradingPhaseTimer = setInterval(
      () => this.checkTradingPhase(),
      this.config?.tradingPhaseCheckIntervalMs || 30000
    )

    // Initialize trading phase
    this.updateTradingPhase()

    await this.persistState()
    await this.logConnectionEvent("CONNECTED", "Successfully connected to MT5 server")

    logger.info("MT5_CONNECTION", `Connected to ${this.config?.server} (latency: ${this.metrics.latencyMs}ms)`, {
      metadata: {
        latencyMs: this.metrics.latencyMs,
        accountLogin: this.config?.login,
      },
    })

    emitStatusChange(this.status, this.metrics)
  }

  private async onConnectionFailed(error: string): Promise<void> {
    // Detect auth failure
    if (error.includes("auth") || error.includes("credentials") || error.includes("login")) {
      this.status = "AUTH_FAILED"
      this.metrics.lastError = error
      await this.setStatus("AUTH_FAILED")
      await this.logConnectionEvent("AUTH_FAILED", `Authentication failed: ${error}`)
      logger.critical("MT5_CONNECTION", `Authentication failed: ${error}`)
      emitStatusChange(this.status, this.metrics)
      return
    }

    this.status = "ERROR"
    this.metrics.lastError = error
    await this.setStatus("ERROR")
    await this.logConnectionEvent("ERROR", `Connection error: ${error}`)
    logger.error("MT5_CONNECTION", `Connection failed: ${error}`)
    emitStatusChange(this.status, this.metrics)

    // Auto-reconnect
    if (!this.isShuttingDown) {
      this.scheduleReconnect()
    }
  }

  // ---- DEGRADED State Management ----

  /**
   * Check if we should enter or exit DEGRADED state.
   * DEGRADED triggers when:
   *   - Latency exceeds threshold (default 200ms)
   *   - Consecutive heartbeat failures >= threshold (default 2)
   *
   * PROACTIVE_MC_70: When in DEGRADED state, log a risk event suggesting
   * margin call awareness if margin usage is approaching 70%.
   * PROACTIVE_MC_60: Similar at 60% - more urgent.
   */
  private async evaluateDegradedState(latencyMs: number, heartbeatOk: boolean): Promise<void> {
    const threshold = this.config?.degradedLatencyThresholdMs || 200
    const hbThreshold = this.config?.degradedHeartbeatFailureThreshold || 2

    const wasDegraded = this.status === "DEGRADED"
    const wasConnected = this.status === "CONNECTED"

    if (heartbeatOk) {
      this.metrics.consecutiveHeartbeatFailures = 0
    } else {
      this.metrics.consecutiveHeartbeatFailures++
    }

    const shouldDegrade =
      latencyMs > threshold || this.metrics.consecutiveHeartbeatFailures >= hbThreshold

    const shouldRecover =
      !shouldDegrade &&
      latencyMs <= threshold * 0.8 &&
      this.metrics.consecutiveHeartbeatFailures === 0

    if (shouldDegrade && (wasConnected || wasDegraded) && this.status !== "DEGRADED") {
      // Transition to DEGRADED
      const reason = latencyMs > threshold
        ? `High latency: ${latencyMs}ms > ${threshold}ms threshold`
        : `${this.metrics.consecutiveHeartbeatFailures} consecutive heartbeat failures >= ${hbThreshold}`

      this.status = "DEGRADED"
      await this.setStatus("DEGRADED")
      await this.logConnectionEvent("DEGRADED", reason)
      logger.warn("MT5_CONNECTION", `Connection DEGRADED: ${reason}`, {
        metadata: {
          latencyMs,
          consecutiveFailures: this.metrics.consecutiveHeartbeatFailures,
          threshold,
        },
      })

      // PROACTIVE_MC_70 concept: log risk awareness when in DEGRADED state
      await this.logProactiveMarginCall("PROACTIVE_MC_70", 70)

      emitStatusChange(this.status, this.metrics)
    } else if (shouldRecover && this.status === "DEGRADED") {
      // Recover from DEGRADED back to CONNECTED
      this.status = "CONNECTED"
      await this.setStatus("CONNECTED")
      await this.logConnectionEvent("RECOVERED", `Recovered from DEGRADED (latency: ${latencyMs}ms)`)
      logger.info("MT5_CONNECTION", `Connection recovered from DEGRADED (latency: ${latencyMs}ms)`, {
        metadata: { latencyMs },
      })
      emitStatusChange(this.status, this.metrics)
    } else if (shouldDegrade && this.status === "DEGRADED") {
      // Still in DEGRADED state - check for PROACTIVE_MC_60 if failures increasing
      if (this.metrics.consecutiveHeartbeatFailures >= hbThreshold + 1) {
        await this.logProactiveMarginCall("PROACTIVE_MC_60", 60)
      }
    }
  }

  /**
   * Log a proactive margin call awareness event.
   * These events warn that if the system is already DEGRADED,
   * margin-related operations carry additional risk.
   */
  private async logProactiveMarginCall(eventType: string, marginPct: number): Promise<void> {
    try {
      await db.riskEvent.create({
        data: {
          eventType,
          severity: marginPct <= 60 ? "HIGH" : "MEDIUM",
          message: `Connection DEGRADED - Proactive margin call awareness at ${marginPct}% threshold. Reduce position sizes and avoid new trades until connection recovers.`,
          details: JSON.stringify({
            latencyMs: this.metrics.latencyMs,
            consecutiveFailures: this.metrics.consecutiveHeartbeatFailures,
            marginThreshold: marginPct,
            recommendation: marginPct <= 60
              ? "CRITICAL: Avoid all new trades, consider reducing open positions"
              : "WARNING: Reduce new trade sizes, monitor existing positions closely",
          }),
          actionTaken: "NOTIFICATION_SENT",
        },
      })
    } catch {
      // Best effort
    }
  }

  // ---- Trading Phase Monitor ----

  private updateTradingPhase(): void {
    this.metrics.currentTradingPhase = getTradingPhase()
    this.metrics.marketIsOpen = isMarketOpen()
  }

  private async checkTradingPhase(): Promise<void> {
    const prevPhase = this.metrics.currentTradingPhase
    const prevOpen = this.metrics.marketIsOpen

    this.updateTradingPhase()

    const newPhase = this.metrics.currentTradingPhase
    const newOpen = this.metrics.marketIsOpen

    // Log phase transitions
    if (prevPhase !== newPhase) {
      logger.info("MT5_CONNECTION", `Trading phase changed: ${prevPhase} -> ${newPhase}`, {
        metadata: { previousPhase: prevPhase, newPhase, marketOpen: newOpen },
      })
    }

    // Log MARKET_OPEN event
    if (!prevOpen && newOpen) {
      await this.logConnectionEvent("MARKET_OPEN", `Market opened (phase: ${newPhase})`)
      logger.info("MT5_CONNECTION", `MARKET_OPEN - IDX market is now open (phase: ${newPhase})`)
    }

    // Log MARKET_CLOSE event
    if (prevOpen && !newOpen) {
      await this.logConnectionEvent("MARKET_CLOSE", `Market closed (phase: ${newPhase})`)
      logger.info("MT5_CONNECTION", `MARKET_CLOSE - IDX market is now closed (phase: ${newPhase})`)
    }

    // Always persist the trading phase and market open state
    try {
      const existing = await db.mt5ConnectionState.findFirst()
      if (existing) {
        await db.mt5ConnectionState.update({
          where: { id: existing.id },
          data: {
            isMarketOpen: newOpen,
            tradingPhase: newPhase,
          },
        })
      }
    } catch {
      // Best effort
    }
  }

  // ---- Reconnection ----

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return
    if (!this.config) return

    this.reconnectAttempt++
    if (this.reconnectAttempt > this.config.maxReconnectAttempts) {
      logger.fatal(
        "MT5_CONNECTION",
        `Max reconnect attempts (${this.config.maxReconnectAttempts}) reached. Giving up.`
      )
      this.status = "ERROR"
      emitStatusChange(this.status, this.metrics)
      return
    }

    // Exponential backoff
    const delay = Math.min(
      this.config.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempt - 1),
      this.config.maxReconnectDelayMs
    )

    const prevStatus = this.status
    this.status = "RECONNECTING"
    emitStatusChange(this.status, this.metrics)

    logger.warn(
      "MT5_CONNECTION",
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${this.config.maxReconnectAttempts})`,
      {
        metadata: { attempt: this.reconnectAttempt, delayMs: delay, previousStatus: prevStatus },
      }
    )

    this.reconnectTimer = setTimeout(async () => {
      await this.logConnectionEvent("RECONNECTING", `Reconnect attempt ${this.reconnectAttempt}`)
      try {
        const result = await this.mutex.runExclusive(() => this.attemptConnection())
        if (result.success) {
          await this.onConnected()
        } else {
          this.metrics.reconnectCount++
          await this.onConnectionFailed(result.error || "Reconnection failed")
        }
      } catch (err) {
        this.metrics.reconnectCount++
        const msg = err instanceof Error ? err.message : String(err)
        await this.onConnectionFailed(msg)
      }
    }, delay)
  }

  // ---- Heartbeat ----

  private async heartbeat(): Promise<void> {
    if (this.status !== "CONNECTED" && this.status !== "DEGRADED") return

    try {
      const start = Date.now()
      const result = await bridgeRequest<{ data?: { latencyMs?: number } }>('/heartbeat').catch(() => ({ data: { latencyMs: Date.now() - start } }))
      const latency = result?.data?.latencyMs ?? (Date.now() - start)
      this.metrics.latencyMs = latency
      this.metrics.lastHeartbeat = new Date()

      await this.logConnectionEvent("HEARTBEAT_OK", `Heartbeat OK (${latency}ms)`)

      // Deep Audit Fix #3: Throttle DB persistence on heartbeat
      // Only persist state every 30s instead of every 5s heartbeat
      this._heartbeatCountSinceLastPersist++
      if (this._heartbeatCountSinceLastPersist >= 6) {
        this._heartbeatCountSinceLastPersist = 0
        await this.persistState()
      }

      // Evaluate DEGRADED state
      await this.evaluateDegradedState(latency, true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.logConnectionEvent("HEARTBEAT_FAIL", `Heartbeat failed: ${msg}`)
      logger.warn("MT5_CONNECTION", `Heartbeat failed: ${msg}`)

      // Evaluate DEGRADED state with failure
      await this.evaluateDegradedState(this.metrics.latencyMs, false)

      // If fully disconnected (not just degraded), go to DISCONNECTED
      if (this.metrics.consecutiveHeartbeatFailures > (this.config?.degradedHeartbeatFailureThreshold || 2) + 2) {
        this.status = "DISCONNECTED"
        await this.setStatus("DISCONNECTED")
        emitStatusChange(this.status, this.metrics)
        this.scheduleReconnect()
      }
    }
  }

  // ---- State Persistence ----

  private async setStatus(status: Mt5Status): Promise<void> {
    this.status = status
    await this.persistState()
  }

  private async persistState(): Promise<void> {
    try {
      const existing = await db.mt5ConnectionState.findFirst()
      if (existing) {
        await db.mt5ConnectionState.update({
          where: { id: existing.id },
          data: {
            status: this.status,
            broker: "FINEX Indonesia",
            server: this.config?.server,
            accountNumber: this.config?.login?.toString(),
            accountType: "Real",
            latencyMs: this.metrics.latencyMs,
            uptimeSeconds: this.metrics.uptimeSeconds,
            reconnectCount: this.metrics.reconnectCount,
            lastHeartbeat: this.metrics.lastHeartbeat,
            lastError: this.metrics.lastError,
            lastConnectedAt: this.metrics.connectedAt,
            connectedAt: this.metrics.connectedAt,
            lastDisconnectedAt: this.status !== "CONNECTED" && this.status !== "DEGRADED" ? new Date() : undefined,
            consecutiveHeartbeatFailures: this.metrics.consecutiveHeartbeatFailures,
            isMarketOpen: this.metrics.marketIsOpen,
            tradingPhase: this.metrics.currentTradingPhase,
          },
        })
      } else {
        await db.mt5ConnectionState.create({
          data: {
            status: this.status,
            broker: "FINEX Indonesia",
            server: this.config?.server,
            accountNumber: this.config?.login?.toString(),
            accountType: "Real",
            latencyMs: this.metrics.latencyMs,
            uptimeSeconds: this.metrics.uptimeSeconds,
            reconnectCount: this.metrics.reconnectCount,
            lastHeartbeat: this.metrics.lastHeartbeat,
            lastError: this.metrics.lastError,
            lastConnectedAt: this.metrics.connectedAt,
            connectedAt: this.metrics.connectedAt,
            consecutiveHeartbeatFailures: this.metrics.consecutiveHeartbeatFailures,
            isMarketOpen: this.metrics.marketIsOpen,
            tradingPhase: this.metrics.currentTradingPhase,
          },
        })
      }
    } catch (err) {
      logger.error("MT5_CONNECTION", "Failed to persist connection state", {
        details: err instanceof Error ? err.stack : String(err),
      })
    }
  }

  private async logConnectionEvent(event: string, message: string): Promise<void> {
    try {
      await db.mt5ConnectionLog.create({
        data: {
          event: event as never,
          message,
          latencyMs: this.metrics.latencyMs,
        },
      })
    } catch {
      // Don't let logging failure crash the connection manager
    }
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.uptimeTimer) {
      clearInterval(this.uptimeTimer)
      this.uptimeTimer = null
    }
    if (this.tradingPhaseTimer) {
      clearInterval(this.tradingPhaseTimer)
      this.tradingPhaseTimer = null
    }
  }
}

// ============================================
// TIMEOUT UTILITY
// ============================================

/**
 * Wrap any async call with an absolute deadline.
 * Throws TimeoutError if the call doesn't complete within `timeoutMs`.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context?: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms${context ? ` (${context})` : ''}`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ============================================
// ORDER EXECUTION PIPELINE
// ============================================

export interface OrderExecutionResult {
  success: boolean
  /** Broker-side position ticket — persists to Trade.mt5Ticket and is the
   *  key for modify/close operations against the bridge. */
  ticket?: number
  /** String form of the ticket (kept for log/audit parity with older code). */
  orderId?: string
  fillPrice?: number
  fillLot?: number
  mt5ErrorCode?: number
  mt5ErrorDesc?: string
  attempts: number
  totalLatencyMs: number
}

/**
 * Map a bridge POST /order success envelope into OrderExecutionResult fields.
 *
 * The bridge responds `{ success, data: { ticket, openPrice, lotSize, ... } }`
 * (see mini-services/mt5-bridge handleOrder). The historical bug: callers
 * read `orderId`/`fillPrice`/`fillLot` from the envelope root — all undefined,
 * so trades were persisted without a ticket and modify/close always 400'd
 * with "no MT5 ticket". Pure + unit-tested (tests/mt5-order-mapping.test.ts).
 */
export function mapBridgeOrderResponse(json: unknown): {
  ticket?: number
  orderId?: string
  fillPrice?: number
  fillLot?: number
} {
  if (typeof json !== 'object' || json === null) return {}
  const data = (json as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return {}
  const d = data as { ticket?: unknown; openPrice?: unknown; lotSize?: unknown }
  const ticket =
    typeof d.ticket === 'number' && Number.isFinite(d.ticket) && d.ticket > 0 ? d.ticket : undefined
  const fillPrice =
    typeof d.openPrice === 'number' && Number.isFinite(d.openPrice) ? d.openPrice : undefined
  const fillLot =
    typeof d.lotSize === 'number' && Number.isFinite(d.lotSize) ? d.lotSize : undefined
  return {
    ticket,
    orderId: ticket !== undefined ? String(ticket) : undefined,
    fillPrice,
    fillLot,
  }
}

/** Retryable MT5 trade error codes */
const RETRYABLE_MT5_ERRORS = new Set([10004, 10015, 10020, 10021, 10023, 10028, 10031])

/** Suggested retry delays (ms) per MT5 error code */
const MT5_RETRY_DELAY_MS: Record<number, number> = {
  10004: 1000,  // Requote — wait for fresh quotes
  10015: 500,   // Invalid price — brief delay then retry with updated price
  10020: 750,   // Prices changed — moderate delay for price stabilisation
  10021: 2000,  // No quotes — longer wait for data feed to resume
  10023: 500,   // Order state changed — brief delay then re-fetch
  10028: 1000,  // Request locked — wait for prior operation to complete
  10031: 3000,  // No connection — longest delay for reconnection attempt
}

/**
 * Execute an order with automatic retry for transient MT5 errors.
 *
 * Submits POST /order to the MT5 bridge (mini-services/mt5-bridge) through
 * the circuit breaker and maps the bridge envelope into execution fields:
 * data.ticket → ticket/orderId (the position key persisted to Trade.mt5Ticket),
 * data.openPrice → fillPrice, data.lotSize → fillLot.
 *
 * Uses CircuitBreaker to guard against cascading failures.
 * On retryable errors (10004, 10015, 10020, 10021, 10023, 10028, 10031)
 * the function retries up to `maxRetries` times with delays derived from
 * the MT5 error code.
 */
export async function executeOrderWithRetry(params: {
  symbol: string
  direction: string
  lotSize: number
  price: number
  sl?: number
  tp?: number
  comment?: string
  maxRetries?: number
  circuitBreaker?: CircuitBreaker
}): Promise<OrderExecutionResult> {
  const {
    symbol,
    direction,
    lotSize,
    price,
    sl,
    tp,
    comment,
    maxRetries = 3,
    circuitBreaker,
  } = params

  const startTime = Date.now()
  let attempts = 0
  const totalRetries = maxRetries

  // Use provided circuit breaker or fall back to the shared module-level instance
  const cb = circuitBreaker ?? defaultCircuitBreaker

  for (let attempt = 0; attempt <= totalRetries; attempt++) {
    attempts = attempt + 1

    try {
      const result = await withTimeout(
        cb.execute(async () => {
          // ---- MT5 BRIDGE EXECUTION ----
          logger.info("TRADE_EXECUTION", `Order attempt ${attempts}/${totalRetries + 1} via bridge`, {
            symbol,
            metadata: { direction, lotSize, price, sl, tp, comment, attempt: attempts },
          })

          const bridgeResult = await bridgeRequest<{
            success: boolean
            data?: { ticket?: number; openPrice?: number; lotSize?: number }
            message?: string
            error?: string
            mt5Code?: number
          }>('/order', {
            method: 'POST',
            body: JSON.stringify({ symbol, direction, lotSize, price, sl, tp, comment }),
          })

          if (!bridgeResult.success) {
            const err: Record<string, unknown> = {
              message: bridgeResult.message || bridgeResult.error || 'Order rejected',
            }
            if (bridgeResult.mt5Code) err.retcode = bridgeResult.mt5Code
            throw err
          }

          // Bridge envelope → execution fields (ticket is the position key
          // for later modify/close; openPrice/lotSize are the real fill).
          const mapped = mapBridgeOrderResponse(bridgeResult)
          return {
            success: true,
            ticket: mapped.ticket,
            orderId: mapped.orderId,
            fillPrice: mapped.fillPrice,
            fillLot: mapped.fillLot,
          }
        }),
        10_000,
        `Order ${symbol} ${direction}`
      )

      const totalLatencyMs = Date.now() - startTime
      logger.info("TRADE_EXECUTION", `Order succeeded on attempt ${attempts}`, {
        symbol,
        tradeId: result.orderId,
        metadata: { fillPrice: result.fillPrice, fillLot: result.fillLot, totalLatencyMs },
      })

      return {
        ...result,
        attempts,
        totalLatencyMs,
      }
    } catch (err) {
      const totalLatencyMs = Date.now() - startTime

      // If circuit breaker itself is open, bail out immediately
      if (err instanceof CircuitBreakerOpenError) {
        logger.error("TRADE_EXECUTION", `Circuit breaker OPEN — order aborted`, {
          symbol,
          metadata: { direction, attempts, totalLatencyMs, circuitBreakerFailures: err.failureCount },
        })
        return {
          success: false,
          attempts,
          totalLatencyMs,
        }
      }

      // Extract MT5 error code from the thrown error if available
      const mt5ErrorCode =
        (err as { retcode?: number })?.retcode ??
        (err as { code?: number })?.code
      const errorEntry = mt5ErrorCode != null ? MT5_ERROR_CODE_MAP.get(mt5ErrorCode) : undefined
      const isRetryable = mt5ErrorCode != null && RETRYABLE_MT5_ERRORS.has(mt5ErrorCode)

      logger.warn("TRADE_EXECUTION", `Order attempt ${attempts} failed`, {
        symbol,
        metadata: {
          direction,
          mt5ErrorCode: mt5ErrorCode ?? "unknown",
          errorDescription: errorEntry?.description ?? (err instanceof Error ? err.message : String(err)),
          retryable: isRetryable,
          remainingRetries: totalRetries - attempt,
        },
      })

      // Non-retryable error or out of retries → return failure
      if (!isRetryable || attempt >= totalRetries) {
        return {
          success: false,
          mt5ErrorCode: mt5ErrorCode,
          mt5ErrorDesc: errorEntry?.description ?? (err instanceof Error ? err.message : String(err)),
          attempts,
          totalLatencyMs,
        }
      }

      // Wait before retrying — use error-specific delay or exponential backoff
      const retryDelay = MT5_RETRY_DELAY_MS[mt5ErrorCode] ?? Math.min(1000 * Math.pow(2, attempt), 5000)
      logger.info("TRADE_EXECUTION", `Retrying in ${retryDelay}ms (error ${mt5ErrorCode})`, {
        symbol,
        metadata: { attempt: attempts, nextAttempt: attempts + 1, retryDelay },
      })
      await new Promise((r) => setTimeout(r, retryDelay))
    }
  }

  // Should not reach here, but satisfy TypeScript
  return {
    success: false,
    attempts,
    totalLatencyMs: Date.now() - startTime,
  }
}

// ============================================
// MT5 BRIDGE HELPER FUNCTIONS (exported for trade-execution-engine)
// ============================================

/**
 * All bridge endpoints answer `{ success: boolean, data?: T, message?, mt5Code? }`
 * (mini-services/mt5-bridge jsonResponse/errorResponse). HTTP-level failures
 * (4xx/5xx) are THROWN by bridgeRequest. These helpers unwrap `data` and map
 * error fields so call sites never touch the raw envelope — the mismatch class
 * that broke ticket persistence, price lookups and position sync.
 */
interface BridgeEnvelope {
  success?: boolean
  data?: unknown
  message?: string
  error?: string
  mt5Code?: number
}

function unwrapBridgeData<T>(env: unknown): T | undefined {
  if (typeof env !== 'object' || env === null) return undefined
  const data = (env as BridgeEnvelope).data
  return (data ?? undefined) as T | undefined
}

function mapBridgeErrorFields(env: unknown): { error?: string; mt5ErrorCode?: number } {
  if (typeof env !== 'object' || env === null) return {}
  const e = env as BridgeEnvelope
  return {
    error: e.message ?? e.error,
    mt5ErrorCode: typeof e.mt5Code === 'number' ? e.mt5Code : undefined,
  }
}

/** Close a position via the MT5 bridge (ticket = broker position ticket, NOT the DB trade id) */
export async function closePositionAtBridge(ticket: number): Promise<{ success: boolean; closePrice?: number; error?: string; mt5ErrorCode?: number }> {
  const env = await bridgeRequest<BridgeEnvelope>('/close', {
    method: 'POST',
    body: JSON.stringify({ ticket }),
  })
  if (!env?.success) return { success: false, ...mapBridgeErrorFields(env) }
  const data = unwrapBridgeData<{ closePrice?: unknown }>(env)
  return {
    success: true,
    closePrice: typeof data?.closePrice === 'number' ? data.closePrice : undefined,
  }
}

/** Close all positions via the MT5 bridge */
export async function closeAllPositionsAtBridge(): Promise<{ success: boolean; closed: number; error?: string; mt5ErrorCode?: number }> {
  const env = await bridgeRequest<BridgeEnvelope>('/close-all', { method: 'POST' })
  if (!env?.success) return { success: false, closed: 0, ...mapBridgeErrorFields(env) }
  const data = unwrapBridgeData<{ closed?: unknown }>(env)
  return {
    success: true,
    closed: typeof data?.closed === 'number' ? data.closed : 0,
  }
}

/** Get account info from the MT5 bridge */
export async function getAccountInfoFromBridge(): Promise<Record<string, unknown>> {
  const env = await bridgeRequest<BridgeEnvelope>('/account')
  return unwrapBridgeData<Record<string, unknown>>(env) ?? {}
}

/** Get current prices from the MT5 bridge */
export async function getPricesFromBridge(): Promise<Record<string, { bid: number; ask: number }>> {
  const env = await bridgeRequest<BridgeEnvelope>('/prices')
  const data = unwrapBridgeData<Record<string, unknown>>(env)
  return data && typeof data === 'object' ? (data as Record<string, { bid: number; ask: number }>) : {}
}

/** Get open positions from the MT5 bridge (always an array — sync code calls .map on it) */
export async function getPositionsFromBridge(): Promise<Array<Record<string, unknown>>> {
  const env = await bridgeRequest<BridgeEnvelope>('/positions')
  const data = unwrapBridgeData<unknown>(env)
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
}

/** Modify SL/TP on an existing position via the MT5 bridge */
export async function modifyPositionAtBridge(params: {
  ticket: number
  symbol?: string
  sl?: number
  tp?: number
}): Promise<{ success: boolean; error?: string; mt5ErrorCode?: number }> {
  const env = await bridgeRequest<BridgeEnvelope>('/modify', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  if (!env?.success) return { success: false, ...mapBridgeErrorFields(env) }
  return { success: true }
}

/** Get symbol specification from the MT5 bridge */
export async function getSymbolSpecFromBridge(symbol: string): Promise<Record<string, unknown>> {
  const env = await bridgeRequest<BridgeEnvelope>(`/symbol-spec?symbol=${encodeURIComponent(symbol)}`)
  return unwrapBridgeData<Record<string, unknown>>(env) ?? {}
}

// ---- Singleton instance ----
const mt5Connection = new Mt5ConnectionManager()
export default mt5Connection
