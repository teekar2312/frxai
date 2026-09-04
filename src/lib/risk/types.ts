/*
 * Risk Management Engine — PART 1/12: types.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 25-248):
 *   - Types (ProactiveMarginZone, SectorExposureEntry, RiskConfigData,
 *     PreTradeCheck, RiskSnapshot, private RiskEventSummary)
 *   - Phase 3 Types (GapRiskResult, VolatilityRegimeResult,
 *     CorrelationMatrixResult, private PositionRiskBreakdown)
 *   - Sector mapping for correlation risk (SYMBOL_SECTORS)
 *   - Constants (MIN_LOT) + Default Config (DEFAULT_CONFIG)
 */

// ---- Types ----

export type ProactiveMarginZone =
  | "SAFE"
  | "PROACTIVE_70"
  | "PROACTIVE_60"
  | "MARGIN_CALL"
  | "STOP_OUT"

export interface SectorExposureEntry {
  sector: string
  exposurePct: number
  positionCount: number
  marginUsed: number
}

export interface RiskConfigData {
  maxRiskPerTrade: number          // % of equity
  maxDailyLoss: number             // % of equity
  maxWeeklyLoss: number            // % of equity
  maxMonthlyLoss: number           // % of equity
  maxMarginUsage: number           // % of equity
  maxDrawdown: number              // % of peak equity
  maxOpenPositions: number
  maxLotPerTrade: number
  maxLotPerSymbol: number
  marginCallLevel: number          // %
  stopOutLevel: number             // %
  maxCorrelatedExposure: number    // %
  cooldownAfterLossMinutes: number
  // --- Deep audit fields ---
  proactiveMcLevel70: boolean      // Warn at 70% margin level
  proactiveMcLevel60: boolean      // Warn at 60% margin level
  maxPortfolioRiskPct: number      // Max total risk across all positions (% of equity)
  maxLeveragePerTrade: number      // Max effective leverage per single trade
  maxSingleStockPct: number        // Max % of equity in single stock
  maxSectorPct: number             // Max % of equity in single sector
  slippageTolerancePips: number    // Max acceptable slippage in pips
  reserveCapitalPct: number        // % of equity to keep as cash reserve
  // --- Phase 3 fields ---
  gapRiskMaxPct: number            // Max overnight gap risk tolerance %
  gapRiskAlertPct: number          // Alert threshold for gap risk %
  highVolRiskReduction: number     // Risk multiplier in HIGH_VOLATILITY
  lowVolRiskReduction: number      // Risk multiplier in LOW_VOLATILITY
}

export interface PreTradeCheck {
  approved: boolean
  reason?: string
  riskAmount: number               // Dollar risk for this trade
  riskPercent: number              // % of equity
  suggestedLotSize: number         // Lot size within risk limits
  warnings: string[]
  positionSizeReduction?: number   // 0-1, fraction to reduce size by (e.g. 0.5 for 50% reduction at PROACTIVE_60)
  // --- Phase 4 fields ---
  volatilityMultiplier: number     // Risk multiplier from volatility regime detection
  gapRisk?: GapRiskResult          // Gap risk assessment result
}

export interface RiskSnapshot {
  equity: number
  balance: number
  freeMargin: number
  marginUsed: number
  marginLevelPercent: number
  dailyPnl: number
  dailyPnlPercent: number
  weeklyPnl: number
  weeklyPnlPercent: number
  monthlyPnl: number
  monthlyPnlPercent: number
  currentDrawdown: number
  maxDrawdown: number
  maxAllowedDrawdown: number
  riskScore: number                 // 0-10
  riskLevel: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "CRITICAL"
  openPositions: number
  maxPositionsAllowed: number
  marginUsagePercent: number
  maxMarginAllowed: number
  dailyLossRemaining: number
  dailyLossLimit: number
  isDailyLimitReached: boolean
  isMarginCallWarning: boolean
  isStopOutWarning: boolean
  isTradingAllowed: boolean
  tradingBlockReason?: string
  recentRiskEvents: RiskEventSummary[]
  recommendations: string[]
  positions: PositionRiskBreakdown[]
  // --- Deep audit fields ---
  proactiveMarginZone: ProactiveMarginZone
  sectorExposure: SectorExposureEntry[]
  portfolioTotalRiskPct: number    // Total risk across all positions as % of equity
  leverageUsed: number             // Current effective leverage
  reserveCapitalPct: number        // Current reserve capital %
  scalingFactor: number            // Dynamic risk scaling factor
  // --- Phase 3 fields ---
  volatilityRegime: string         // Current volatility regime
  volatilityRiskMultiplier: number // Risk multiplier from volatility regime
  circuitBreakerState: string      // Circuit breaker state (CLOSED, OPEN, HALF_OPEN)
  connectionQuality: number        // Connection quality score (0-100)
  hasGapRisk: boolean              // Whether gap risk is elevated
  unresolvedRiskEvents: number     // Count of unresolved risk events
}

