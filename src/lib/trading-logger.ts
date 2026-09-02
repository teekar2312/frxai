/**
 * FINEX Trading System - Enhanced Structured Logger
 * ====================================================
 * 6-level severity: DEBUG, INFO, WARN, ERROR, CRITICAL, FATAL
 * 9 categories: MT5_CONNECTION, TRADE_EXECUTION, RISK_MANAGEMENT,
 *   MONEY_MANAGEMENT, DATA_FEED, AI_ENGINE, SYSTEM, NOTIFICATION, API_RATE_LIMIT
 *
 * Features:
 *   1. Cascading Error Deduplication (fingerprint-based, configurable window)
 *   2. Log Rotation / Cleanup (configurable retention, lazy init + 6h cycle)
 *   3. API Rate Limit Tracking (FINNHUB, MARKETAUX, MT5)
 *   4. MT5 Error Code Auto-Remediation (10004-10036)
 *   5. Silent Failure Detection (validateData assertion)
 *   6. Enhanced Log Statistics / Analytics
 */

import { db } from "./db"

// Types

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
  | "API_RATE_LIMIT"
  | "INDICATOR_POOL"
  | "SESSION_MANAGER"
  | "API"

export interface Mt5ErrorResult {
  shouldRetry: boolean
  delayMs?: number
  action?: string
  description: string
  severity: LogLevel
}

export interface LogAnalytics {
  errorRateTrend: { lastHour: number; previousHour: number; direction: "improving" | "stable" | "degrading" }
  topCategories: Array<{ category: string; count: number }>
  bursts: Array<{ startTime: Date; count: number; topMessage: string }>
  topMessages: Array<{ message: string; count: number }>
}

interface LogContext {
  tradeId?: string
  symbol?: string
  source?: string
  details?: string
  stackTrace?: string
  metadata?: Record<string, unknown>
}

// Constants

const SEVERITY_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, CRITICAL: 4, FATAL: 5,
}

const SEVERITY_COLORS: Record<LogLevel, string> = {
  DEBUG: "\x1b[36m",
  INFO: "\x1b[32m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
  CRITICAL: "\x1b[35m",
  FATAL: "\x1b[41m\x1b[37m",
}

const RESET = "\x1b[0m"

// ============================================
// PHASE 4: LOG CORRELATION
// ============================================

let activeCorrelationId: string | null = null

/**
 * Set a correlation ID that will be attached to all subsequent log entries.
 * Useful for grouping logs from a single trade lifecycle.
 */
export function setCorrelationId(id: string | null): void {
  activeCorrelationId = id
}

/** Get the current correlation ID */
export function getCorrelationId(): string | null {
  return activeCorrelationId
}

// ============================================
// PHASE 4: DYNAMIC LOG LEVEL OVERRIDE
// ============================================

let temporaryMinLevel: LogLevel | null = null
let temporaryLevelExpiry = 0

/**
 * Temporarily set minimum log level (auto-reverts after durationMs).
 * Useful for temporarily enabling DEBUG logging in production.
 */
export function setTemporaryLogLevel(level: LogLevel, durationMs: number): void {
  temporaryMinLevel = level
  temporaryLevelExpiry = Date.now() + durationMs
  logger.info('SYSTEM', `Temporary log level set to ${level} for ${durationMs}ms`, {
    metadata: { previousLevel: minLevel, temporaryLevel: level, durationMs },
  })
}

/** Get the effective minimum level (considering temporary overrides) */
export function getEffectiveMinLevel(): LogLevel {
  if (temporaryMinLevel && Date.now() < temporaryLevelExpiry) {
    return temporaryMinLevel
  }
  if (temporaryMinLevel && Date.now() >= temporaryLevelExpiry) {
    temporaryMinLevel = null
  }
  return minLevel
}

// Simple String Hash (non-crypto, for dedup fingerprint)

function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff
  }
  return hash.toString(36)
}

// 1. Dedup Cache

interface DedupEntry {
  count: number
  lastSeen: Date
  firstSeen: Date
}

