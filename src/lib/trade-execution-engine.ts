/*
 * Trade Execution Engine - FINEX Indonesia
 * ====================================================
 * Comprehensive trade lifecycle management with:
 *   1. Trade State Machine (valid transitions enforcement)
 *   2. Trade Lifecycle Events (event bus with pub/sub)
 *   3. SL/TP Trigger Engine (automatic stop-loss / take-profit)
 *   4. Trailing Stop Engine (dynamic SL adjustment)
 *   5. Partial Close Engine (scaled exit at TP levels)
 *   6. Position Sync Mechanism (broker ↔ local DB reconciliation)
 *   7. Price Update Pipeline (orchestrator for all price-driven checks)
 *   8. Emergency Close All (margin call / connection loss handler)
 *   9. Execution Pipeline Integration (full order → trade lifecycle)
 */

// Facade — implementation split into src/lib/execution/ (v2.1.0 refactor).
// Public API preserved; import paths remain @/lib/trade-execution-engine.
// Union of the parts below is exactly the original export set (verified).
export * from './execution/types'
export * from './execution/lifecycle'
export * from './execution/pnl'
export * from './execution/trigger-engine'
export * from './execution/trailing-stop'
export * from './execution/partial-close'
export * from './execution/position-sync'
export * from './execution/price-pipeline'
export * from './execution/emergency-close'
export * from './execution/pipeline'
