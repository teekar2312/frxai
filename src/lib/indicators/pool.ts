/**
 * INDICATOR POOL CLASS — split from src/lib/indicator-pool.ts (v2.1.0 refactor).
 * IndicatorPool — caching, dependency-ordered indicator computation engine.
 */

import logger from '@/lib/trading-logger'
import { cacheKey, isValidPrice } from './helpers'
import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_CACHE_ENTRIES,
  type DependencyGraph,
  type IndicatorConfig,
  type IndicatorName,
  type IndicatorPoolResult,
  type IndicatorResult,
  type OHLCVSeries,
} from './types'
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateStochastic,
  calculateADX,
  calculateVWAP,
  calculatePivotPoints,
} from './calculations'

// ============================================
// INDICATOR POOL CLASS
// ============================================

/**
 * IndicatorPool — Caching, dependency-ordered indicator computation engine.
 *
 * Maintains an internal cache with configurable TTL, tracks cache hit/miss stats,
 * and resolves computation order via a dependency graph.
 */
export class IndicatorPool {
  private cache: Map<string, { result: IndicatorResult; computedAt: Date }> = new Map()
  private cacheTtlMs: number
  private maxCacheEntries: number
  private scope: string
  private hits = 0
  private misses = 0

  /** Dependency graph: which indicators depend on which sub-indicators */
  private static readonly DEPENDENCIES: DependencyGraph = {
    SMA: [],
    EMA: [],
    RSI: [],
    MACD: ['EMA'],
    ATR: [],
    BOLLINGER: ['SMA'],
    STOCHASTIC: [],
    ADX: [],
    VWAP: [],
    PIVOT_POINTS: [],
  }

  constructor(cacheTtlMs: number = DEFAULT_CACHE_TTL_MS, scope: string = 'global') {
    this.cacheTtlMs = cacheTtlMs
    this.maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES
    this.scope = scope
    logger.info('INDICATOR_POOL', 'IndicatorPool initialized', { source: 'IndicatorPool', details: `cacheTtl=${cacheTtlMs}ms, scope=${scope}` })
  }

  /** Returns the dependency graph for all indicators */
  getDependencyGraph(): DependencyGraph {
    return { ...IndicatorPool.DEPENDENCIES }
  }

  /**
   * Compute multiple indicators in dependency order with caching.
   * @param indicators - Array of indicator configs to compute
   * @param bars - OHLCV bar data
   */
  async compute(
    indicators: IndicatorConfig[],
    bars: OHLCVSeries
  ): Promise<IndicatorPoolResult> {
    const results = new Map<IndicatorName, IndicatorResult>()
    const startHits = this.hits
    const startMisses = this.misses

    // Topological sort based on dependencies
    const computed = new Set<string>()
    const queue = [...indicators]

    // Simple topological resolution: compute dependencies first
    const ordered: IndicatorConfig[] = []
    const seen = new Set<string>()

    const resolveOrder = (config: IndicatorConfig) => {
      const key = config.name
      if (seen.has(key)) return
      seen.add(key)

      // Resolve dependencies first
      const deps = IndicatorPool.DEPENDENCIES[config.name] || []
      for (const dep of deps) {
        // Only add dep if it's also in the requested set
        if (indicators.some((i) => i.name === dep)) {
          const depConfig = indicators.find((i) => i.name === dep)
          if (depConfig) resolveOrder(depConfig)
        }
      }

      ordered.push(config)
    }

    for (const config of queue) {
      resolveOrder(config)
    }

    // Compute in order
    for (const config of ordered) {
      const key = cacheKey(config.name, config.params, this.scope)

      // Check cache
      const cached = this.cache.get(key)
      if (cached) {
        const age = Date.now() - cached.computedAt.getTime()
        if (age < this.cacheTtlMs) {
          results.set(config.name, cached.result)
          this.hits++
          computed.add(key)
          continue
        }
        // Expired — remove
        this.cache.delete(key)
      }

      // Cache miss — compute
      this.misses++
      const result = this.computeSingle(config.name, bars, config.params)
      this.cache.set(key, { result, computedAt: new Date() })

      // Evict oldest entries if over limit
      while (this.cache.size > this.maxCacheEntries) {
        const firstKey = this.cache.keys().next().value
        if (firstKey) this.cache.delete(firstKey)
      }
      results.set(config.name, result)
      computed.add(key)
    }

    logger.debug('INDICATOR_POOL', 'IndicatorPool.compute completed', {
      source: 'IndicatorPool',
      details: `requested=${indicators.length}, computed=${ordered.length}, hits=${this.hits - startHits}, misses=${this.misses - startMisses}`,
    })

    return {
      results,
      computedAt: new Date(),
      cacheHits: this.hits - startHits,
      cacheMisses: this.misses - startMisses,
    }
  }

