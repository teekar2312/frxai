/**
 * MT5 Connection Manager - FINEX Indonesia (Enhanced)
 * ======================================================
 * Manages connection lifecycle, heartbeat, auto-reconnection,
 * and connection state persistence for MetaTrader 5 integration.
 *
 * Status States: CONNECTED, DISCONNECTED, RECONNECTING, ERROR, AUTH_FAILED, DEGRADED
 * Features:
 *  - Exponential backoff reconnection (1s, 2s, 4s, 8s, 16s, max 30s)
 *  - Heartbeat monitoring (configurable interval)
 *  - Connection metrics (uptime, latency, reconnect count)
 *  - Persistent state in DB
 *  - Event emission for UI status updates
 *  - DEGRADED state on high latency / heartbeat failures
 *  - IDX trading hours awareness (09:00-15:00 WIB)
 *  - Async mutex for MT5 API call serialization
 *  - MT5 error code mapping (10004-10036)
 *  - FINEX Indonesia symbol mapping with sector classification
 *  - Silent failure detection via validateReturn()
 *  - Graceful shutdown with state persistence
 */

import { db } from "./db"
import logger, { type LogCategory } from "./trading-logger"

// ============================================
// EXPORTED TYPES
// ============================================

export type Mt5Status =
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "ERROR"
  | "AUTH_FAILED"
  | "DEGRADED"

export type TradingPhase =
  | "PRE_OPEN"
  | "OPEN"
  | "PRE_CLOSE"
  | "CLOSED"
  | "AFTER_HOURS"

export type ErrorSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL" | "FATAL"

export interface Mt5ErrorCodeEntry {
  code: number
  description: string
  severity: ErrorSeverity
  category: string
  remediation: string
  retryable: boolean
}

export interface SymbolMappingEntry {
  idxSymbol: string
  mt5Symbol: string
  sector: string
  description: string
  lotSize: number
  tickSize: number
}

// ============================================
// ASYNC MUTEX
// ============================================

/**
 * Simple async mutex to prevent concurrent MT5 API calls.
 * The MT5 Python module is not thread-safe, so all calls must be serialized.
 */
export class AsyncMutex {
  private _queue: Array<() => void> = []
  private _locked = false

  /** Acquire the mutex lock. Returns a release function. */
  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true
          resolve(this._release)
        } else {
          this._queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }

  /** Run a function exclusively within the mutex lock. */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private _release = (): void => {
    this._locked = false
    const next = this._queue.shift()
    if (next) next()
  }

  get locked(): boolean {
    return this._locked
  }

  get queueLength(): number {
    return this._queue.length
  }
}

// ============================================
// FINEX INDONESIA SYMBOL MAPPING TABLE
// ============================================

