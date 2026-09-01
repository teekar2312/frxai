import { NextRequest, NextResponse } from "next/server"
import { IndicatorPool, fetchCandles, generateMockCandles, storeCandles, captureIndicatorSnapshot, parseIndicatorSnapshot, DEFAULT_CACHE_TTL_MS } from "@/lib/indicator-pool"
import type { IndicatorName } from "@/lib/indicator-pool"

const ALL_INDICATORS: IndicatorName[] = [
  'SMA', 'EMA', 'RSI', 'MACD', 'ATR',
  'BOLLINGER', 'STOCHASTIC', 'ADX', 'VWAP', 'PIVOT_POINTS',
]

// Module-level pool cache keyed by symbol:timeframe to persist across requests
const poolCache = new Map<string, IndicatorPool>()
const MAX_POOLS = 50

function getPool(symbol: string, timeframe: string): IndicatorPool {
  const key = `${symbol}:${timeframe}`
  let pool = poolCache.get(key)
  if (!pool) {
    pool = new IndicatorPool(DEFAULT_CACHE_TTL_MS, key)
    poolCache.set(key, pool)
    // Evict oldest if over limit
    while (poolCache.size > MAX_POOLS) {
      const firstKey = poolCache.keys().next().value
      if (firstKey) poolCache.delete(firstKey)
    }
  }
  return pool
}

/**
 * GET /api/indicators/compute?symbol=BBCA&timeframe=H1&indicators=RSI,MACD,ATR&refresh=true
 * Compute specific indicators for a symbol.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get('symbol') || 'BBCA'
    const timeframe = searchParams.get('timeframe') || 'H1'
    const indicatorsParam = searchParams.get('indicators')
    const refresh = searchParams.get('refresh') === 'true'

    let candles = await fetchCandles(symbol, timeframe, 200)

    if (candles.length < 50 || refresh) {
      const mockCandles = generateMockCandles(symbol, timeframe, 200)
      if (candles.length < 50) {
        await storeCandles(symbol, timeframe, mockCandles)
      }
      candles = mockCandles
    }

    if (candles.length < 30) {
      return NextResponse.json({
        success: false,
        error: 'Insufficient data. Need at least 30 candles.',
      }, { status: 400 })
    }

    // Parse requested indicators
    const requestedIndicators: IndicatorName[] = indicatorsParam
      ? indicatorsParam.split(',').filter(i => ALL_INDICATORS.includes(i as IndicatorName)) as IndicatorName[]
      : ALL_INDICATORS

    const pool = getPool(symbol, timeframe)
    const result = await pool.compute(
      requestedIndicators.map(name => ({ name })),
      candles,
    )

    // Convert Map to plain object for JSON
    const indicatorResults: Record<string, unknown> = {}
    for (const [key, val] of result.results) {
      indicatorResults[key] = {
        calculated: val.calculated,
        error: val.error,
        values: val.values,
        timestamp: val.timestamp,
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        symbol,
        timeframe,
        candleCount: candles.length,
        latestClose: candles[candles.length - 1]?.close,
        indicators: indicatorResults,
        metadata: {
          computedAt: result.computedAt,
          cacheHits: result.cacheHits,
          cacheMisses: result.cacheMisses,
        },
      },
    })
  } catch (error) {
    console.error('Error computing indicators:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to compute indicators' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/indicators/compute
 * Compute a snapshot of all indicators for a symbol (for trade entry).
 * Body: { symbol: string, timeframe?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { symbol, timeframe = 'H1' } = body

    let candles = await fetchCandles(symbol, timeframe, 200)
    if (candles.length < 50) {
      candles = generateMockCandles(symbol, timeframe, 200)
      await storeCandles(symbol, timeframe, candles)
    }

    const snapshot = captureIndicatorSnapshot(symbol, candles)
    const parsed = parseIndicatorSnapshot(snapshot)

    return NextResponse.json({
      success: true,
      data: {
        symbol,
        timeframe,
        snapshot,
        parsed,
        indicatorCount: Object.keys(parsed).length,
      },
    })
  } catch (error) {
    console.error('Error capturing indicator snapshot:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to capture indicator snapshot' },
      { status: 500 },
    )
  }
}