  /**
   * Compute a single indicator without caching.
   * @param name - Indicator name
   * @param bars - OHLCV bar data
   * @param params - Optional parameters
   */
  computeSingle(name: IndicatorName, bars: OHLCVSeries, params?: Record<string, number>): IndicatorResult {
    const timestamp = new Date()
    const closes = bars.map((b) => b.close)

    try {
      switch (name) {
        case 'SMA': {
          const period = params?.period ?? 20
          const value = calculateSMA(closes, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for SMA' }
          }
          return { name, values: { sma: value, period }, timestamp, calculated: true }
        }

        case 'EMA': {
          const period = params?.period ?? 20
          const value = calculateEMA(closes, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for EMA' }
          }
          return { name, values: { ema: value, period }, timestamp, calculated: true }
        }

        case 'RSI': {
          const period = params?.period ?? 14
          const value = calculateRSI(closes, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for RSI' }
          }
          return { name, values: { rsi: value, period }, timestamp, calculated: true }
        }

        case 'MACD': {
          const fastPeriod = params?.fastPeriod ?? 12
          const slowPeriod = params?.slowPeriod ?? 26
          const signalPeriod = params?.signalPeriod ?? 9
          const { macdLine, signalLine, histogram } = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod)
          if (macdLine === null || signalLine === null || histogram === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for MACD' }
          }
          return {
            name,
            values: { macdLine, signalLine, histogram, fastPeriod, slowPeriod, signalPeriod },
            timestamp,
            calculated: true,
          }
        }

        case 'ATR': {
          const period = params?.period ?? 14
          const value = calculateATR(bars, period)
          if (value === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for ATR' }
          }
          return { name, values: { atr: value, period }, timestamp, calculated: true }
        }

        case 'BOLLINGER': {
          const period = params?.period ?? 20
          const stdDev = params?.stdDev ?? 2
          const { upper, middle, lower, bandwidth, percentB } = calculateBollingerBands(closes, period, stdDev)
          if (upper === null || middle === null || lower === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for Bollinger Bands' }
          }
          return {
            name,
            values: {
              upper,
              middle,
              lower,
              bandwidth: bandwidth ?? 0,
              percentB: percentB ?? 0,
              period,
              stdDev,
            },
            timestamp,
            calculated: true,
          }
        }

        case 'STOCHASTIC': {
          const kPeriod = params?.kPeriod ?? 14
          const dPeriod = params?.dPeriod ?? 3
          const { k, d } = calculateStochastic(bars, kPeriod, dPeriod)
          if (k === null || d === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for Stochastic' }
          }
          return { name, values: { k, d, kPeriod, dPeriod }, timestamp, calculated: true }
        }

        case 'ADX': {
          const period = params?.period ?? 14
          const { adx, plusDi, minusDi } = calculateADX(bars, period)
          if (adx === null || plusDi === null || minusDi === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for ADX' }
          }
          return { name, values: { adx, plusDi, minusDi, period }, timestamp, calculated: true }
        }

        case 'VWAP': {
          const { vwap, cumulativeVolume } = calculateVWAP(bars)
          if (vwap === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for VWAP' }
          }
          return { name, values: { vwap, cumulativeVolume }, timestamp, calculated: true }
        }

        case 'PIVOT_POINTS': {
          const numPeriods = params?.numPeriods ?? 1
          const fibonacci = params?.fibonacci === 1
          const pp = calculatePivotPoints(bars, numPeriods, fibonacci)
          if (pp === null) {
            return { name, values: {}, timestamp, calculated: false, error: 'Insufficient data for Pivot Points' }
          }
          return {
            name,
            values: { pivot: pp.pivot, r1: pp.r1, r2: pp.r2, r3: pp.r3, s1: pp.s1, s2: pp.s2, s3: pp.s3 },
            timestamp,
            calculated: true,
          }
        }

        default: {
          const _exhaustive: never = name
          return { name: _exhaustive, values: {}, timestamp, calculated: false, error: `Unknown indicator: ${String(name)}` }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('INDICATOR_POOL', `Indicator computation failed: ${name}`, {
        source: 'IndicatorPool',
        details: message,
      })
      return { name, values: {}, timestamp, calculated: false, error: message }
    }
  }

  /** Clear all cached indicator results */
  clearCache(): void {
    const size = this.cache.size
    this.cache.clear()
    logger.info('INDICATOR_POOL', 'IndicatorPool cache cleared', { source: 'IndicatorPool', details: `removed=${size} entries` })
  }

  /** Get cache statistics */
  getCacheStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    }
  }

  /**
   * Validate input bar data for indicator computation.
   * Checks: bars sorted ASC by openTime, sufficient data, no NaN/null/negative prices.
   */
  validateInput(bars: OHLCVSeries, minBars: number): { valid: boolean; error?: string } {
    if (!bars || bars.length === 0) {
      return { valid: false, error: 'No bar data provided' }
    }

    if (bars.length < minBars) {
      return { valid: false, error: `Insufficient bars: need ${minBars}, got ${bars.length}` }
    }

    // Check ascending sort by openTime
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].openTime.getTime() <= bars[i - 1].openTime.getTime()) {
        return {
          valid: false,
          error: `Bars not sorted ASC at index ${i}: bars[${i - 1}].openTime=${bars[i - 1].openTime.toISOString()} >= bars[${i}].openTime=${bars[i].openTime.toISOString()}`,
        }
      }
    }

    // Check for valid price data
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]
      if (!isValidPrice(bar.open)) {
        return { valid: false, error: `Invalid open price at bar ${i}: ${bar.open}` }
      }
      if (!isValidPrice(bar.high)) {
        return { valid: false, error: `Invalid high price at bar ${i}: ${bar.high}` }
      }
      if (!isValidPrice(bar.low)) {
        return { valid: false, error: `Invalid low price at bar ${i}: ${bar.low}` }
      }
      if (!isValidPrice(bar.close)) {
        return { valid: false, error: `Invalid close price at bar ${i}: ${bar.close}` }
      }
      if (bar.volume < 0) {
        return { valid: false, error: `Invalid volume at bar ${i}: ${bar.volume}` }
      }
    }

    return { valid: true }
  }
}