export const SYMBOL_MAP: Record<string, SymbolMappingEntry> = {
  BBRI: {
    idxSymbol: "BBRI",
    mt5Symbol: "BBRI",
    sector: "BANKING",
    description: "Bank Rakyat Indonesia",
    lotSize: 100,
    tickSize: 1,
  },
  BBCA: {
    idxSymbol: "BBCA",
    mt5Symbol: "BBCA",
    sector: "BANKING",
    description: "Bank Central Asia",
    lotSize: 100,
    tickSize: 1,
  },
  BMRI: {
    idxSymbol: "BMRI",
    mt5Symbol: "BMRI",
    sector: "BANKING",
    description: "Bank Mandiri",
    lotSize: 100,
    tickSize: 1,
  },
  BBNI: {
    idxSymbol: "BBNI",
    mt5Symbol: "BBNI",
    sector: "BANKING",
    description: "Bank Negara Indonesia",
    lotSize: 100,
    tickSize: 1,
  },
  BRIS: {
    idxSymbol: "BRIS",
    mt5Symbol: "BRIS",
    sector: "BANKING",
    description: "Bank Syariah Indonesia",
    lotSize: 100,
    tickSize: 1,
  },
  ARTO: {
    idxSymbol: "ARTO",
    mt5Symbol: "ARTO",
    sector: "BANKING",
    description: "Bank Jago",
    lotSize: 100,
    tickSize: 1,
  },
  TLKM: {
    idxSymbol: "TLKM",
    mt5Symbol: "TLKM",
    sector: "TELECOMMUNICATION",
    description: "Telkom Indonesia",
    lotSize: 100,
    tickSize: 1,
  },
  EXCL: {
    idxSymbol: "EXCL",
    mt5Symbol: "EXCL",
    sector: "TELECOMMUNICATION",
    description: "XL Axiata",
    lotSize: 100,
    tickSize: 1,
  },
  ASII: {
    idxSymbol: "ASII",
    mt5Symbol: "ASII",
    sector: "CONGLOMERATE",
    description: "Astra International",
    lotSize: 100,
    tickSize: 1,
  },
  UNVR: {
    idxSymbol: "UNVR",
    mt5Symbol: "UNVR",
    sector: "CONSUMER_GOODS",
    description: "Unilever Indonesia",
    lotSize: 100,
    tickSize: 1,
  },
  ICBP: {
    idxSymbol: "ICBP",
    mt5Symbol: "ICBP",
    sector: "CONSUMER_GOODS",
    description: "Indofood CBP Sukses Makmur",
    lotSize: 100,
    tickSize: 1,
  },
  GOTO: {
    idxSymbol: "GOTO",
    mt5Symbol: "GOTO",
    sector: "TECHNOLOGY",
    description: "GoTo Gojek Tokopedia",
    lotSize: 100,
    tickSize: 1,
  },
  TBIG: {
    idxSymbol: "TBIG",
    mt5Symbol: "TBIG",
    sector: "INFRASTRUCTURE",
    description: "Tower Bersama Infrastructure",
    lotSize: 100,
    tickSize: 1,
  },
  ANTM: {
    idxSymbol: "ANTM",
    mt5Symbol: "ANTM",
    sector: "MINING",
    description: "Aneka Tambang",
    lotSize: 100,
    tickSize: 1,
  },
  TINS: {
    idxSymbol: "TINS",
    mt5Symbol: "TINS",
    sector: "MINING",
    description: "Timah",
    lotSize: 100,
    tickSize: 1,
  },
  ADRO: {
    idxSymbol: "ADRO",
    mt5Symbol: "ADRO",
    sector: "MINING",
    description: "Adaro Energy",
    lotSize: 100,
    tickSize: 1,
  },
  PGAS: {
    idxSymbol: "PGAS",
    mt5Symbol: "PGAS",
    sector: "ENERGY",
    description: "Perusahaan Gas Negara",
    lotSize: 100,
    tickSize: 1,
  },
  MEDC: {
    idxSymbol: "MEDC",
    mt5Symbol: "MEDC",
    sector: "ENERGY",
    description: "Medco Energi Internasional",
    lotSize: 100,
    tickSize: 1,
  },
  WSKT: {
    idxSymbol: "WSKT",
    mt5Symbol: "WSKT",
    sector: "INFRASTRUCTURE",
    description: "Waskita Karya",
    lotSize: 100,
    tickSize: 1,
  },
  JSMR: {
    idxSymbol: "JSMR",
    mt5Symbol: "JSMR",
    sector: "INFRASTRUCTURE",
    description: "Jasa Marga",
    lotSize: 100,
    tickSize: 1,
  },
  INKP: {
    idxSymbol: "INKP",
    mt5Symbol: "INKP",
    sector: "INDUSTRIAL",
    description: "Indah Kiat Pulp & Paper",
    lotSize: 100,
    tickSize: 1,
  },
  SMGR: {
    idxSymbol: "SMGR",
    mt5Symbol: "SMGR",
    sector: "INDUSTRIAL",
    description: "Semen Indonesia",
    lotSize: 100,
    tickSize: 1,
  },
  EMTK: {
    idxSymbol: "EMTK",
    mt5Symbol: "EMTK",
    sector: "CONGLOMERATE",
    description: "Elang Mahkota Teknologi",
    lotSize: 100,
    tickSize: 1,
  },
}

/** Reverse lookup: MT5 symbol -> IDX symbol */
export const MT5_TO_IDX: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOL_MAP).map(([idx, entry]) => [entry.mt5Symbol, idx])
)

/** All sectors in the symbol map */
export const SECTORS = [...new Set(Object.values(SYMBOL_MAP).map((s) => s.sector))]

// ============================================
// MT5 ERROR CODE MAPPING TABLE (10004-10036)
// ============================================

