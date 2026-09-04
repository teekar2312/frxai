/**
 * CANDLE DATA MANAGEMENT FUNCTIONS — split from src/lib/indicator-pool.ts (v2.1.0 refactor).
 * DB fetch/store of OHLCV candles, mock candle generation, timeframe helper.
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import type { OHLCVBar } from './types'

// ============================================
// CANDLE DATA MANAGEMENT FUNCTIONS
// ============================================

/**
 * Fetch candle data from the database, sorted ASC by openTime.
 * @param symbol - Stock symbol (e.g., 'BBRI')
 * @param timeframe - Timeframe string (e.g., 'M5', 'H1')
 * @param limit - Maximum number of candles to fetch (default 200)
 */
export async function fetchCandles(
  symbol: string,
  timeframe: string,
  limit: number = 200
): Promise<OHLCVBar[]> {
  try {
    const rows = await db.candleData.findMany({
      where: { symbol, timeframe },
      orderBy: { openTime: 'desc' },
      take: limit,
    })

    // Reverse to ASC order (oldest first) as required by indicators
    const bars: OHLCVBar[] = rows.reverse().map((row) => ({
      openTime: row.openTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }))

    logger.debug('INDICATOR_POOL', `Fetched ${bars.length} candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: `timeframe=${timeframe}, limit=${limit}, returned=${bars.length}`,
    })

    return bars
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('INDICATOR_POOL', `Failed to fetch candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: message,
    })
    return []
  }
}

/**
 * Store (upsert) candle data into the database.
 * Uses the unique constraint [symbol, timeframe, openTime] for upsert.
 *
 * @param symbol - Stock symbol
 * @param timeframe - Timeframe string
 * @param bars - Array of OHLCV bars to store
 * @returns Number of bars stored
 */
export async function storeCandles(
  symbol: string,
  timeframe: string,
  bars: OHLCVBar[]
): Promise<number> {
  if (!bars || bars.length === 0) return 0

  let stored = 0

  try {
    // Upsert in batches to avoid overwhelming SQLite
    const BATCH_SIZE = 50
    for (let i = 0; i < bars.length; i += BATCH_SIZE) {
      const batch = bars.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map((bar) =>
          db.candleData.upsert({
            where: {
              symbol_timeframe_openTime: {
                symbol,
                timeframe,
                openTime: bar.openTime,
              },
            },
            create: {
              symbol,
              timeframe,
              openTime: bar.openTime,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
            update: {
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
          })
        )
      )

      stored += batch.length
    }

    logger.info('INDICATOR_POOL', `Stored ${stored} candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: `timeframe=${timeframe}, batched=${Math.ceil(bars.length / BATCH_SIZE)}`,
    })

    return stored
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('INDICATOR_POOL', `Failed to store candles for ${symbol} ${timeframe}`, {
      source: 'IndicatorPool',
      symbol,
      details: message,
    })
    return stored
  }
}

/**
 * Generate realistic mock OHLCV candle data for testing.
 * Uses a random walk with realistic volatility — no Math.sin.
 * Base price is taken from SYMBOL_MAP if available, otherwise defaults to 5000.
 *
 * @param symbol - Stock symbol
 * @param timeframe - Timeframe string
 * @param count - Number of candles to generate (default 200)
 */
export function generateMockCandles(
  symbol: string,
  timeframe: string,
  count: number = 200
): OHLCVBar[] {
  // Determine base price from SYMBOL_MAP or use default
  // Default base price for unknown symbols (known symbols use knownPrices below)
  const basePrice = 5000

  // For well-known stocks, use approximate real-world base prices
  const knownPrices: Record<string, number> = {
    BBRI: 4600,
    BBCA: 9800,
    BMRI: 6200,
    BBNI: 4800,
    BRIS: 2600,
    TLKM: 3900,
    ASII: 5100,
    UNVR: 2600,
    GOTO: 70,
    ANTM: 1600,
    ADRO: 2900,
    PGAS: 1600,
  }

  const price = knownPrices[symbol] ?? basePrice
  const volatility = price * 0.015 // 1.5% per-bar volatility for IDX stocks
  const tfMs = getTimeframeMs(timeframe)
  const now = new Date()

  const bars: OHLCVBar[] = []
  let currentPrice = price

  // Seeded-ish random using multiple Math.random calls for variety
  for (let i = 0; i < count; i++) {
    const openTime = new Date(now.getTime() - (count - i) * tfMs)

    // Random walk components
    const trend = (Math.random() - 0.495) * volatility * 0.3 // Slight upward bias
    const noise = (Math.random() - 0.5) * volatility * 2

    // Gap from previous close
    const gap = (Math.random() - 0.5) * volatility * 0.1
    const open = currentPrice + gap

    // Body direction
    const direction = Math.random() > 0.48 ? 1 : -1 // Slight bullish bias
    const bodySize = Math.random() * volatility * 0.8
    const close = open + direction * bodySize + trend

    // High and Low
    const upperWick = Math.random() * volatility * 0.5
    const lowerWick = Math.random() * volatility * 0.5
    const high = Math.max(open, close) + upperWick
    const low = Math.min(open, close) - lowerWick

    // Ensure positive prices
    const finalOpen = Math.max(open, 1)
    const finalHigh = Math.max(high, finalOpen, 1)
    const finalLow = Math.max(low, 1)
    const finalClose = Math.max(close, 1)

    // Realistic volume: 100k to 10M with some variation
    const baseVolume = 500_000
    const volumeVariation = Math.random() * 9_500_000
    const volume = Math.floor(baseVolume + volumeVariation)

    bars.push({
      openTime,
      open: parseFloat(finalOpen.toFixed(2)),
      high: parseFloat(finalHigh.toFixed(2)),
      low: parseFloat(finalLow.toFixed(2)),
      close: parseFloat(finalClose.toFixed(2)),
      volume,
    })

    currentPrice = finalClose
  }

  logger.debug('INDICATOR_POOL', `Generated ${count} mock candles for ${symbol} ${timeframe}`, {
    source: 'IndicatorPool',
    symbol,
    details: `timeframe=${timeframe}, basePrice=${price}`,
  })

  return bars
}

/**
 * Convert a timeframe string to milliseconds.
 * Supported: M1, M5, M15, H1, H4, D1
 */
export function getTimeframeMs(timeframe: string): number {
  const map: Record<string, number> = {
    M1: 60_000,
    M5: 300_000,
    M15: 900_000,
    H1: 3_600_000,
    H4: 14_400_000,
    D1: 86_400_000,
  }
  const ms = map[timeframe.toUpperCase()]
  if (ms === undefined) {
    logger.warn('INDICATOR_POOL', `Unknown timeframe: ${timeframe}, defaulting to M5`, { source: 'IndicatorPool' })
    return 300_000
  }
  return ms
}
