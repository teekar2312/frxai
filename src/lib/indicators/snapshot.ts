/**
 * INDICATOR SNAPSHOT FOR TRADE — split from src/lib/indicator-pool.ts (v2.1.0 refactor).
 * captureIndicatorSnapshot / parseIndicatorSnapshot.
 */

import logger from '@/lib/trading-logger'
import { IndicatorPool } from './pool'
import type { IndicatorConfig, OHLCVBar } from './types'

// ============================================
// INDICATOR SNAPSHOT FOR TRADE
// ============================================

/**
 * Capture a full indicator snapshot for a trade.
 * Computes all 10 indicators and returns them as a JSON string
 * suitable for storage in Trade.indicatorSnapshot.
 *
 * @param symbol - Stock symbol
 * @param bars - OHLCV bar data
 * @returns JSON string of all indicator values
 */
export function captureIndicatorSnapshot(symbol: string, bars: OHLCVBar[]): string {
  const pool = new IndicatorPool(0) // No caching for snapshot
  const allIndicators: IndicatorConfig[] = [
    { name: 'SMA', params: { period: 20 } },
    { name: 'EMA', params: { period: 20 } },
    { name: 'RSI', params: { period: 14 } },
    { name: 'MACD' },
    { name: 'ATR', params: { period: 14 } },
    { name: 'BOLLINGER', params: { period: 20, stdDev: 2 } },
    { name: 'STOCHASTIC', params: { kPeriod: 14, dPeriod: 3 } },
    { name: 'ADX', params: { period: 14 } },
    { name: 'VWAP' },
    { name: 'PIVOT_POINTS' },
  ]

  const snapshot: Record<string, Record<string, number>> = {
    _meta: {
      symbol: symbol as unknown as number,
      capturedAt: new Date().getTime(),
      barCount: bars.length,
      lastPrice: bars.length > 0 ? bars[bars.length - 1].close : 0,
    },
  }

  for (const config of allIndicators) {
    const result = pool.computeSingle(config.name, bars, config.params)
    if (result.calculated) {
      snapshot[config.name] = { ...result.values }
    }
  }

  const json = JSON.stringify(snapshot)
  logger.debug('INDICATOR_POOL', `Captured indicator snapshot for ${symbol}`, {
    source: 'IndicatorPool',
    symbol,
    details: `indicators=${Object.keys(snapshot).length - 1}, size=${json.length}bytes`,
  })

  return json
}

/**
 * Parse an indicator snapshot JSON string back into a structured object.
 *
 * @param json - JSON string from captureIndicatorSnapshot
 * @returns Record of indicator name to values
 */
export function parseIndicatorSnapshot(json: string): Record<string, Record<string, number>> {
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) {
      logger.warn('INDICATOR_POOL', 'Invalid indicator snapshot JSON: not an object', { source: 'IndicatorPool' })
      return {}
    }
    return parsed as Record<string, Record<string, number>>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('INDICATOR_POOL', 'Failed to parse indicator snapshot JSON', {
      source: 'IndicatorPool',
      details: message,
    })
    return {}
  }
}
