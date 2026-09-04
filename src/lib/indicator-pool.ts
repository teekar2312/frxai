/**
 * Technical Indicator Calculation Engine
 * ======================================
 * Comprehensive indicator pool for IDX/FINEX broker via MT5.
 * Supports 10 technical indicators with dependency graph,
 * caching, validation, and strategy signal generation.
 *
 * Indicators: SMA, EMA, RSI, MACD, ATR, BOLLINGER, STOCHASTIC, ADX, VWAP, PIVOT_POINTS
 *
 * All calculations use real math — no stubs, no Math.sin/random hacks.
 */

// Facade — implementation split into src/lib/indicators/ (v2.1.0 refactor).
// Public API preserved; import paths remain @/lib/indicator-pool.
// helpers.ts (isValidPrice, standardDeviation, cacheKey) is internal sibling
// wiring and is deliberately NOT re-exported here.
export * from './indicators/types'
export * from './indicators/calculations'
export * from './indicators/pool'
export * from './indicators/candles'
export * from './indicators/strategies'
export * from './indicators/snapshot'
