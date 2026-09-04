/**
 * Unit tests — src/lib/money-management.ts (Batch B / Task 5-b)
 * ============================================================
 * Only PURE functions are covered here (no db / no I/O):
 *   - calculateRiskOfRuin          (risk-of-ruin closed-form estimate)
 *   - calculateDrawdownRecovery    (recovery % + risk-reduction ladder)
 *   - calculateProgressiveDrawdownFactor (smooth drawdown scaling curve)
 *   - calculatePartialProfitLevels (3-level partial take-profit ladder)
 *   - getExchangeRateRisk          (static FX awareness payload)
 *
 * DB-bound functions (calculateKelly, calculatePositionSize, scaling factor,
 * win-rate adjustment, halt checks) are intentionally NOT unit tested —
 * they query prisma models (db.trade / db.dailyPerformance / db.riskConfig)
 * and are exercised via integration routes instead. Reported as a coverage
 * limitation in the task report.
 */
import { describe, test, expect } from 'bun:test'
import {
  calculateRiskOfRuin,
  calculateDrawdownRecovery,
  calculateProgressiveDrawdownFactor,
  calculatePartialProfitLevels,
  getExchangeRateRisk,
} from '../src/lib/money-management'

// ============================================================================
// RISK OF RUIN
// ============================================================================

describe('calculateRiskOfRuin', () => {
  test('strong edge with small risk → near-zero probability, "Very Low Risk"', () => {
    const r = calculateRiskOfRuin({ winRate: 60, avgWin: 100, avgLoss: 50, riskPerTrade: 2 })
    expect(r.probability).toBeGreaterThanOrEqual(0)
    expect(r.probability).toBeLessThan(1)
    expect(r.interpretation).toBe('Very Low Risk')
  })

  test('closed-form value matches hand calculation (risk 10%, W 60%, R 2)', () => {
    // edge = 0.6 - 0.4/2 = 0.4; q = 0.6/1.4; units = 10
    // ror = (0.6/1.4)^10 * 100 ≈ 0.0209 → rounded to 0.02
    const r = calculateRiskOfRuin({ winRate: 60, avgWin: 100, avgLoss: 50, riskPerTrade: 10 })
    expect(r.probability).toBeCloseTo(0.02, 2)
  })

  test('moderate scenario lands in "Moderate Risk" band', () => {
    // W 0.55, R 1.25 → edge 0.19, q ≈ 0.6807, units = 5 → ror ≈ 14.6%
    const r = calculateRiskOfRuin({ winRate: 55, avgWin: 100, avgLoss: 80, riskPerTrade: 20 })
    expect(r.probability).toBeGreaterThan(5)
    expect(r.probability).toBeLessThan(15)
    expect(r.interpretation).toBe('Moderate Risk')
  })

  test('winRate <= 0 → probability 100 with "Cannot calculate" interpretation', () => {
    const r = calculateRiskOfRuin({ winRate: 0, avgWin: 100, avgLoss: 50, riskPerTrade: 1 })
    expect(r.probability).toBe(100)
    expect(r.interpretation).toContain('Cannot calculate')
  })

  test('avgLoss <= 0 → probability 100 with "Cannot calculate" interpretation', () => {
    const r = calculateRiskOfRuin({ winRate: 60, avgWin: 100, avgLoss: 0, riskPerTrade: 1 })
    expect(r.probability).toBe(100)
    expect(r.interpretation).toContain('Cannot calculate')
  })

  test('avgWin <= 0 → probability 100, "Average win is zero or negative"', () => {
    const r = calculateRiskOfRuin({ winRate: 60, avgWin: 0, avgLoss: 50, riskPerTrade: 1 })
    expect(r.probability).toBe(100)
    expect(r.interpretation).toContain('Average win is zero or negative')
  })

  test('negative edge (unprofitable strategy) → probability 100, "Negative edge"', () => {
    // W 0.3, R 0.5 → edge = 0.3 - 0.7/0.5 = -1.1
    const r = calculateRiskOfRuin({ winRate: 30, avgWin: 50, avgLoss: 100, riskPerTrade: 1 })
    expect(r.probability).toBe(100)
    expect(r.interpretation).toContain('Negative edge')
  })

  test('probability is capped at 100 and rounded to 2 decimals', () => {
    const r = calculateRiskOfRuin({ winRate: 40, avgWin: 100, avgLoss: 100, riskPerTrade: 50 })
    expect(r.probability).toBeLessThanOrEqual(100)
    expect(r.probability).toBeGreaterThanOrEqual(0)
    // always carries a recommendation string
    expect(r.recommendation.length).toBeGreaterThan(0)
  })

  test('all interpretation bands are reachable (Low / High / Extreme)', () => {
    // Low Risk band (1-5%): W 60%, R 2, risk 20% → 0.4286^5 ≈ 1.45%
    expect(
      calculateRiskOfRuin({ winRate: 60, avgWin: 100, avgLoss: 50, riskPerTrade: 20 })
    ).toMatchObject({ interpretation: 'Low Risk' })
    // High Risk band (15-30%): W 45%, R ~1.43, risk 10% → 27.2%
    expect(
      calculateRiskOfRuin({ winRate: 45, avgWin: 100, avgLoss: 70, riskPerTrade: 10 })
    ).toMatchObject({ interpretation: 'High Risk' })
    // Extreme Risk band (≥ 30%): W 45%, R 1.25, risk 5% → 67%
    expect(
      calculateRiskOfRuin({ winRate: 45, avgWin: 100, avgLoss: 80, riskPerTrade: 5 })
    ).toMatchObject({ interpretation: 'Extreme Risk' })
  })
})

