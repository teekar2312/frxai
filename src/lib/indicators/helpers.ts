/**
 * HELPER UTILITIES — split from src/lib/indicator-pool.ts (v2.1.0 refactor).
 * Shared validation / math / cache-key helpers used by sibling indicator parts.
 * Cross-part note: previously module-private; exported for sibling parts only
 * (NOT re-exported by the @/lib/indicator-pool facade).
 */

import type { IndicatorName } from './types'

// ============================================
// HELPER UTILITIES
// ============================================

/** Safely check if a number is valid (not NaN, not null, not negative for prices) */
export function isValidPrice(value: number): boolean {
  return typeof value === 'number' && !Number.isNaN(value) && value > 0 && Number.isFinite(value)
}

/** Calculate standard deviation of an array */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const squaredDiffs = values.map((v) => (v - mean) ** 2)
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length
  return Math.sqrt(variance)
}

/** Generate a cache key from indicator name, params, and optional scope */
export function cacheKey(name: IndicatorName, params?: Record<string, number>, scope?: string): string {
  let key = scope ? `${scope}:` : ''
  if (!params || Object.keys(params).length === 0) return `${key}${name}`
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return `${key}${name}:${sorted}`
}
