/*
 * Risk Management Engine — PART 7/12: correlation.ts
 * Pure-movement split from src/lib/risk-engine.ts (facade preserves the
 * public API; import paths remain @/lib/risk-engine).
 *
 * Contains (original lines 1725-1786): PHASE 3: CORRELATION MATRIX
 * (calculateCorrelationMatrix).
 */

import { type CorrelationMatrixResult } from "./types"

// ============================================
// PHASE 3: CORRELATION MATRIX
// ============================================

/**
 * Calculate a sector-level correlation matrix from open positions.
 *
 * Groups positions by sector, calculates sector exposure as % of total margin,
 * and assigns correlation groups based on position count per sector.
 */
export function calculateCorrelationMatrix(
  openPositions: Array<{ symbol: string; sector: string; margin: number; pnl: number }>,
): CorrelationMatrixResult {
  // Group by sector
  const sectorMap = new Map<string, { margin: number; count: number; pnl: number }>()
  let totalMargin = 0

  for (const pos of openPositions) {
    const sector = pos.sector || "Unknown"
    const existing = sectorMap.get(sector)
    if (existing) {
      existing.margin += pos.margin
      existing.count += 1
      existing.pnl += pos.pnl
    } else {
      sectorMap.set(sector, { margin: pos.margin, count: 1, pnl: pos.pnl })
    }
    totalMargin += pos.margin
  }

  const sectors: CorrelationMatrixResult["sectors"] = []

  for (const [sector, data] of sectorMap.entries()) {
    const exposure = totalMargin > 0
      ? Math.round((data.margin / totalMargin) * 10000) / 100
      : 0

    // Assign correlation group based on position count
    let correlationGroup: string
    if (data.count > 3) {
      correlationGroup = "HIGH_CORRELATION"
    } else if (data.count >= 2) {
      correlationGroup = "MEDIUM"
    } else {
      correlationGroup = "LOW"
    }

    sectors.push({
      sector,
      exposure,
      positionCount: data.count,
      correlationGroup,
    })
  }

  // Sort by exposure descending
  sectors.sort((a, b) => b.exposure - a.exposure)

  return { sectors }
}