// ============================================================================
// DRAWDOWN RECOVERY
// ============================================================================

describe('calculateDrawdownRecovery', () => {
  test('recoveryNeeded follows dd / (100 - dd) * 100', () => {
    expect(calculateDrawdownRecovery(10).recoveryNeeded).toBeCloseTo(11.11, 2)
    expect(calculateDrawdownRecovery(20).recoveryNeeded).toBe(25)
    expect(calculateDrawdownRecovery(50).recoveryNeeded).toBe(100)
    expect(calculateDrawdownRecovery(0).recoveryNeeded).toBe(0)
  })

  test('input is clamped to [0, 99] before computing', () => {
    expect(calculateDrawdownRecovery(-25).drawdownPct).toBe(0)
    expect(calculateDrawdownRecovery(150).drawdownPct).toBe(99)
    expect(calculateDrawdownRecovery(150).recoveryNeeded).toBe(9900)
  })

  test('risk-reduction ladder escalates with drawdown severity', () => {
    expect(calculateDrawdownRecovery(3).riskReductionPct).toBe(0) // NORMAL
    expect(calculateDrawdownRecovery(3).strategy).toContain('NORMAL')
    expect(calculateDrawdownRecovery(8).riskReductionPct).toBe(10) // CAUTION
    expect(calculateDrawdownRecovery(10).riskReductionPct).toBe(25) // ELEVATED
    expect(calculateDrawdownRecovery(18).riskReductionPct).toBe(50) // HIGH
    expect(calculateDrawdownRecovery(25).riskReductionPct).toBe(75) // CRITICAL
    expect(calculateDrawdownRecovery(40).riskReductionPct).toBe(90) // EMERGENCY
    expect(calculateDrawdownRecovery(60).riskReductionPct).toBe(100) // CATASTROPHIC
    expect(calculateDrawdownRecovery(60).strategy).toContain('CATASTROPHIC')
  })
})

// ============================================================================
// PROGRESSIVE DRAWDOWN FACTOR
// ============================================================================

