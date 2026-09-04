/**
 * Shared display formatters (extracted from per-component duplicates:
 * AccountSummary, EquityChart, RiskManagement).
 */

/**
 * Format a USD currency amount. Degrades to '-' for null/undefined/NaN —
 * the containment guard that fixed the RiskManagement crash class (b09952f:
 * "sessionRiskUsedPct.toFixed" on undefined) at the display layer.
 */
export function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}