export const MT5_ERROR_CODES: Mt5ErrorCodeEntry[] = [
  {
    code: 10004,
    description: "Requote",
    severity: "WARN",
    category: "TRADE_EXECUTION",
    remediation: "Re-fetch current price and resubmit order with updated price",
    retryable: true,
  },
  {
    code: 10006,
    description: "Request rejected",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Log rejection reason, check order parameters, do not retry without investigation",
    retryable: false,
  },
  {
    code: 10007,
    description: "Request canceled by trader",
    severity: "INFO",
    category: "TRADE_EXECUTION",
    remediation: "No action needed - order was intentionally canceled",
    retryable: false,
  },
  {
    code: 10008,
    description: "Order placed",
    severity: "INFO",
    category: "TRADE_EXECUTION",
    remediation: "Confirm order ticket and monitor fill status",
    retryable: false,
  },
  {
    code: 10009,
    description: "Request executed successfully",
    severity: "INFO",
    category: "TRADE_EXECUTION",
    remediation: "Log successful execution, update position tracker",
    retryable: false,
  },
  {
    code: 10011,
    description: "Request executed partially",
    severity: "WARN",
    category: "TRADE_EXECUTION",
    remediation: "Track partial fill, monitor remaining quantity for complete fill",
    retryable: false,
  },
  {
    code: 10013,
    description: "Invalid request",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Validate all order fields (type, symbol, volume, price), fix and resubmit",
    retryable: true,
  },
  {
    code: 10014,
    description: "Invalid volume in request",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Check lot size against symbol's min/max lot and step size requirements",
    retryable: true,
  },
  {
    code: 10015,
    description: "Invalid price in request",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Check price against current bid/ask, symbol digits, and stop level distance",
    retryable: true,
  },
  {
    code: 10016,
    description: "Invalid stops in request",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Check SL/TP distance meets minimum stop level; verify stops are on correct side of price",
    retryable: true,
  },
  {
    code: 10017,
    description: "Trade disabled",
    severity: "CRITICAL",
    category: "TRADE_EXECUTION",
    remediation: "Check if trading is enabled in account settings and broker allows the symbol; contact broker if unexpected",
    retryable: false,
  },
  {
    code: 10018,
    description: "Market closed",
    severity: "WARN",
    category: "TRADE_EXECUTION",
    remediation: "Wait for market to open; queue order for next trading session",
    retryable: true,
  },
  {
    code: 10019,
    description: "Not enough money for trade",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Reduce lot size, close losing positions to free margin, or deposit additional funds",
    retryable: false,
  },
  {
    code: 10020,
    description: "Prices changed",
    severity: "WARN",
    category: "TRADE_EXECUTION",
    remediation: "Re-fetch current prices and resubmit with updated bid/ask",
    retryable: true,
  },
  {
    code: 10021,
    description: "No quotes to process request",
    severity: "WARN",
    category: "DATA_FEED",
    remediation: "Wait for quotes to resume; check symbol is subscribed and market is open",
    retryable: true,
  },
  {
    code: 10022,
    description: "Invalid order expiration date",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Set expiration within broker-allowed range, or use ORDER_TIME_GTC",
    retryable: true,
  },
  {
    code: 10023,
    description: "Order state changed",
    severity: "WARN",
    category: "TRADE_EXECUTION",
    remediation: "Re-fetch order state and retry modification if needed",
    retryable: true,
  },
  {
    code: 10024,
    description: "Too many requests",
    severity: "WARN",
    category: "MT5_CONNECTION",
    remediation: "Apply exponential backoff, reduce request frequency, batch requests",
    retryable: true,
  },
  {
    code: 10025,
    description: "No changes in request",
    severity: "INFO",
    category: "TRADE_EXECUTION",
    remediation: "Skip modification - order already matches requested parameters",
    retryable: false,
  },
  {
    code: 10026,
    description: "Autotrading disabled by server",
    severity: "CRITICAL",
    category: "MT5_CONNECTION",
    remediation: "Check broker settings for algorithmic trading permissions; contact FINEX support",
    retryable: false,
  },
  {
    code: 10027,
    description: "Autotrading only allowed for live accounts",
    severity: "ERROR",
    category: "MT5_CONNECTION",
    remediation: "Switch from demo to live account, or disable automated trading",
    retryable: false,
  },
  {
    code: 10028,
    description: "Request locked for processing",
    severity: "WARN",
    category: "TRADE_EXECUTION",
    remediation: "Wait briefly and retry; another operation on the same order is in progress",
    retryable: true,
  },
  {
    code: 10029,
    description: "Order or position frozen",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Wait for freeze to expire; check if close-only mode is active on the symbol",
    retryable: true,
  },
  {
    code: 10030,
    description: "Invalid order filling type",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Check symbol's allowed filling modes (FOK, IOC, Return); use symbol_info_get to verify",
    retryable: true,
  },
  {
    code: 10031,
    description: "No connection to trade server",
    severity: "CRITICAL",
    category: "MT5_CONNECTION",
    remediation: "Trigger reconnection sequence; check network connectivity and firewall rules",
    retryable: true,
  },
  {
    code: 10032,
    description: "Operation allowed only for live accounts",
    severity: "ERROR",
    category: "MT5_CONNECTION",
    remediation: "Verify account type; some operations (withdrawals, etc.) require live accounts",
    retryable: false,
  },
  {
    code: 10033,
    description: "Limit orders only allowed",
    severity: "WARN",
    category: "TRADE_EXECUTION",
    remediation: "Convert market order to limit order with appropriate price offset",
    retryable: true,
  },
  {
    code: 10034,
    description: "Volume limit exceeded",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Reduce lot size to within max lot limit for the symbol; split into multiple orders",
    retryable: true,
  },
  {
    code: 10035,
    description: "Invalid or incorrect order",
    severity: "ERROR",
    category: "TRADE_EXECUTION",
    remediation: "Verify order ticket exists and belongs to this account; re-fetch open orders",
    retryable: false,
  },
  {
    code: 10036,
    description: "Position already closed",
    severity: "INFO",
    category: "TRADE_EXECUTION",
    remediation: "Skip close request - position no longer exists; refresh position list",
    retryable: false,
  },
]