describe('calculateProgressiveDrawdownFactor', () => {
  test('no drawdown or zero max → full size (1.0)', () => {
    expect(calculateProgressiveDrawdownFactor(0, 20)).toBe(1)
    expect(calculateProgressiveDrawdownFactor(10, 0)).toBe(1)
    expect(calculateProgressiveDrawdownFactor(0, 0)).toBe(1)
  })

  test('up to 50% of max drawdown → no reduction', () => {
    expect(calculateProgressiveDrawdownFactor(5, 20)).toBe(1)
    expect(calculateProgressiveDrawdownFactor(10, 20)).toBe(1)
  })

  test('linear segments: 50-70% → 1.0→0.75, 70-85% → 0.75→0.5, 85-95% → 0.5→0.25', () => {
    // ratio 0.6 → 1 - (0.1/0.2)*0.25 = 0.875
    expect(calculateProgressiveDrawdownFactor(12, 20)).toBeCloseTo(0.875, 6)
    // ratio 0.7 (segment boundary) → 0.75
    expect(calculateProgressiveDrawdownFactor(14, 20)).toBeCloseTo(0.75, 6)
    // ratio 0.8 → 0.75 - (0.1/0.15)*0.25 = 0.58333…
    expect(calculateProgressiveDrawdownFactor(16, 20)).toBeCloseTo(0.75 - (0.1 / 0.15) * 0.25, 6)
    // ratio 0.85 → 0.5
    expect(calculateProgressiveDrawdownFactor(17, 20)).toBeCloseTo(0.5, 6)
    // ratio 0.9 → 0.5 - (0.05/0.1)*0.25 = 0.375
    expect(calculateProgressiveDrawdownFactor(18, 20)).toBeCloseTo(0.375, 6)
  })

  test('ratio >= 95% and beyond max → floor at 0.25', () => {
    expect(calculateProgressiveDrawdownFactor(19, 20)).toBeCloseTo(0.25, 10)
    expect(calculateProgressiveDrawdownFactor(20, 20)).toBe(0.25)
    expect(calculateProgressiveDrawdownFactor(99, 20)).toBe(0.25) // ratio clamped to 1
  })

  test('factor is monotonically non-increasing across the whole range', () => {
    let prev = 1.0001
    for (let dd = 0; dd <= 20; dd += 0.25) {
      const f = calculateProgressiveDrawdownFactor(dd, 20)
      expect(f).toBeLessThanOrEqual(prev + 1e-9)
      expect(f).toBeGreaterThanOrEqual(0.25)
      prev = f
    }
  })
})

// ============================================================================
// PARTIAL PROFIT LEVELS
// ============================================================================

describe('calculatePartialProfitLevels', () => {
  test('BUY: 3 evenly spaced levels from entry to TP with 30/30/40 split', () => {
    const { levels } = calculatePartialProfitLevels({ entryPrice: 100, direction: 'BUY', tp: 112 })
    expect(levels.length).toBe(3)
    expect(levels[0]).toMatchObject({ level: 1, price: 104, closePercent: 30 })
    expect(levels[1]).toMatchObject({ level: 2, price: 108, closePercent: 30 })
    expect(levels[2]).toMatchObject({ level: 3, price: 112, closePercent: 40 })
    expect(levels[2].price).toBe(112)
  })

  test('SELL: levels walk DOWN from entry to TP', () => {
    const { levels } = calculatePartialProfitLevels({ entryPrice: 112, direction: 'SELL', tp: 100 })
    expect(levels.length).toBe(3)
    expect(levels[0].price).toBe(108)
    expect(levels[1].price).toBe(104)
    expect(levels[2].price).toBe(100)
  })

  test('invalid range (TP on wrong side of entry) → no levels', () => {
    expect(calculatePartialProfitLevels({ entryPrice: 100, direction: 'BUY', tp: 100 }).levels).toEqual([])
    expect(calculatePartialProfitLevels({ entryPrice: 100, direction: 'BUY', tp: 90 }).levels).toEqual([])
    expect(calculatePartialProfitLevels({ entryPrice: 100, direction: 'SELL', tp: 110 }).levels).toEqual([])
  })

  test('custom risk-reward ratio rescales the ladder but keeps percentages', () => {
    const { levels } = calculatePartialProfitLevels({
      entryPrice: 100,
      direction: 'BUY',
      tp: 112,
      riskRewardRatio: 0.5,
    })
    // scaledRange = 12 * (0.5/3) = 2 → levels at +2, +4, +6
    expect(levels[0].price).toBe(102)
    expect(levels[1].price).toBe(104)
    expect(levels[2].price).toBe(106)
    expect(levels.map((l) => l.closePercent)).toEqual([30, 30, 40])
  })

  test('custom risk-reward ratio never places levels beyond the TP', () => {
    const { levels } = calculatePartialProfitLevels({
      entryPrice: 100,
      direction: 'BUY',
      tp: 112,
      riskRewardRatio: 3, // scaled range 12 > max 4 → clamped to 4
    })
    expect(levels[2].price).toBeLessThanOrEqual(112)
    expect(levels[0].price).toBe(104)
  })
})

// ============================================================================
// FX AWARENESS
// ============================================================================

describe('getExchangeRateRisk', () => {
  test('reports USD/IDR exposure with actionable guidance', () => {
    const r = getExchangeRateRisk()
    expect(r.hasExposure).toBe(true)
    expect(r.baseCurrency).toBe('USD')
    expect(r.quoteCurrency).toBe('IDR')
    expect(r.warning.length).toBeGreaterThan(0)
    expect(r.recommendation.length).toBeGreaterThan(0)
    expect(r.openPositionsSummary.length).toBeGreaterThan(0)
  })
})