class DedupCache {
  private cache = new Map<string, DedupEntry>()
  private windowMs: number
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(windowMs: number) {
    this.windowMs = windowMs
    this.flushTimer = setInterval(() => {
      const expired = this.sweepExpired()
      for (const e of expired) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Logger-Dedup] Flushed fingerprint=${e.fingerprint} count=${e.count}`)
        }
      }
    }, 5000)
  }

  checkAndIncrement(fingerprint: string): { isDuplicate: boolean; entry: DedupEntry | null } {
    const now = new Date()
    const existing = this.cache.get(fingerprint)

    if (existing && now.getTime() - existing.firstSeen.getTime() < this.windowMs) {
      existing.count++
      existing.lastSeen = now
      return { isDuplicate: true, entry: existing }
    }

    if (existing) this.cache.delete(fingerprint)

    const entry: DedupEntry = { count: 1, lastSeen: now, firstSeen: now }
    this.cache.set(fingerprint, entry)
    return { isDuplicate: false, entry: null }
  }

  sweepExpired(): Array<{ fingerprint: string; count: number; firstSeen: Date }> {
    const now = new Date()
    const expired: Array<{ fingerprint: string; count: number; firstSeen: Date }> = []
    for (const [fp, entry] of this.cache) {
      if (now.getTime() - entry.firstSeen.getTime() >= this.windowMs) {
        if (entry.count > 1) expired.push({ fingerprint: fp, count: entry.count, firstSeen: entry.firstSeen })
        this.cache.delete(fp)
      }
    }
    return expired
  }

  shutdown() { if (this.flushTimer) clearInterval(this.flushTimer) }
}

// 2. Retention / Cleanup

let retentionDays = 30
let mt5LogRetentionDays = 7
let cleanupTimer: ReturnType<typeof setInterval> | null = null
let cleanupInitialized = false

export function setRetentionDays(days: number) { retentionDays = days }

export async function cleanupOldLogs(): Promise<{ tradingLogsDeleted: number; mt5LogsDeleted: number }> {
  const tradingCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const mt5Cutoff = new Date(Date.now() - mt5LogRetentionDays * 24 * 60 * 60 * 1000)
  let tradingLogsDeleted = 0
  let mt5LogsDeleted = 0

  try {
    const result = await db.tradingLog.deleteMany({ where: { createdAt: { lt: tradingCutoff } } })
    tradingLogsDeleted = result.count
  } catch (err) {
    console.error("[Logger-Cleanup] Failed to delete old TradingLogs:", err)
  }

  try {
    const result = await db.mt5ConnectionLog.deleteMany({ where: { createdAt: { lt: mt5Cutoff } } })
    mt5LogsDeleted = result.count
  } catch (err) {
    console.error("[Logger-Cleanup] Failed to delete old Mt5ConnectionLogs:", err)
  }

  if (tradingLogsDeleted > 0 || mt5LogsDeleted > 0) {
    console.log(`[Logger-Cleanup] Deleted ${tradingLogsDeleted} TradingLogs (>${retentionDays}d) + ${mt5LogsDeleted} Mt5ConnectionLogs (>${mt5LogRetentionDays}d)`)
  }
  return { tradingLogsDeleted, mt5LogsDeleted }
}

function ensureCleanupScheduled() {
  if (cleanupInitialized) return
  cleanupInitialized = true
  cleanupTimer = setInterval(() => { void cleanupOldLogs() }, 6 * 60 * 60 * 1000)
}

// 3. API Rate Limit Tracking

type ApiService = "FINNHUB" | "MARKETAUX" | "MT5"

const RATE_LIMITS: Record<ApiService, { limitPerMinute: number; limitPerHour: number }> = {
  FINNHUB: { limitPerMinute: 60, limitPerHour: 3600 },
  MARKETAUX: { limitPerMinute: 100, limitPerHour: 6000 },
  MT5: { limitPerMinute: 120, limitPerHour: 7200 },
}

interface RateCounter {
  callsThisMinute: number
  callsThisHour: number
  minuteStart: number
  hourStart: number
}

class RateLimitTracker {
  private counters = new Map<ApiService, RateCounter>()
  private persistTimer: ReturnType<typeof setInterval> | null = null
  private initialized = false

  init() {
    if (this.initialized) return
    this.initialized = true
    const now = Date.now()
    for (const svc of ["FINNHUB", "MARKETAUX", "MT5"] as ApiService[]) {
      this.counters.set(svc, { callsThisMinute: 0, callsThisHour: 0, minuteStart: now, hourStart: now })
    }
    this.persistTimer = setInterval(() => { void this.persistToDb() }, 30_000)
  }

  private getCounter(service: ApiService): RateCounter {
    this.init()
    return this.counters.get(service)!
  }

  private resetIfNeeded(counter: RateCounter, now: number) {
    if (now - counter.minuteStart >= 60_000) { counter.callsThisMinute = 0; counter.minuteStart = now }
    if (now - counter.hourStart >= 3_600_000) { counter.callsThisHour = 0; counter.hourStart = now }
  }

  async track(service: ApiService): Promise<boolean> {
    this.init()
    const counter = this.getCounter(service)
    const config = RATE_LIMITS[service]
    const now = Date.now()
    this.resetIfNeeded(counter, now)

    const minuteUsage = counter.callsThisMinute / config.limitPerMinute
    const hourUsage = counter.callsThisHour / config.limitPerHour
    const usage = Math.max(minuteUsage, hourUsage)

    if (minuteUsage >= 1.0 || hourUsage >= 1.0) {
      logger.critical("API_RATE_LIMIT", `${service} rate limit EXCEEDED: ${counter.callsThisMinute}/${config.limitPerMinute}/min, ${counter.callsThisHour}/${config.limitPerHour}/hour`, {
        metadata: { service, callsThisMinute: counter.callsThisMinute, limitPerMinute: config.limitPerMinute },
      })
      return false
    }

    if (usage >= 0.95) {
      logger.error("API_RATE_LIMIT", `${service} rate limit CRITICAL (${(usage * 100).toFixed(1)}%)`, {
        metadata: { service, usagePct: Math.round(usage * 100) },
      })
      await new Promise((r) => setTimeout(r, 1000))
    } else if (usage >= 0.8) {
      logger.warn("API_RATE_LIMIT", `${service} rate limit approaching (${(usage * 100).toFixed(1)}%)`, {
        metadata: { service, usagePct: Math.round(usage * 100) },
      })
    }

    counter.callsThisMinute++
    counter.callsThisHour++
    return true
  }

  async persistToDb() {
    const now = Date.now()
    for (const [service, counter] of this.counters) {
      this.resetIfNeeded(counter, now)
      try {
        await db.apiRateLimit.upsert({
          where: { id: `rate-${service}` },
          create: { id: `rate-${service}`, service, callsThisMinute: counter.callsThisMinute, callsThisHour: counter.callsThisHour, limitPerMinute: RATE_LIMITS[service].limitPerMinute, limitPerHour: RATE_LIMITS[service].limitPerHour, lastCallAt: new Date(now) },
          update: { callsThisMinute: counter.callsThisMinute, callsThisHour: counter.callsThisHour, lastCallAt: new Date(now) },
        })
      } catch { /* persist failure is non-critical */ }
    }
  }

  shutdown() { if (this.persistTimer) clearInterval(this.persistTimer) }
}

// 4. MT5 Error Code Auto-Remediation

interface Mt5ErrorDef {
  code: number
  description: string
  severity: LogLevel
  category: LogCategory
  retryable: boolean
  delayMs: number
  action: string
}

const MT5_ERROR_DEFS: Mt5ErrorDef[] = [
  { code: 10004, description: "Requote", severity: "WARN", category: "TRADE_EXECUTION", retryable: true, delayMs: 500, action: "Re-fetch latest prices and retry" },
  { code: 10006, description: "Request rejected", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Do not retry - request rejected by broker" },
  { code: 10007, description: "Request canceled by trader", severity: "INFO", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Cancelled intentionally" },
  { code: 10008, description: "Order placed", severity: "INFO", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Order accepted - monitor for execution" },
  { code: 10009, description: "Request executed", severity: "INFO", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Trade executed successfully" },
  { code: 10011, description: "Invalid request", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Check request parameters" },
  { code: 10013, description: "Invalid request / trade disabled", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Verify trade is allowed; check stop order values" },
  { code: 10014, description: "Invalid volume", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Fix lot size - check min/max/step for symbol" },
  { code: 10015, description: "Invalid price", severity: "WARN", category: "TRADE_EXECUTION", retryable: true, delayMs: 1000, action: "Re-fetch latest price and retry" },
  { code: 10016, description: "Invalid stops", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Check SL/TP distance and direction" },
  { code: 10017, description: "Trade disabled", severity: "FATAL", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "CRITICAL: Trading disabled - check broker settings" },
  { code: 10018, description: "Market closed", severity: "WARN", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Wait for market to open" },
  { code: 10019, description: "Not enough money", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Reduce lot size or deposit funds" },
  { code: 10020, description: "Prices changed", severity: "WARN", category: "TRADE_EXECUTION", retryable: true, delayMs: 200, action: "Re-fetch prices and retry" },
  { code: 10021, description: "No quotes to process request", severity: "WARN", category: "DATA_FEED", retryable: true, delayMs: 2000, action: "Wait for market data and retry" },
  { code: 10022, description: "Invalid order expiration", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Fix expiration date or remove" },
  { code: 10023, description: "Order state changed", severity: "WARN", category: "TRADE_EXECUTION", retryable: true, delayMs: 1000, action: "Re-fetch and retry" },
  { code: 10024, description: "Too many requests", severity: "WARN", category: "MT5_CONNECTION", retryable: true, delayMs: 5000, action: "Rate limited - back off 5s" },
  { code: 10025, description: "No changes in request", severity: "INFO", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "No modification needed" },
  { code: 10026, description: "Autotrading disabled by server", severity: "FATAL", category: "MT5_CONNECTION", retryable: false, delayMs: 0, action: "CRITICAL: Server disabled autotrading - contact broker" },
  { code: 10027, description: "Autotrading only for live accounts", severity: "ERROR", category: "MT5_CONNECTION", retryable: false, delayMs: 0, action: "Switch to live account" },
  { code: 10028, description: "Request locked for processing", severity: "WARN", category: "TRADE_EXECUTION", retryable: true, delayMs: 1000, action: "Order being processed - wait and retry" },
  { code: 10029, description: "Order or position frozen", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Cannot modify frozen order" },
  { code: 10030, description: "Invalid order filling type", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Use correct filling type (FOK, IOC, Return)" },
  { code: 10031, description: "No connection", severity: "ERROR", category: "MT5_CONNECTION", retryable: true, delayMs: 3000, action: "Reconnect to MT5 and retry" },
  { code: 10032, description: "Operation only for live accounts", severity: "ERROR", category: "MT5_CONNECTION", retryable: false, delayMs: 0, action: "Switch to live account" },
  { code: 10033, description: "Limit orders only", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Only limit orders allowed" },
  { code: 10034, description: "Limit volume", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Volume exceeds limit" },
  { code: 10035, description: "Invalid order", severity: "ERROR", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Invalid order type" },
  { code: 10036, description: "Position closed", severity: "INFO", category: "TRADE_EXECUTION", retryable: false, delayMs: 0, action: "Position already closed" },
]

const MT5_ERROR_MAP = new Map(MT5_ERROR_DEFS.map((d) => [d.code, d]))

export function handleMt5Error(
  code: number,
  context?: { symbol?: string; tradeId?: string; orderType?: string }
): Mt5ErrorResult {
  const def = MT5_ERROR_MAP.get(code)
  const description = def?.description ?? `Unknown MT5 error code ${code}`
  const severity = def?.severity ?? "ERROR"
  const category = def?.category ?? "TRADE_EXECUTION"
  const shouldRetry = def?.retryable ?? false
  const delayMs = def?.delayMs ?? 0
  const action = def?.action ?? "No auto-remediation available"

  logger[severity === "INFO" ? "info" : severity === "WARN" ? "warn" : severity === "ERROR" ? "error" : severity === "CRITICAL" ? "critical" : "fatal"](
    category,
    `MT5 Error ${code}: ${description}${context?.symbol ? ` [${context.symbol}]` : ""}${context?.tradeId ? ` trade=${context.tradeId}` : ""}`,
    {
      symbol: context?.symbol,
      tradeId: context?.tradeId,
      metadata: { code, description, shouldRetry, delayMs, action, orderType: context?.orderType },
    }
  )

  return { shouldRetry, delayMs, action, description, severity }
}

// 5. Silent Failure Detection

export function validateData<T>(
  data: T | null | undefined,
  context: string,
  category: LogCategory
): asserts data is T {
  if (data === null || data === undefined) {
    const msg = `Silent failure detected: ${context} returned null/undefined`
    logger.error(category, msg, { details: "Expected non-null data but received null or undefined" })
    throw new Error(msg)
  }
  if (Array.isArray(data) && data.length === 0) {
    const msg = `Silent failure detected: ${context} returned empty array`
    logger.warn(category, msg, { details: "Expected non-empty array but received []" })
    throw new Error(msg)
  }
}

// 6. Log Buffer with Dedup

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
    fingerprint: string | null
  }> = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private isFlushing = false
  private readonly MAX_BUFFER = 50
  private readonly FLUSH_INTERVAL_MS = 2000

  constructor() {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS)
  }

  async push(entry: Omit<typeof this.buffer[number], "fingerprint">) {
    const ts = new Date().toISOString()
    const color = SEVERITY_COLORS[entry.level]
    console.log(`${color}[${entry.level}]${RESET} ${ts} [${entry.category}] ${entry.message}`)
    if (entry.level === "ERROR" || entry.level === "CRITICAL" || entry.level === "FATAL") {
      if (entry.details) console.error(`  Details: ${entry.details}`)
      if (entry.stackTrace) console.error(`  Stack: ${entry.stackTrace}`)
    }

    // Dedup check
    const fp = `${entry.category}:${entry.message.substring(0, 80)}`
    const fingerprint = simpleHash(fp)
    const { isDuplicate } = dedupCache.checkAndIncrement(fingerprint)
    if (isDuplicate) return // Skip DB write for duplicates within window

    this.buffer.push({ ...entry, fingerprint })

    if (this.buffer.length >= this.MAX_BUFFER) this.flush()

    // Lazy cleanup scheduling
    ensureCleanupScheduled()
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
          fingerprint: entry.fingerprint,
        })),
      })
      logHealthMonitor.recordFlushSuccess()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error("[Logger] FAILED TO FLUSH LOG BUFFER:", err)
      logHealthMonitor.recordFlushFailure(errMsg)
      this.buffer.unshift(...batch.slice(-this.MAX_BUFFER))
    } finally {
      this.isFlushing = false
    }
  }

  async shutdown() {
    if (this.flushTimer) clearInterval(this.flushTimer)
    await this.flush()
  }

  size(): number {
    return this.buffer.length
  }
}

// Singleton instances
let _logBuffer: LogBuffer | null = null
const dedupCache = new DedupCache(30_000) // 30 second dedup window
const rateLimitTracker = new RateLimitTracker()

function getBuffer(): LogBuffer {
  if (!_logBuffer) _logBuffer = new LogBuffer()
  return _logBuffer
}

// Minimum log level filter
const VALID_LOG_LEVELS = new Set<LogLevel>(['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL', 'FATAL'])
const envLevel = process.env.LOG_LEVEL?.toUpperCase()
let minLevel: LogLevel = VALID_LOG_LEVELS.has(envLevel as LogLevel) ? (envLevel as LogLevel) : 'DEBUG'

export function setMinLevel(level: LogLevel) { minLevel = level }
export function getMinLevel(): LogLevel { return minLevel }

// Core log function
async function log(level: LogLevel, category: LogCategory, message: string, ctx: LogContext = {}) {
  const effectiveLevel = getEffectiveMinLevel()
  if (SEVERITY_PRIORITY[level] < SEVERITY_PRIORITY[effectiveLevel]) return

  const stackTrace =
    level === "ERROR" || level === "CRITICAL" || level === "FATAL"
      ? new Error().stack?.split("\n").slice(1, 4).join("\n") || null
      : null

  await getBuffer().push({
    level, category, message,
    source: ctx.source || null,
    details: ctx.details || null,
    stackTrace,
    tradeId: ctx.tradeId || null,
    symbol: ctx.symbol || null,
    metadata: (() => {
      const metaObj = ctx.metadata ? { ...ctx.metadata } : {}
      if (activeCorrelationId) {
        metaObj.correlationId = activeCorrelationId
      }
      return JSON.stringify(metaObj)
    })(),
  })

  // Auto-escalate ERROR, CRITICAL, FATAL
  if (SEVERITY_PRIORITY[level] >= SEVERITY_PRIORITY["ERROR"]) {
    try {
      await escalationManager.escalate(level, category, message, ctx)
    } catch { /* escalation failure is non-critical, don't recurse */ }
  }
}

// Convenience methods
export const logger = {
  debug: (category: LogCategory, message: string, ctx?: LogContext) => log("DEBUG", category, message, ctx),
  info: (category: LogCategory, message: string, ctx?: LogContext) => log("INFO", category, message, ctx),
  warn: (category: LogCategory, message: string, ctx?: LogContext) => log("WARN", category, message, ctx),
  error: (category: LogCategory, message: string, ctx?: LogContext) => log("ERROR", category, message, ctx),
  critical: (category: LogCategory, message: string, ctx?: LogContext) => log("CRITICAL", category, message, ctx),
  fatal: (category: LogCategory, message: string, ctx?: LogContext) => log("FATAL", category, message, ctx),

  extractError: (err: unknown): { message: string; stack?: string } => {
    if (err instanceof Error) return { message: err.message, stack: err.stack }
    return { message: String(err) }
  },

  wrapAsync: <T extends (...args: unknown[]) => Promise<unknown>>(fn: T, category: LogCategory, context: string): T => {
    return ((...args: unknown[]) => {
      return fn(...args).catch((err: unknown) => {
        const { message, stack } = logger.extractError(err)
        logger.error(category, `${context} failed: ${message}`, { details: stack, metadata: { args: JSON.stringify(args).slice(0, 500) } })
        throw err
      })
    }) as T
  },

  shutdown: () => getBuffer().shutdown(),
}

// Public API wrappers

export async function trackApiCall(service: ApiService): Promise<boolean> {
  return rateLimitTracker.track(service)
}

// 6. Log Analytics

export async function getLogAnalytics(): Promise<LogAnalytics> {
  const now = new Date()
  const lastHour = new Date(now.getTime() - 60 * 60 * 1000)
  const prevHourStart = new Date(now.getTime() - 2 * 60 * 60 * 1000)

  const [lastHourErrors, prevHourErrors, topCategories, topMessages] = await Promise.all([
    db.tradingLog.count({ where: { level: { in: ["ERROR", "CRITICAL", "FATAL"] }, createdAt: { gte: lastHour } } }),
    db.tradingLog.count({ where: { level: { in: ["ERROR", "CRITICAL", "FATAL"] }, createdAt: { gte: prevHourStart, lt: lastHour } } }),
    db.tradingLog.groupBy({ by: ["category"], where: { level: { in: ['ERROR', 'CRITICAL', 'FATAL'] } }, _count: true, orderBy: { _count: { category: "desc" } }, take: 5 }),
    db.tradingLog.groupBy({ by: ["message"], where: { level: { in: ["ERROR", "CRITICAL", "FATAL"] } }, _count: true, orderBy: { _count: { message: "desc" } }, take: 5 }),
  ])

  // Error burst detection: >10 errors in 5 min
  const burstStart = new Date(now.getTime() - 5 * 60 * 1000)
  const [burstCount, burstTopMsg] = await Promise.all([
    db.tradingLog.count({ where: { level: { in: ["ERROR", "CRITICAL", "FATAL"] }, createdAt: { gte: burstStart } } }),
    db.tradingLog.groupBy({
      by: ["message"],
      where: { level: { in: ["ERROR", "CRITICAL", "FATAL"] }, createdAt: { gte: burstStart } },
      _count: true,
      orderBy: { _count: { message: "desc" } },
      take: 1,
    }),
  ])

  const bursts: LogAnalytics["bursts"] = []
  if (burstCount > 10) {
    bursts.push({ startTime: burstStart, count: burstCount, topMessage: burstTopMsg[0]?.message ?? '' })
  }

  const direction: LogAnalytics["errorRateTrend"]["direction"] =
    lastHourErrors < prevHourErrors * 0.8 ? "improving" :
    lastHourErrors > prevHourErrors * 1.2 ? "degrading" : "stable"

  return {
    errorRateTrend: { lastHour: lastHourErrors, previousHour: prevHourErrors, direction },
    topCategories: topCategories.map((g) => ({ category: g.category, count: g._count })),
    bursts,
    topMessages: topMessages.map((g) => ({ message: g.message, count: g._count })),
  }
}

// ============================================
// PHASE 3: STRUCTURED ERROR RECOVERY ACTIONS
// ============================================

export interface RecoveryAction {
  action: string
  description: string
  priority: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW'
  automated: boolean
}

/**
 * Returns suggested recovery actions based on error category and severity level.
 */
export function getRecoveryActions(category: LogCategory, level: LogLevel): RecoveryAction[] {
  // Category + level specific mappings
  const key = `${category}:${level}` as const

  const MAP: Record<string, RecoveryAction[]> = {
    'MT5_CONNECTION:CRITICAL': [
      { action: 'RECONNECT', description: 'Attempt MT5 reconnection', priority: 'IMMEDIATE', automated: true },
      { action: 'CHECK_NETWORK', description: 'Verify network connectivity', priority: 'IMMEDIATE', automated: false },
      { action: 'LOG_STATE', description: 'Persist current connection state for diagnostics', priority: 'HIGH', automated: true },
    ],
    'MT5_CONNECTION:FATAL': [
      { action: 'GRACEFUL_SHUTDOWN', description: 'Initiate graceful system shutdown', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Send critical connection failure notification', priority: 'IMMEDIATE', automated: true },
    ],
    'MT5_CONNECTION:ERROR': [
      { action: 'RECONNECT', description: 'Attempt MT5 reconnection', priority: 'HIGH', automated: true },
      { action: 'CHECK_NETWORK', description: 'Verify network connectivity', priority: 'HIGH', automated: false },
    ],
    'TRADE_EXECUTION:CRITICAL': [
      { action: 'VERIFY_POSITIONS', description: 'Verify all open positions match expected state', priority: 'IMMEDIATE', automated: true },
      { action: 'HALT_TRADING', description: 'Halt new trade submissions temporarily', priority: 'IMMEDIATE', automated: true },
      { action: 'RECONCILE', description: 'Reconcile local state with broker positions', priority: 'HIGH', automated: false },
    ],
    'TRADE_EXECUTION:FATAL': [
      { action: 'HALT_TRADING', description: 'Halt all trading immediately', priority: 'IMMEDIATE', automated: true },
      { action: 'VERIFY_POSITIONS', description: 'Verify all open positions', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Send emergency trade execution failure notification', priority: 'IMMEDIATE', automated: true },
    ],
    'RISK_MANAGEMENT:CRITICAL': [
      { action: 'CLOSE_ALL', description: 'Close all positions immediately', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Send emergency notification', priority: 'IMMEDIATE', automated: true },
    ],
    'RISK_MANAGEMENT:FATAL': [
      { action: 'CLOSE_ALL', description: 'Close all positions immediately', priority: 'IMMEDIATE', automated: true },
      { action: 'GRACEFUL_SHUTDOWN', description: 'Initiate graceful system shutdown', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Send emergency risk management failure notification', priority: 'IMMEDIATE', automated: true },
    ],
    'MONEY_MANAGEMENT:ERROR': [
      { action: 'RESET_SIZING', description: 'Reset to minimum position sizing', priority: 'HIGH', automated: true },
      { action: 'VERIFY_BALANCE', description: 'Verify account balance accuracy', priority: 'HIGH', automated: true },
    ],
    'MONEY_MANAGEMENT:CRITICAL': [
      { action: 'RESET_SIZING', description: 'Reset to minimum position sizing', priority: 'IMMEDIATE', automated: true },
      { action: 'HALT_TRADING', description: 'Halt new trade submissions', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Send money management critical alert', priority: 'HIGH', automated: true },
    ],
    'DATA_FEED:ERROR': [
      { action: 'SWITCH_SOURCE', description: 'Switch to backup data source', priority: 'MEDIUM', automated: false },
      { action: 'RECONNECT_FEED', description: 'Reconnect to primary data feed', priority: 'HIGH', automated: true },
    ],
    'DATA_FEED:CRITICAL': [
      { action: 'SWITCH_SOURCE', description: 'Switch to backup data source', priority: 'IMMEDIATE', automated: false },
      { action: 'HALT_TRADING', description: 'Halt trading until data feed is restored', priority: 'IMMEDIATE', automated: true },
    ],
    'AI_ENGINE:ERROR': [
      { action: 'FALLBACK_STRATEGY', description: 'Switch to fallback trading strategy', priority: 'MEDIUM', automated: true },
      { action: 'RESTART_ENGINE', description: 'Restart AI engine process', priority: 'HIGH', automated: false },
    ],
    'AI_ENGINE:CRITICAL': [
      { action: 'HALT_AI', description: 'Disable AI-driven trading signals', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Notify of AI engine failure', priority: 'HIGH', automated: true },
    ],
    'SYSTEM:CRITICAL': [
      { action: 'CHECK_HEALTH', description: 'Run full system health diagnostic', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Send system critical alert', priority: 'IMMEDIATE', automated: true },
    ],
    'SYSTEM:FATAL': [
      { action: 'GRACEFUL_SHUTDOWN', description: 'Initiate graceful system shutdown', priority: 'IMMEDIATE', automated: true },
      { action: 'NOTIFY', description: 'Send emergency system failure notification', priority: 'IMMEDIATE', automated: true },
    ],
    'NOTIFICATION:ERROR': [
      { action: 'QUEUE_RETRY', description: 'Queue notifications for retry', priority: 'LOW', automated: true },
    ],
    'API_RATE_LIMIT:CRITICAL': [
      { action: 'BACKOFF', description: 'Enter full API backoff mode', priority: 'IMMEDIATE', automated: true },
      { action: 'SWITCH_SOURCE', description: 'Switch to lower-frequency data source', priority: 'HIGH', automated: false },
    ],
  }

  // Category-only fallback for ERROR level
  const categoryFallback: Partial<Record<LogCategory, RecoveryAction[]>> = {
    MT5_CONNECTION: [
      { action: 'RECONNECT', description: 'Attempt MT5 reconnection', priority: 'HIGH', automated: true },
    ],
    TRADE_EXECUTION: [
      { action: 'VERIFY_POSITIONS', description: 'Verify all open positions', priority: 'HIGH', automated: true },
    ],
    RISK_MANAGEMENT: [
      { action: 'RECALCULATE', description: 'Recalculate risk parameters', priority: 'HIGH', automated: true },
    ],
    MONEY_MANAGEMENT: [
      { action: 'RESET_SIZING', description: 'Reset to minimum position sizing', priority: 'HIGH', automated: true },
    ],
    DATA_FEED: [
      { action: 'SWITCH_SOURCE', description: 'Switch to backup data source', priority: 'MEDIUM', automated: false },
    ],
    AI_ENGINE: [
      { action: 'FALLBACK_STRATEGY', description: 'Switch to fallback trading strategy', priority: 'MEDIUM', automated: true },
    ],
    SYSTEM: [
      { action: 'CHECK_HEALTH', description: 'Check system health', priority: 'HIGH', automated: true },
    ],
    NOTIFICATION: [
      { action: 'QUEUE_RETRY', description: 'Queue notifications for retry', priority: 'LOW', automated: true },
    ],
    API_RATE_LIMIT: [
      { action: 'BACKOFF', description: 'Enter API backoff mode', priority: 'HIGH', automated: true },
    ],
  }

  if (MAP[key]) return MAP[key]
  if (level === 'ERROR' && categoryFallback[category]) return categoryFallback[category]!

  // Universal default
  return [
    { action: 'INVESTIGATE', description: 'Manual investigation required', priority: 'MEDIUM', automated: false },
  ]
}

// ============================================
// PHASE 3: LOG HEALTH MONITORING
// ============================================

export interface LogHealthResult {
  isHealthy: boolean
  flushSuccessRate: number
  totalFlushes: number
  failedFlushes: number
  lastFlushTime: Date | null
  lastFailureTime: Date | null
  lastFailureReason: string | null
  bufferBacklog: number
}

class LogHealthMonitor {
  private recentFlushes: Array<{ success: boolean; time: Date }> = []
  private readonly WINDOW_SIZE = 20
  private _lastFlushTime: Date | null = null
  private _lastFailureTime: Date | null = null
  private _lastFailureReason: string | null = null
  private _totalFlushes = 0
  private _failedFlushes = 0

  recordFlushSuccess(): void {
    const now = new Date()
    this.recentFlushes.push({ success: true, time: now })
    if (this.recentFlushes.length > this.WINDOW_SIZE) {
      this.recentFlushes.shift()
    }
    this._lastFlushTime = now
    this._totalFlushes++
  }

  recordFlushFailure(error: string): void {
    const now = new Date()
    this.recentFlushes.push({ success: false, time: now })
    if (this.recentFlushes.length > this.WINDOW_SIZE) {
      this.recentFlushes.shift()
    }
    this._lastFailureTime = now
    this._lastFailureReason = error
    this._totalFlushes++
    this._failedFlushes++
  }

  getHealth(): LogHealthResult {
    const successCount = this.recentFlushes.filter(f => f.success).length
    const flushSuccessRate = this.recentFlushes.length > 0
      ? (successCount / this.recentFlushes.length) * 100
      : 100

    const isHealthy = this.recentFlushes.length === 0 || flushSuccessRate >= 90

    return {
      isHealthy,
      flushSuccessRate: Math.round(flushSuccessRate * 100) / 100,
      totalFlushes: this._totalFlushes,
      failedFlushes: this._failedFlushes,
      lastFlushTime: this._lastFlushTime,
      lastFailureTime: this._lastFailureTime,
      lastFailureReason: this._lastFailureReason,
      bufferBacklog: getBuffer().size(),
    }
  }
}

export const logHealthMonitor = new LogHealthMonitor()

// ============================================
// PHASE 3: ALERT ESCALATION PIPELINE
// ============================================

interface EscalationEventRecord {
  id: string
  triggerLevel: LogLevel
  triggerCategory: LogCategory
  triggerMessage: string
  escalationLevel: number
  actions: string[]
  resolved: boolean
  createdAt: Date
}

class EscalationManager {
  private recentEvents: EscalationEventRecord[] = []
  private readonly MAX_EVENTS = 100

  async escalate(
    level: LogLevel,
    category: LogCategory,
    message: string,
    ctx?: LogContext
  ): Promise<void> {
    let escalationLevel: number
    let actions: string[] = []

    switch (level) {
      case 'ERROR':
        escalationLevel = 1
        break
      case 'CRITICAL':
        escalationLevel = 2
        // Create EscalationEvent in DB for CRITICAL
        try {
          const record = await db.escalationEvent.create({
            data: {
              triggerLevel: level,
              triggerCategory: category,
              triggerMessage: message.substring(0, 500),
              escalationLevel: 2,
              actions: JSON.stringify(['LOG_AND_TRACK']),
              resolved: false,
            },
          })
          this.trackEvent({
            id: record.id,
            triggerLevel: level,
            triggerCategory: category,
            triggerMessage: message,
            escalationLevel: 2,
            actions: ['LOG_AND_TRACK'],
            resolved: false,
            createdAt: record.createdAt,
          })
        } catch (err) {
          console.error('[EscalationManager] Failed to persist CRITICAL escalation event:', err)
        }
        actions.push('LOG_AND_TRACK')
        return

      case 'FATAL':
        escalationLevel = 3
        // Create EscalationEvent in DB for FATAL
        const fatalActions: string[] = []

        // Phase 4: Actually wire recovery actions
        try {
          const actions_list = getRecoveryActions(category, 'FATAL')
          for (const act of actions_list) {
            if (act.automated) {
              logger.warn('NOTIFICATION', `Auto-recovery action: ${act.action} — ${act.description}`, {
                metadata: { triggerCategory: category, action: act.action, priority: act.priority, automated: act.automated },
              })
            }
            fatalActions.push(`${act.action}:${act.priority}`)
          }
        } catch (e) {
          console.error('[EscalationManager] Error getting recovery actions:', e)
        }
        actions.push(...fatalActions)

        try {
          const record = await db.escalationEvent.create({
            data: {
              triggerLevel: level,
              triggerCategory: category,
              triggerMessage: message.substring(0, 500),
              escalationLevel: 3,
              actions: JSON.stringify(fatalActions),
              resolved: false,
            },
          })
          this.trackEvent({
            id: record.id,
            triggerLevel: level,
            triggerCategory: category,
            triggerMessage: message,
            escalationLevel: 3,
            actions: fatalActions,
            resolved: false,
            createdAt: record.createdAt,
          })
        } catch (err) {
          console.error('[EscalationManager] Failed to persist FATAL escalation event:', err)
        }
        return

      default:
        // DEBUG, INFO, WARN — no escalation
        return
    }
  }

  private trackEvent(event: EscalationEventRecord): void {
    this.recentEvents.push(event)
    if (this.recentEvents.length > this.MAX_EVENTS) {
      this.recentEvents.shift()
    }
  }

  async getPendingEscalations(): Promise<EscalationEventRecord[]> {
    try {
      const dbEvents = await db.escalationEvent.findMany({
        where: { resolved: false },
        orderBy: { createdAt: 'desc' },
      })

      // Merge in-memory events that may not yet be in DB
      const merged = new Map<string, EscalationEventRecord>()
      for (const mem of this.recentEvents) {
        if (!mem.resolved) merged.set(mem.id, mem)
      }
      for (const dbEvt of dbEvents) {
        merged.set(dbEvt.id, {
          id: dbEvt.id,
          triggerLevel: dbEvt.triggerLevel as LogLevel,
          triggerCategory: dbEvt.triggerCategory as LogCategory,
          triggerMessage: dbEvt.triggerMessage,
          escalationLevel: dbEvt.escalationLevel,
          actions: JSON.parse(dbEvt.actions),
          resolved: dbEvt.resolved,
          createdAt: dbEvt.createdAt,
        })
      }
      return Array.from(merged.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      )
    } catch (err) {
      console.error('[EscalationManager] Failed to query pending escalations:', err)
      // Fall back to in-memory events
      return this.recentEvents.filter(e => !e.resolved)
    }
  }

  async resolveEscalation(id: string): Promise<void> {
    // Update in-memory
    const memEvent = this.recentEvents.find(e => e.id === id)
    if (memEvent) memEvent.resolved = true

    // Update DB
    try {
      await db.escalationEvent.update({
        where: { id },
        data: { resolved: true, resolvedAt: new Date() },
      })
    } catch (err) {
      console.error(`[EscalationManager] Failed to resolve escalation ${id}:`, err)
      throw err
    }
  }
}

export const escalationManager = new EscalationManager()

// ============================================
// PHASE 3: LOG EXPORT API
// ============================================

/**
 * Export logs with optional filters in JSON or CSV format.
 */
export async function exportLogs(params: {
  level?: LogLevel
  category?: LogCategory
  startDate?: Date
  endDate?: Date
  format?: 'json' | 'csv'
  limit?: number
}): Promise<string> {
  const { level, category, startDate, endDate, format = 'json', limit = 10000 } = params

  const where: Record<string, unknown> = {}
  if (level) where.level = level
  if (category) where.category = category
  if (startDate || endDate) {
    const createdAtFilter: Record<string, unknown> = {}
    if (startDate) createdAtFilter.gte = startDate
    if (endDate) createdAtFilter.lte = endDate
    where.createdAt = createdAtFilter
  }

  const logs = await db.tradingLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  if (format === 'csv') {
    const headers = 'id,timestamp,level,category,message,source,symbol,tradeId,details,metadata'
    const rows = logs.map(l => {
      const id = l.id
      const timestamp = l.createdAt.toISOString()
      const lvl = l.level
      const cat = l.category
      const msg = `"${(l.message ?? '').replace(/"/g, '""')}"`
      const src = l.source ? `"${l.source.replace(/"/g, '""')}"` : ''
      const sym = l.symbol ?? ''
      const tid = l.tradeId ?? ''
      const details = l.details ? `"${JSON.stringify(l.details).replace(/"/g, '""')}"` : ''
      const metadata = l.metadata ? `"${JSON.stringify(l.metadata).replace(/"/g, '""')}"` : ''
      return `${id},${timestamp},${lvl},${cat},${msg},${src},${sym},${tid},${details},${metadata}`
    })
    return [headers, ...rows].join('\n')
  }

  // Default: JSON format (compact — no pretty-printing for performance)
  return JSON.stringify(logs.map(l => ({
    id: l.id,
    timestamp: l.createdAt.toISOString(),
    level: l.level,
    category: l.category,
    message: l.message,
    source: l.source,
    symbol: l.symbol,
    tradeId: l.tradeId,
    details: l.details,
    metadata: l.metadata,
  })))
}

export default logger