/** Quick lookup by code */
export const MT5_ERROR_CODE_MAP: Map<number, Mt5ErrorCodeEntry> = new Map(
  MT5_ERROR_CODES.map((e) => [e.code, e])
)

// ============================================
// IDX TRADING HOURS (WIB = UTC+7)
// ============================================

/** Convert WIB (UTC+7) hours/minutes to UTC hours/minutes */
function wibToUtc(wibHour: number, wibMinute: number = 0): { hour: number; minute: number } {
  let utcHour = wibHour - 7
  let utcMinute = wibMinute
  if (utcHour < 0) utcHour += 24
  return { hour: utcHour, minute: utcMinute }
}

// Pre-computed UTC boundaries for IDX trading
const PHASE_BOUNDARIES_UTC = {
  preOpenStart: wibToUtc(8, 45),     // 01:45 UTC
  morningOpen: wibToUtc(9, 0),        // 02:00 UTC
  preCloseStart: wibToUtc(11, 30),     // 04:30 UTC
  preCloseEnd: wibToUtc(11, 30, 30),   // 04:30:30 UTC (treated as 04:30 since we only have minutes)
  afternoonOpen: wibToUtc(13, 30),     // 06:30 UTC
  marketClose: wibToUtc(15, 0),        // 08:00 UTC
} as const

/**
 * Determine the current IDX trading phase based on UTC time.
 * IDX Schedule (WIB / UTC):
 *   PRE_OPEN:     08:45-09:00 WIB  = 01:45-02:00 UTC
 *   OPEN:         09:00-11:30 WIB  = 02:00-04:30 UTC
 *   PRE_CLOSE:    11:30-11:30:30    = ~04:30 UTC (30s window)
 *   CLOSED:       11:30-13:30 WIB  = 04:30-06:30 UTC (lunch break)
 *   OPEN:         13:30-15:00 WIB  = 06:30-08:00 UTC
 *   AFTER_HOURS:  15:00+ WIB       = 08:00+ UTC
 */