interface RiskEventSummary {
  eventType: string
  severity: string
  message: string
  createdAt: string
  resolved: boolean
}

// ---- Phase 3 Types ----

export interface GapRiskResult {
  hasGapRisk: boolean
  estimatedMaxGapPct: number
  riskAmount: number
  recommendation: string
  severity: string
}

export interface VolatilityRegimeResult {
  regime: "HIGH_VOLATILITY" | "NORMAL" | "LOW_VOLATILITY"
  riskMultiplier: number
  reason: string
}

export interface CorrelationMatrixResult {
  sectors: Array<{
    sector: string
    exposure: number
    positionCount: number
    correlationGroup: string
  }>
}

interface PositionRiskBreakdown {
  tradeId: string
  symbol: string
  direction: string
  lotSize: number
  entryPrice: number
  currentPrice: number
  sl: number | null
  tp: number | null
  margin: number
  pnl: number
  pnlPercent: number
  riskAmount: number
  riskPercent: number
  strategy: string | null
  trailingStop: boolean
}

// ---- Sector mapping for correlation risk ----
// Extended with additional IDX stocks
export const SYMBOL_SECTORS: Record<string, string> = {
  // Banking
  BBCA: "Banking", BBRI: "Banking", BMRI: "Banking", BRIS: "Banking", BBNI: "Banking",
  ARTO: "Banking", NISP: "Banking", BTPS: "Banking", MEGA: "Banking",
  // Telecommunication
  TLKM: "Telecommunication", EXCL: "Telecommunication", TBIG: "Telecommunication",
  ISAT: "Telecommunication", 
  // Conglomerate
  ASII: "Conglomerate",
  // Consumer Goods
  UNVR: "Consumer Goods", ICBP: "Consumer Goods",
  ACST: "Consumer Goods", INDF: "Consumer Goods", MYOR: "Consumer Goods",
  // Technology
  GOTO: "Technology", BUKA: "Technology",
  // Mining
  ANTM: "Mining", TINS: "Mining", ADRO: "Mining",
  PTBA: "Mining", MDKA: "Mining", TKIM: "Mining",
  // Energy
  PGAS: "Energy", MEDC: "Energy", AKRA: "Energy",
  // Infrastructure
  WSKT: "Infrastructure", JSMR: "Infrastructure",
  TOWR: "Infrastructure", SMRA: "Infrastructure",
  // Industrial
  INKP: "Industrial", SMGR: "Industrial",
  ASRI: "Industrial",
  // Media
  EMTK: "Media", MNCN: "Media", 
  // Property
  BSDE: "Property", CTRA: "Property",
}

// ---- Constants ----
const MIN_LOT = 0.01

// ---- Default Config ----

const DEFAULT_CONFIG: RiskConfigData = {
  maxRiskPerTrade: 0.5,
  maxDailyLoss: 2.0,
  maxWeeklyLoss: 5.0,
  maxMonthlyLoss: 10.0,
  maxMarginUsage: 50.0,
  maxDrawdown: 10.0,
  maxOpenPositions: 200,
  maxLotPerTrade: 50.0,
  maxLotPerSymbol: 100.0,
  marginCallLevel: 50.0,
  stopOutLevel: 20.0,
  maxCorrelatedExposure: 15.0,
  cooldownAfterLossMinutes: 15,
  // Deep audit defaults
  proactiveMcLevel70: true,
  proactiveMcLevel60: true,
  maxPortfolioRiskPct: 5.0,
  maxLeveragePerTrade: 10.0,
  maxSingleStockPct: 5.0,
  maxSectorPct: 15.0,
  slippageTolerancePips: 3.0,
  reserveCapitalPct: 20.0,
  // Phase 3 defaults
  gapRiskMaxPct: 3.0,
  gapRiskAlertPct: 2.0,
  highVolRiskReduction: 0.5,
  lowVolRiskReduction: 0.8,
}

// ---- Cross-part sharing (internal plumbing) ----
// MIN_LOT / DEFAULT_CONFIG and the PositionRiskBreakdown type were
// module-private before the split; they are consumed by ./pre-trade.ts,
// ./config.ts, ./correlation.ts and ./snapshot.ts. Shared via export-list
// (not declaration-style) so the facade's re-exported declaration set stays
// identical to the pre-split module.

export { MIN_LOT, DEFAULT_CONFIG }
export type { PositionRiskBreakdown }
