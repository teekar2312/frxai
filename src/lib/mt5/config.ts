// MT5 connection module — connection manager config, status-change
// listeners, and default FINEX configuration.
// Split from src/lib/mt5-connection.ts (v2.1.0 refactor — pure code movement).
// Re-exported unchanged through the facade at src/lib/mt5-connection.ts.

import type { Mt5Status, TradingPhase } from "./types"

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
  tradingPhaseCheckIntervalMs: 5000, // Check trading phase every 5s to catch all transitions
}

// ---- Cross-part sharing (internal plumbing) ----
// DEFAULT_CONFIG / emitStatusChange and the Mt5Config / ConnectionMetrics types
// were module-private before the split; they are consumed by ./connection-manager.ts.
// Shared via export-list (not declaration-style) so the facade's re-exported
// declaration set stays identical to the pre-split module.

export { DEFAULT_CONFIG, emitStatusChange }
export type { Mt5Config, ConnectionMetrics }
