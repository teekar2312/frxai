/**
 * Risk Management Engine - FINEX Indonesia
 * ===========================================
 * Pre-trade validation, margin monitoring, daily loss limits,
 * margin call/stop out detection, correlation risk, risk scoring,
 * proactive margin monitoring, portfolio risk cap, leverage cap,
 * position concentration limits, slippage modeling, reserve capital,
 * and dynamic risk scaling.
 *
 * FINEX Broker Specs:
 *  - Leverage: 1:25
 *  - Proactive Margin Call 70%: Warning zone
 *  - Proactive Margin Call 60%: Strong warning, reduce sizes 50%
 *  - Margin Call Level: 50%
 *  - Stop Out Level: 20%
 *  - Max Order: 50 lots per trade
 *  - Max Open Positions: 200
 */

// Facade — implementation split into src/lib/risk/ (v2.1.0 refactor).
// Public API preserved; import paths remain @/lib/risk-engine.
// NOTE: cross-part plumbing that was module-private before the split
// (MIN_LOT, DEFAULT_CONFIG, PositionRiskBreakdown, calculateRiskScore,
// getRiskLevel, generateRecommendations) is re-exported additively —
// same convention as the src/lib/mt5/ split.
export * from "./risk/types"
export * from "./risk/internal-helpers"
export * from "./risk/config"
export * from "./risk/events"
export * from "./risk/margin-monitoring"
export * from "./risk/volatility-regime"
export * from "./risk/correlation"
export * from "./risk/gap-detection"
export * from "./risk/snapshot"
export * from "./risk/pre-trade"
export * from "./risk/stale-resolver"
export * from "./risk/audit-trail"
