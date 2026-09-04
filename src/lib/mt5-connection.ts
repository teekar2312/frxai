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
 *  - IDX trading hours awareness (09:00-16:15 WIB)
 *  - Async mutex for MT5 API call serialization
 *  - MT5 error code mapping (10004-10036)
 *  - FINEX Indonesia symbol mapping with sector classification
 *  - Silent failure detection via validateReturn()
 *  - Graceful shutdown with state persistence
 */

// Facade — implementation split into src/lib/mt5/ (v2.1.0 refactor).
// Public API preserved; import paths remain @/lib/mt5-connection.
// (src/lib/mt5/bridge.ts is internal-only and intentionally not re-exported.)
export * from "./mt5/types"
export * from "./mt5/mutex"
export * from "./mt5/symbols"
export * from "./mt5/config"
export * from "./mt5/circuit-breaker"
export * from "./mt5/connection-manager"
export { default } from "./mt5/connection-manager"
