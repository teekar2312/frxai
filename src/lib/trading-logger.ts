/**
 * FINEX Trading System - Structured Logger
 * ==========================================
 * 6-level severity: DEBUG, INFO, WARN, ERROR, CRITICAL, FATAL
 * 8 categories: MT5_CONNECTION, TRADE_EXECUTION, RISK_MANAGEMENT, MONEY_MANAGEMENT, DATA_FEED, AI_ENGINE, SYSTEM, NOTIFICATION
 * Auto-writes to DB, supports tradeId/symbol context, extensible metadata.
 */

import { db } from "./db"

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL" | "FATAL"
export type LogCategory =
  | "MT5_CONNECTION"
  | "TRADE_EXECUTION"
  | "RISK_MANAGEMENT"
  | "MONEY_MANAGEMENT"
  | "DATA_FEED"
  | "AI_ENGINE"
  | "SYSTEM"
  | "NOTIFICATION"

interface LogContext {
  tradeId?: string
  symbol?: string
  source?: string
  details?: string
  stackTrace?: string
  metadata?: Record<string, unknown>
}

const SEVERITY_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4,
  FATAL: 5,
}

const SEVERITY_COLORS: Record<LogLevel, string> = {
  DEBUG: "\x1b[36m",   // cyan
  INFO: "\x1b[32m",    // green
  WARN: "\x1b[33m",    // yellow
  ERROR: "\x1b[31m",   // red
  CRITICAL: "\x1b[35m", // magenta
  FATAL: "\x1b[41m\x1b[37m", // white on red
}

const RESET = "\x1b[0m"

// In-memory buffer for high-throughput logging (flushes every 2s or at 50 entries)
class LogBuffer {
  private buffer: Array<{
    level: LogLevel
    category: LogCategory
    message: string
    source: string | null
    details: string | null
    stackTrace: string | null
    tradeId: string | null
    symbol: string | null
    metadata: string
  }> = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private isFlushing = false
  private readonly MAX_BUFFER = 50
  private readonly FLUSH_INTERVAL_MS = 2000

  constructor() {
    this.startFlushLoop()
  }

  private startFlushLoop() {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS)
  }

  async push(entry: Omit<typeof this.buffer[number], never>) {
    // Console output
    const color = SEVERITY_COLORS[entry.level]
    const ts = new Date().toISOString()
    console.log(
      `${color}[${entry.level}]${RESET} ${ts} [${entry.category}] ${entry.message}`
    )
    if (entry.level === "ERROR" || entry.level === "CRITICAL" || entry.level === "FATAL") {
      if (entry.details) console.error(`  Details: ${entry.details}`)
      if (entry.stackTrace) console.error(`  Stack: ${entry.stackTrace}`)
    }

    this.buffer.push(entry)

    if (this.buffer.length >= this.MAX_BUFFER) {
      this.flush()
    }
  }

  async flush() {
    if (this.isFlushing || this.buffer.length === 0) return
    this.isFlushing = true

    const batch = [...this.buffer]
    this.buffer = []

    try {
      await db.tradingLog.createMany({
        data: batch.map((entry) => ({
          level: entry.level,
          category: entry.category,
          message: entry.message,
          source: entry.source,
          details: entry.details,
          stackTrace: entry.stackTrace,
          tradeId: entry.tradeId,
          symbol: entry.symbol,
          metadata: entry.metadata,
        })),
      })
    } catch (err) {
      console.error("[Logger] FAILED TO FLUSH LOG BUFFER:", err)
      // Re-queue on failure (but drop oldest if too many)
      this.buffer.unshift(...batch.slice(-20))
    } finally {
      this.isFlushing = false
    }
  }

  async shutdown() {
    if (this.flushTimer) clearInterval(this.flushTimer)
    await this.flush()
  }
}

// Singleton
let _logBuffer: LogBuffer | null = null
function getBuffer(): LogBuffer {
  if (!_logBuffer) _logBuffer = new LogBuffer()
  return _logBuffer
}

// Minimum log level filter (can be changed at runtime)
let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "DEBUG"

export function setMinLevel(level: LogLevel) {
  minLevel = level
}

export function getMinLevel(): LogLevel {
  return minLevel
}

/**
 * Core log function. Use the helper methods below instead.
 */
async function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  ctx: LogContext = {}
) {
  if (SEVERITY_PRIORITY[level] < SEVERITY_PRIORITY[minLevel]) return

  const stackTrace =
    level === "ERROR" || level === "CRITICAL" || level === "FATAL"
      ? new Error().stack?.split("\n").slice(1, 4).join("\n") || null
      : null

  await getBuffer().push({
    level,
    category,
    message,
    source: ctx.source || null,
    details: ctx.details || null,
    stackTrace,
    tradeId: ctx.tradeId || null,
    symbol: ctx.symbol || null,
    metadata: ctx.metadata ? JSON.stringify(ctx.metadata) : "{}",
  })
}

// ---- Convenience methods per level ----

export const logger = {
  debug: (category: LogCategory, message: string, ctx?: LogContext) =>
    log("DEBUG", category, message, ctx),

  info: (category: LogCategory, message: string, ctx?: LogContext) =>
    log("INFO", category, message, ctx),

  warn: (category: LogCategory, message: string, ctx?: LogContext) =>
    log("WARN", category, message, ctx),

  error: (category: LogCategory, message: string, ctx?: LogContext) =>
    log("ERROR", category, message, ctx),

  critical: (category: LogCategory, message: string, ctx?: LogContext) =>
    log("CRITICAL", category, message, ctx),

  fatal: (category: LogCategory, message: string, ctx?: LogContext) =>
    log("FATAL", category, message, ctx),

  /** Extract a clean error message from unknown error type */
  extractError: (err: unknown): { message: string; stack?: string } => {
    if (err instanceof Error) {
      return { message: err.message, stack: err.stack }
    }
    return { message: String(err) }
  },

  /** Wrap an async function with error logging */
  wrapAsync: <T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    category: LogCategory,
    context: string
  ): T => {
    return ((...args: unknown[]) => {
      return fn(...args).catch((err: unknown) => {
        const { message, stack } = logger.extractError(err)
        logger.error(category, `${context} failed: ${message}`, {
          details: stack,
          metadata: { args: JSON.stringify(args).slice(0, 500) },
        })
        throw err
      })
    }) as T
  },

  shutdown: () => getBuffer().shutdown(),
}

export default logger
