/**
 * MT5 Connection Manager - FINEX Indonesia
 * ===========================================
 * Manages connection lifecycle, heartbeat, auto-reconnection,
 * and connection state persistence for MetaTrader 5 integration.
 *
 * Status States: CONNECTED, DISCONNECTED, RECONNECTING, ERROR, AUTH_FAILED
 * Features:
 *  - Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s, max 30s)
 *  - Heartbeat monitoring (configurable interval)
 *  - Connection metrics (uptime, latency, reconnect count)
 *  - Persistent state in DB
 *  - Event emission for UI status updates
 */

import { db } from "./db"
import logger, { type LogCategory } from "./trading-logger"

export type Mt5Status =
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "ERROR"
  | "AUTH_FAILED"

interface Mt5Config {
  server: string
  login: number
  password: string
  heartbeatIntervalMs: number
  maxReconnectAttempts: number
  baseReconnectDelayMs: number
  maxReconnectDelayMs: number
}

interface ConnectionMetrics {
  latencyMs: number
  uptimeSeconds: number
  reconnectCount: number
  lastHeartbeat: Date | null
  connectedAt: Date | null
  lastError: string | null
}

// Status change listeners (for WebSocket broadcast)
type StatusListener = (status: Mt5Status, metrics: ConnectionMetrics) => void
const listeners: StatusListener[] = []

export function onStatusChange(fn: StatusListener) {
  listeners.push(fn)
  return () => {
    const idx = listeners.indexOf(fn)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

function emitStatusChange(status: Mt5Status, metrics: ConnectionMetrics) {
 for (const fn of listeners) {
    try { fn(status, metrics) } catch { /* ignore listener errors */ }
  }
}

// ---- Default config for FINEX Indonesia ----
const DEFAULT_CONFIG: Omit<Mt5Config, "login" | "password"> = {
  server: "FINEX-Server",
  heartbeatIntervalMs: 5000,
  maxReconnectAttempts: 20,
  baseReconnectDelayMs: 1000,
  maxReconnectDelayMs: 30000,
}

// ---- Connection Manager Class ----

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
  }
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private uptimeTimer: ReturnType<typeof setInterval> | null = null
  private isShuttingDown = false

  // ---- Public API ----

  getStatus(): Mt5Status {
    return this.status
  }

  getMetrics(): ConnectionMetrics {
    return { ...this.metrics }
  }

  isConnected(): boolean {
    return this.status === "CONNECTED"
  }

  async connect(login: number, password: string, server?: string): Promise<{ success: boolean; error?: string }> {
    if (this.status === "CONNECTED") {
      return { success: true }
    }

    this.config = {
      ...DEFAULT_CONFIG,
      login,
      password,
      server: server || DEFAULT_CONFIG.server,
    }

    logger.info("MT5_CONNECTION", `Initiating connection to ${this.config.server}`, {
      metadata: { login: this.config.login, server: this.config.server },
    })

    try {
      const result = await this.attemptConnection()
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
    this.clearTimers()
    await this.setStatus("DISCONNECTED")
    await this.persistState()
    logger.info("MT5_CONNECTION", "Disconnected from MT5 server")
  }

  // ---- Connection Logic ----

  private async attemptConnection(): Promise<{ success: boolean; error?: string }> {
    // In production, this would use the MT5 Python SDK via IPC or WebSocket.
    // For now, we simulate the connection attempt with realistic checks.

    if (!this.config) {
      return { success: false, error: "No configuration provided" }
    }

    // Simulate connection latency
    const startMs = Date.now()
    const latency = Math.floor(20 + Math.random() * 80)
    await new Promise((r) => setTimeout(r, latency))
    this.metrics.latencyMs = latency

    // Validate credentials format (in production: actual MT5 auth)
    if (!this.config.login || this.config.login <= 0) {
      return { success: false, error: "Invalid login credentials" }
    }

    if (!this.config.password || this.config.password.length < 1) {
      return { success: false, error: "Password is required" }
    }

    return { success: true }
  }

  private async onConnected(): Promise<void> {
    this.reconnectAttempt = 0
    this.metrics.connectedAt = new Date()
    this.metrics.lastError = null
    this.metrics.reconnectCount = this.status === "RECONNECTING" ? this.metrics.reconnectCount : 0
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

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return
    if (!this.config) return

    this.reconnectAttempt++
    if (this.reconnectAttempt > this.config.maxReconnectAttempts) {
      logger.fatal("MT5_CONNECTION", `Max reconnect attempts (${this.config.maxReconnectAttempts}) reached. Giving up.`)
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

    logger.warn("MT5_CONNECTION", `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${this.config.maxReconnectAttempts})`, {
      metadata: { attempt: this.reconnectAttempt, delayMs: delay, previousStatus: prevStatus },
    })

    this.reconnectTimer = setTimeout(async () => {
      await this.logConnectionEvent("RECONNECTING", `Reconnect attempt ${this.reconnectAttempt}`)
      try {
        const result = await this.attemptConnection()
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

  private async heartbeat(): Promise<void> {
    if (this.status !== "CONNECTED") return

    try {
      const start = Date.now()
      // In production: ping MT5 server
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 15))
      this.metrics.latencyMs = Date.now() - start
      this.metrics.lastHeartbeat = new Date()

      await this.logConnectionEvent("HEARTBEAT_OK", `Heartbeat OK (${this.metrics.latencyMs}ms)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await this.logConnectionEvent("HEARTBEAT_FAIL", `Heartbeat failed: ${msg}`)
      logger.warn("MT5_CONNECTION", `Heartbeat failed: ${msg}`)

      // Consider connection lost
      this.status = "DISCONNECTED"
      await this.setStatus("DISCONNECTED")
      emitStatusChange(this.status, this.metrics)
      this.scheduleReconnect()
    }
  }

  // ---- State Persistence ----

  private async setStatus(status: Mt5Status): Promise<void> {
    this.status = status
    await this.persistState()
  }

  private async persistState(): Promise<void> {
    try {
      // Upsert the single connection state record
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
            lastDisconnectedAt: this.status !== "CONNECTED" ? new Date() : undefined,
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
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.uptimeTimer) { clearInterval(this.uptimeTimer); this.uptimeTimer = null }
  }
}

// Singleton instance
const mt5Connection = new Mt5ConnectionManager()
export default mt5Connection
