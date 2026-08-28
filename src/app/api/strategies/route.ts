import { NextResponse } from "next/server"

// Generate a pseudo-random but deterministic signal based on strategy name and current time
function getSignalForStrategy(strategyName: string): string {
  const seed = strategyName.length + new Date().getUTCHours() + new Date().getUTCMinutes()
  const r = Math.sin(seed) * 10000
  const val = r - Math.floor(r)
  if (val < 0.3) return "BUY"
  if (val < 0.6) return "SELL"
  return "NEUTRAL"
}

const STRATEGIES = [
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
    enabled: false,
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
    enabled: false,
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

export async function GET() {
  try {
    const strategiesWithSignals = STRATEGIES.map((strategy) => {
      const signal = getSignalForStrategy(strategy.id)
      const confidence = Math.round((55 + Math.random() * 40) * 100) / 100
      const strength = Math.round((0.3 + Math.random() * 0.7) * 100) / 100

      return {
        ...strategy,
        currentSignal: signal,
        confidence,
        strength,
        lastUpdated: new Date().toISOString(),
        // Generate mock per-symbol signals
        symbols: [
          { symbol: "BBCA", signal, confidence: Math.round((confidence - 5 + Math.random() * 10) * 100) / 100 },
          { symbol: "BBRI", signal: getSignalForStrategy(strategy.id + "BBRI"), confidence: Math.round((50 + Math.random() * 45) * 100) / 100 },
          { symbol: "TLKM", signal: getSignalForStrategy(strategy.id + "TLKM"), confidence: Math.round((50 + Math.random() * 45) * 100) / 100 },
          { symbol: "ASII", signal: getSignalForStrategy(strategy.id + "ASII"), confidence: Math.round((50 + Math.random() * 45) * 100) / 100 },
        ],
      }
    })

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
      },
    })
  } catch (error) {
    console.error("Error fetching strategies:", error)
    return NextResponse.json(
      { success: false, error: "Failed to fetch strategies" },
      { status: 500 }
    )
  }
}