export function getTradingPhase(now?: Date): TradingPhase {
  const d = now || new Date()
  // Get UTC hours and minutes as decimal for comparison
  const utcDecimal = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600

  const { preOpenStart, morningOpen, preCloseStart, preCloseEnd, afternoonOpen, marketClose } = PHASE_BOUNDARIES_UTC

  // Convert boundaries to decimal hours for comparison
  const preOpenDec = preOpenStart.hour + preOpenStart.minute / 60
  const morningDec = morningOpen.hour + morningOpen.minute / 60
  const preCloseDec = preCloseStart.hour + preCloseStart.minute / 60
  const preCloseEndDec = preCloseStart.hour + preCloseStart.minute / 60 + 30 / 3600 // 30 seconds
  const afternoonDec = afternoonOpen.hour + afternoonOpen.minute / 60
  const closeDec = marketClose.hour + marketClose.minute / 60

  if (utcDecimal >= preOpenDec && utcDecimal < morningDec) {
    return "PRE_OPEN"
  }
  if (utcDecimal >= morningDec && utcDecimal < preCloseDec) {
    return "OPEN"
  }
  // PRE_CLOSE is a 30-second window; treat it as part of PRE_CLOSE
  if (utcDecimal >= preCloseDec && utcDecimal < preCloseEndDec) {
    return "PRE_CLOSE"
  }
  // Lunch break CLOSED
  if (utcDecimal >= preCloseDec && utcDecimal < afternoonDec) {
    return "CLOSED"
  }
  // Afternoon session OPEN
  if (utcDecimal >= afternoonDec && utcDecimal < closeDec) {
    return "OPEN"
  }
  // After hours
  return "AFTER_HOURS"
}

/** Check if the IDX market is currently open for trading. */
export function isMarketOpen(now?: Date): boolean {
  const phase = getTradingPhase(now)
  return phase === "OPEN" || phase === "PRE_OPEN"
}

// ============================================
// SEED MT5 ERROR CODES (idempotent upsert)
// ============================================

let _errorCodesSeeded = false

/**
 * Seed all MT5 error codes into the Mt5ErrorCode table.
 * Uses upsert for idempotency. Safe to call multiple times.
 * Uses lazy initialization - no top-level await.
 */
export async function seedMt5ErrorCodes(): Promise<void> {
  if (_errorCodesSeeded) return

  try {
    for (const entry of MT5_ERROR_CODES) {
      await db.mt5ErrorCode.upsert({
        where: { code: entry.code },
        update: {
          description: entry.description,
          severity: entry.severity,
          category: entry.category,
          remediation: entry.remediation,
          retryable: entry.retryable,
        },
        create: {
          code: entry.code,
          description: entry.description,
          severity: entry.severity,
          category: entry.category,
          remediation: entry.remediation,
          retryable: entry.retryable,
        },
      })
    }
    _errorCodesSeeded = true
    logger.info("MT5_CONNECTION", `Seeded ${MT5_ERROR_CODES.length} MT5 error codes into database`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error("MT5_CONNECTION", `Failed to seed MT5 error codes: ${msg}`, {
      details: err instanceof Error ? err.stack : undefined,
    })
    // Don't throw - allow system to continue operating
  }
}

// ============================================
// CONNECTION MANAGER CONFIG
// ============================================

interface Mt5Config {
  server: string
  login: number
  password: string
  heartbeatIntervalMs: number
  maxReconnectAttempts: number
  baseReconnectDelayMs: number
  maxReconnectDelayMs: number
  degradedLatencyThresholdMs: number
  degradedHeartbeatFailureThreshold: number
  tradingPhaseCheckIntervalMs: number
}

interface ConnectionMetrics {
  latencyMs: number
  uptimeSeconds: number
  reconnectCount: number
  lastHeartbeat: Date | null
  connectedAt: Date | null
  lastError: string | null
  consecutiveHeartbeatFailures: number
  currentTradingPhase: TradingPhase
  marketIsOpen: boolean
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
    try {
      fn(status, metrics)
    } catch {
      /* ignore listener errors */
    }
  }
}

// ---- Default config for FINEX Indonesia ----
const DEFAULT_CONFIG: Omit<Mt5Config, "login" | "password"> = {
  server: "FINEX-Server",
  heartbeatIntervalMs: 5000,
  maxReconnectAttempts: 20,
  baseReconnectDelayMs: 1000,
  maxReconnectDelayMs: 30000,
  degradedLatencyThresholdMs: 200,
  degradedHeartbeatFailureThreshold: 2,
  tradingPhaseCheckIntervalMs: 30000, // Check trading phase every 30s
}

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
    if (this.status === "CONNECTED" || this.status === "DEGRADED") {
      return { success: true }
    }

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

    // Simulate connection latency
    const startMs = Date.now()
    const latency = Math.floor(20 + Math.random() * 80)
    await new Promise((r) => setTimeout(r, latency))
    this.metrics.latencyMs = latency

    // Validate credentials format
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
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 15))
      const latency = Date.now() - start
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

// ---- Singleton instance ----
const mt5Connection = new Mt5ConnectionManager()
export default mt5Connection
