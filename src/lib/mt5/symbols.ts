// MT5 connection module — FINEX symbol mapping, MT5 error-code table,
// IDX trading hours, and DB error-code seeding.
// Split from src/lib/mt5-connection.ts (v2.1.0 refactor — pure code movement).
// Re-exported unchanged through the facade at src/lib/mt5-connection.ts.

import { db } from "@/lib/db"
import logger from "@/lib/trading-logger"
import type { SymbolMappingEntry, Mt5ErrorCodeEntry, TradingPhase } from "./types"

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

/**
 * Validate that a symbol exists in the FINEX symbol mapping.
 * Returns the mapping entry if found, or null if unknown.
 */
export function validateSymbol(symbol: string): SymbolMappingEntry | null {
  return SYMBOL_MAP[symbol.toUpperCase()] ?? null
}

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
// Correct IDX schedule:
//   Pre-market: 09:00-09:05 WIB, Session 1: 09:05-11:30 WIB, Lunch: 11:30-13:00 WIB,
//   Session 2: 13:00-16:15 WIB, Post-close: 16:15-17:00 WIB
const PHASE_BOUNDARIES_UTC = {
  preOpenStart: wibToUtc(9, 0),       // 02:00 UTC  — pre-market order queuing
  morningOpen: wibToUtc(9, 5),         // 02:05 UTC  — Session 1 open
  preCloseStart: wibToUtc(11, 29),     // 04:29 UTC  — 1 min before Session 1 close
  preCloseEnd: wibToUtc(11, 30),       // 04:30 UTC  — Session 1 close
  afternoonOpen: wibToUtc(13, 0),      // 06:00 UTC  — Session 2 open
  marketClose: wibToUtc(16, 15),       // 09:15 UTC  — market close
  postCloseEnd: wibToUtc(17, 0),       // 10:00 UTC  — post-close period end
} as const

/**
 * Determine the current IDX trading phase based on UTC time.
 * Correct IDX Schedule (WIB / UTC):
 *   PRE_OPEN:     09:00-09:05 WIB  = 02:00-02:05 UTC  (order queuing only)
 *   OPEN:         09:05-11:29 WIB  = 02:05-04:29 UTC  (Session 1)
 *   PRE_CLOSE:    11:29-11:30 WIB  = 04:29-04:30 UTC  (1 min before close)
 *   CLOSED:       11:30-13:00 WIB  = 04:30-06:00 UTC  (lunch break)
 *   OPEN:         13:00-16:15 WIB  = 06:00-09:15 UTC  (Session 2)
 *   AFTER_HOURS:  16:15+ WIB       = 09:15+ UTC
 */
export function getTradingPhase(now?: Date): TradingPhase {
  const d = now || new Date()
  // IDX does not trade on weekends (Saturday=6, Sunday=0 UTC)
  const dayOfWeek = d.getUTCDay()
  if (dayOfWeek === 0 || dayOfWeek === 6) return "CLOSED"
  // Get UTC hours and minutes as decimal for comparison
  const utcDecimal = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600

  const { preOpenStart, morningOpen, preCloseStart, preCloseEnd, afternoonOpen, marketClose } = PHASE_BOUNDARIES_UTC

  // Convert boundaries to decimal hours for comparison
  const preOpenDec = preOpenStart.hour + preOpenStart.minute / 60
  const morningDec = morningOpen.hour + morningOpen.minute / 60
  const preCloseDec = preCloseStart.hour + preCloseStart.minute / 60
  const preCloseEndDec = preCloseEnd.hour + preCloseEnd.minute / 60
  const afternoonDec = afternoonOpen.hour + afternoonOpen.minute / 60
  const closeDec = marketClose.hour + marketClose.minute / 60

  if (utcDecimal >= preOpenDec && utcDecimal < morningDec) {
    return "PRE_OPEN"
  }
  if (utcDecimal >= morningDec && utcDecimal < preCloseDec) {
    return "OPEN"
  }
  // PRE_CLOSE: 1-minute window before Session 1 close
  if (utcDecimal >= preCloseDec && utcDecimal < preCloseEndDec) {
    return "PRE_CLOSE"
  }
  // Lunch break CLOSED
  if (utcDecimal >= preCloseEndDec && utcDecimal < afternoonDec) {
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
  return phase === "OPEN"
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
