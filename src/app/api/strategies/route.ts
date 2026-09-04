import { NextResponse } from "next/server"
import { IndicatorPool, computeStrategySignal, fetchCandles } from "@/lib/indicator-pool"
import { checkSessionTradingRules, getSessionSizingMultiplier, getSessionQualityScore } from "@/lib/session-manager"
import logger from "@/lib/trading-logger"

const STRATEGY_DEFINITIONS = [
  {
    id: "ma-ribbon",
    name: "Moving Average Ribbon",
    description: "Multiple EMA ribbons to identify trend direction and strength with dynamic crossover signals",
    timeframes: ["M5", "M15", "H1", "H4"],
    parameters: {
      emaPeriods: [10, 20, 30, 50, 100],
      source: "close",
    },
    enabled: true,
  },
  {
    id: "momentum-scalp",
    name: "Momentum Scalping",
    description: "High-frequency momentum detection using RSI and MACD for quick scalping entries",
    timeframes: ["M1", "M5", "M15"],
    parameters: {
      rsiPeriod: 14,
      rsiOverbought: 70,
      rsiOversold: 30,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
    },
    enabled: true,
  },
  {
    id: "pivot-point",
    name: "Pivot Point",
    description: "Classic pivot point levels with support/resistance for intraday range trading",
    timeframes: ["H1", "H4", "D1"],
    parameters: {
      pivotType: "Standard",
      useFibonacci: true,
      fibLevels: [0.382, 0.618, 1.0],
    },
    enabled: true,
  },
  {
    id: "ema-crossover",
    name: "EMA Crossover",
    description: "Fast/slow EMA crossover system with trend confirmation filters",
    timeframes: ["M15", "H1", "H4"],
    parameters: {
      fastEma: 9,
      slowEma: 21,
      signalEma: 5,
      confirmationCandles: 2,
    },
    enabled: true,
  },
  {
    id: "rmi-trend-sync",
    name: "RMI Trend Sync",
    description: "Relative Momentum Index synchronized with multi-timeframe trend alignment",
    timeframes: ["H1", "H4", "D1"],
    parameters: {
      rmiPeriod: 20,
      momentumPeriod: 5,
      overbought: 70,
      oversold: 30,
      trendStrengthThreshold: 0.65,
    },
    enabled: true,
  },
  {
    id: "linear-regression",
    name: "Linear Regression Channels",
    description: "Statistical regression channels with mean reversion signals and breakout detection",
    timeframes: ["H1", "H4", "D1"],
    parameters: {
      lookback: 50,
      deviationMultiplier: 2.0,
      channelType: "Standard",
      meanReversionThreshold: 0.8,
    },
    enabled: true,
  },
  {
    id: "ema-rsi-filter",
    name: "EMA/RSI Filter",
    description: "Combined EMA trend direction with RSI momentum filter for high-probability entries",
    timeframes: ["M15", "H1", "H4"],
    parameters: {
      emaPeriod: 50,
      rsiPeriod: 14,
      rsiEntryZone: [40, 60],
      trendStrengthMin: 0.6,
    },
    enabled: true,
  },
]

const DEFAULT_SYMBOLS = ["BBCA", "BBRI", "TLKM", "ASII"]

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get("symbol") || "BBCA"
    const timeframe = searchParams.get("timeframe") || "H1"

    // Session rules check
    const sessionRules = checkSessionTradingRules()
    const sizingMultiplier = getSessionSizingMultiplier()
    const qualityScore = getSessionQualityScore()

    // Get candle data
    const candles = await fetchCandles(symbol, timeframe, 200)

    if (candles.length < 50) {
      return NextResponse.json({
        success: false,
        error: `Insufficient candle data for ${symbol} ${timeframe}: ${candles.length} bars (need 50+)`,
      }, { status: 400 })
    }

    // Compute signals for all enabled strategies
    const pool = new IndicatorPool()
    const strategiesWithSignals = await Promise.all(
      STRATEGY_DEFINITIONS.map(async (strategy) => {
        const result = computeStrategySignal(strategy.id, candles)

        return {
          ...strategy,
          currentSignal: result.signal,
          confidence: result.confidence,
          strength: result.strength,
          lastUpdated: new Date().toISOString(),
          indicatorCount: result.indicators.length,
          // Per-symbol signals (using same candles for demo)
          symbols: DEFAULT_SYMBOLS.map((sym) => {
            const symSignal = sym === symbol
              ? result
              : { signal: 'NEUTRAL' as const, confidence: 0, strength: 0, indicators: [] }
            return {
              symbol: sym,
              signal: symSignal.signal,
              confidence: symSignal.confidence,
            }
          }),
        }
      })
    )

    const activeStrategies = strategiesWithSignals.filter((s) => s.enabled)
    const buySignals = activeStrategies.filter((s) => s.currentSignal === "BUY").length
    const sellSignals = activeStrategies.filter((s) => s.currentSignal === "SELL").length

    return NextResponse.json({
      success: true,
      data: {
        strategies: strategiesWithSignals,
        summary: {
          total: strategiesWithSignals.length,
          enabled: activeStrategies.length,
          disabled: strategiesWithSignals.length - activeStrategies.length,
          buySignals,
          sellSignals,
          neutral: activeStrategies.length - buySignals - sellSignals,
        },
        session: {
          tradingAllowed: sessionRules.allowed,
          reason: sessionRules.reason,
          sizingMultiplier,
          qualityScore,
        },
        dataInfo: {
          symbol,
          timeframe,
          candleCount: candles.length,
          latestCandle: candles[candles.length - 1]?.close ?? null,
          cacheStats: pool.getCacheStats(),
        },
      },
    })
  } catch (error) {
    logger.error('API', 'Error fetching strategies', { details: String(error) })
    return NextResponse.json(
      { success: false, error: "Failed to fetch strategies" },
      { status: 500 },
    )
  }
}
