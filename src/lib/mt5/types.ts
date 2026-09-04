// MT5 connection module — exported types.
// Split from src/lib/mt5-connection.ts (v2.1.0 refactor — pure code movement).
// Re-exported unchanged through the facade at src/lib/mt5-connection.ts.

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
