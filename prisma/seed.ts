/**
 * FINEX Indonesia Trading System - Seed Data Script
 * ===================================================
 * Seeds realistic demo data for the trading dashboard.
 * Run via: bun run prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

// ---- Helpers ----

function getWibHour(): number {
  const wibStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    hour: 'numeric',
    hour12: false,
  }).format(new Date())
  return parseInt(wibStr, 10)
}

function getWibMinute(): number {
  const wibStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    minute: 'numeric',
  }).format(new Date())
  return parseInt(wibStr, 10)
}

function getWibTradingPhase(): string {
  const h = getWibHour()
  const m = getWibMinute()
  const t = h + m / 60
  // Pre-market 09:00-09:05, Session 1 09:05-11:30, Lunch 11:30-13:00, Session 2 13:00-16:15, Post-close 16:15-17:00
  if (t >= 9.0 && t < 9.083) return 'PRE_OPEN'
  if ((t >= 9.083 && t < 11.5) || (t >= 13.0 && t < 16.25)) return 'OPEN'
  if (t >= 11.5 && t < 13.0) return 'CLOSED' // lunch
  if (t >= 16.25 && t < 17.0) return 'POST_CLOSE'
  return 'AFTER_HOURS'
}

function isWibMarketOpen(): boolean {
  const phase = getWibTradingPhase()
  return phase === 'OPEN' || phase === 'PRE_OPEN'
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000)
}

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000)
}

async function main() {
  console.log('Seeding FINEX demo data...')

  // ============================================
  // 1. MT5 CONNECTION STATE
  // ============================================
  await db.mt5ConnectionState.deleteMany({})
  const mt5State = await db.mt5ConnectionState.create({
    data: {
      status: 'CONNECTED',
      broker: 'FINEX Indonesia',
      server: 'FINEX-Real5',
      accountNumber: '8812345',
      accountType: 'Real',
      latencyMs: 45,
      uptimeSeconds: 14500,
      reconnectCount: 1,
      lastHeartbeat: new Date(),
      lastConnectedAt: hoursAgo(4),
      connectedAt: hoursAgo(4),
      consecutiveHeartbeatFailures: 0,
      isMarketOpen: isWibMarketOpen(),
      tradingPhase: getWibTradingPhase(),
      circuitState: 'CLOSED',
      circuitFailureCount: 0,
      connectionQuality: 92.0,
    },
  })
  console.log(`  ✓ MT5 Connection State: ${mt5State.status}`)

  // ============================================
  // 2. RISK CONFIG (upsert)
  // ============================================
  await db.riskConfig.upsert({
    where: { name: 'default' },
    update: {},
    create: {
      name: 'default',
      maxRiskPerTrade: 0.5,
      maxDailyLoss: 2.0,
      maxWeeklyLoss: 5.0,
      maxMonthlyLoss: 10.0,
      maxMarginUsage: 50.0,
      maxDrawdown: 10.0,
      maxOpenPositions: 200,
      maxLotPerTrade: 50.0,
      maxLotPerSymbol: 100.0,
      marginCallLevel: 50.0,
      stopOutLevel: 20.0,
      maxCorrelatedExposure: 15.0,
      cooldownAfterLossMinutes: 15,
      proactiveMcLevel70: true,
      proactiveMcLevel60: true,
      maxPortfolioRiskPct: 5.0,
      maxLeveragePerTrade: 10.0,
      maxSingleStockPct: 5.0,
      maxSectorPct: 15.0,
      slippageTolerancePips: 3.0,
      reserveCapitalPct: 20.0,
      gapRiskMaxPct: 3.0,
      gapRiskAlertPct: 2.0,
      volatilityRegimeEnabled: true,
      highVolRiskReduction: 0.5,
      lowVolRiskReduction: 0.8,
      maxConsecutiveLosses: 5,
      consecutiveLossCooldownMinutes: 60,
      equityCurveEnabled: true,
      equityCurveMaPeriod: 20,
      sessionRiskLimitPct: 1.0,
    },
  })
  console.log('  ✓ Risk Config: default (upserted)')

  // ============================================
  // 3. OPEN TRADES (8 trades)
  // ============================================
  await db.trade.deleteMany({ where: { status: 'OPEN' } })

  const openTrades = [
    {
      symbol: 'BBCA', direction: 'BUY', lotSize: 0.05,
      entryPrice: 9850, currentPrice: 9920, sl: 9700, tp: 10200,
      strategy: 'EMA Crossover', sector: 'Banking', pnl: 350,
      leverage: 25, commission: 0.05, slippage: 0.5,
      margin: (9920 * 0.05 * 100000) / 25,
      pnlPercent: (350 / ((9850 * 0.05 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (9850 - 9700) * 0.05 * 100,
      openTime: hoursAgo(3),
    },
    {
      symbol: 'BBRI', direction: 'SELL', lotSize: 0.10,
      entryPrice: 4750, currentPrice: 4680, sl: 4850, tp: 4500,
      strategy: 'RMI Trend Sync', sector: 'Banking', pnl: 700,
      leverage: 25, commission: 0.10, slippage: 1.0,
      margin: (4680 * 0.10 * 100000) / 25,
      pnlPercent: (700 / ((4750 * 0.10 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (4850 - 4750) * 0.10 * 100,
      openTime: hoursAgo(2.5),
    },
    {
      symbol: 'TLKM', direction: 'BUY', lotSize: 0.03,
      entryPrice: 3450, currentPrice: 3420, sl: 3350, tp: 3600,
      strategy: 'MA Ribbon', sector: 'Telecommunication', pnl: -90,
      leverage: 25, commission: 0.03, slippage: 0.3,
      margin: (3420 * 0.03 * 100000) / 25,
      pnlPercent: (-90 / ((3450 * 0.03 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (3450 - 3350) * 0.03 * 100,
      openTime: hoursAgo(2),
    },
    {
      symbol: 'ASII', direction: 'BUY', lotSize: 0.08,
      entryPrice: 5200, currentPrice: 5350, sl: 5050, tp: 5600,
      strategy: 'Pivot Point', sector: 'Conglomerate', pnl: 1200,
      leverage: 25, commission: 0.08, slippage: 0.8,
      margin: (5350 * 0.08 * 100000) / 25,
      pnlPercent: (1200 / ((5200 * 0.08 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (5200 - 5050) * 0.08 * 100,
      openTime: hoursAgo(4),
    },
    {
      symbol: 'ANTM', direction: 'SELL', lotSize: 0.04,
      entryPrice: 1650, currentPrice: 1620, sl: 1720, tp: 1550,
      strategy: 'Linear Regression', sector: 'Mining', pnl: 120,
      leverage: 25, commission: 0.04, slippage: 0.4,
      margin: (1620 * 0.04 * 100000) / 25,
      pnlPercent: (120 / ((1650 * 0.04 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (1720 - 1650) * 0.04 * 100,
      openTime: hoursAgo(1.5),
    },
    {
      symbol: 'UNVR', direction: 'BUY', lotSize: 0.02,
      entryPrice: 28500, currentPrice: 28300, sl: 27800, tp: 29500,
      strategy: 'EMA/RSI Filter', sector: 'Consumer Goods', pnl: -400,
      leverage: 25, commission: 0.02, slippage: 2.0,
      margin: (28300 * 0.02 * 100000) / 25,
      pnlPercent: (-400 / ((28500 * 0.02 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (28500 - 27800) * 0.02 * 100,
      openTime: hoursAgo(1),
    },
    {
      symbol: 'GOTO', direction: 'SELL', lotSize: 0.15,
      entryPrice: 82, currentPrice: 85, sl: 90, tp: 72,
      strategy: 'Momentum Scalping', sector: 'Technology', pnl: -450,
      leverage: 25, commission: 0.15, slippage: 0.15,
      margin: (85 * 0.15 * 100000) / 25,
      pnlPercent: (-450 / ((82 * 0.15 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (90 - 82) * 0.15 * 100,
      openTime: minutesAgo(45),
    },
    {
      symbol: 'PGAS', direction: 'BUY', lotSize: 0.06,
      entryPrice: 2350, currentPrice: 2420, sl: 2250, tp: 2550,
      strategy: 'EMA Crossover', sector: 'Energy', pnl: 420,
      leverage: 25, commission: 0.06, slippage: 0.6,
      margin: (2420 * 0.06 * 100000) / 25,
      pnlPercent: (420 / ((2350 * 0.06 * 100000) / 25)) * 100,
      sizingMethod: 'FIXED_FRACTIONAL',
      riskAmount: (2350 - 2250) * 0.06 * 100,
      openTime: hoursAgo(3.5),
    },
  ]

  const createdTrades = []
  for (const t of openTrades) {
    const trade = await db.trade.create({ data: { ...t, status: 'OPEN' } })
    createdTrades.push(trade)
  }
  console.log(`  ✓ Open Trades: ${createdTrades.length}`)

  // ============================================
  // 4. CLOSED TRADES (15 trades, 9 wins / 6 losses)
  // ============================================
  await db.trade.deleteMany({ where: { status: 'CLOSED' } })

  const closedTradeSpecs: Array<{
    symbol: string; direction: string; lotSize: number
    entryPrice: number; closePrice: number; pnl: number
    strategy: string; sector: string; reason: string
    daysOffset: number; hoursOffset?: number
    sl?: number; tp?: number; trailingStop?: boolean
  }> = [
    // Today wins (4)
    { symbol: 'BBCA', direction: 'BUY', lotSize: 0.05, entryPrice: 9800, closePrice: 9900, pnl: 500, strategy: 'EMA Crossover', sector: 'Banking', reason: 'TP', daysOffset: 0, hoursOffset: 3, sl: 9650, tp: 9900 },
    { symbol: 'BMRI', direction: 'BUY', lotSize: 0.08, entryPrice: 6200, closePrice: 6350, pnl: 1200, strategy: 'Pivot Point', sector: 'Banking', reason: 'TP', daysOffset: 0, hoursOffset: 2, sl: 6050, tp: 6350 },
    { symbol: 'TLKM', direction: 'SELL', lotSize: 0.04, entryPrice: 3480, closePrice: 3400, pnl: 320, strategy: 'RMI Trend Sync', sector: 'Telecommunication', reason: 'Trailing Stop', daysOffset: 0, hoursOffset: 1.5, trailingStop: true, sl: 3550, tp: 3300 },
    { symbol: 'ANTM', direction: 'BUY', lotSize: 0.06, entryPrice: 1600, closePrice: 1680, pnl: 480, strategy: 'Linear Regression', sector: 'Mining', reason: 'TP', daysOffset: 0, hoursOffset: 1, sl: 1550, tp: 1680 },
    // Today losses (2)
    { symbol: 'GOTO', direction: 'BUY', lotSize: 0.10, entryPrice: 84, closePrice: 80, pnl: -400, strategy: 'Momentum Scalping', sector: 'Technology', reason: 'SL', daysOffset: 0, hoursOffset: 0.5, sl: 80, tp: 92 },
    { symbol: 'UNVR', direction: 'SELL', lotSize: 0.02, entryPrice: 28600, closePrice: 28800, pnl: -40, strategy: 'EMA/RSI Filter', sector: 'Consumer Goods', reason: 'Manual', daysOffset: 0, hoursOffset: 0.3, sl: 29000, tp: 28000 },
    // Yesterday wins (3)
    { symbol: 'BBRI', direction: 'BUY', lotSize: 0.12, entryPrice: 4700, closePrice: 4800, pnl: 1200, strategy: 'MA Ribbon', sector: 'Banking', reason: 'TP', daysOffset: 1, hoursOffset: 4, sl: 4600, tp: 4800 },
    { symbol: 'ASII', direction: 'BUY', lotSize: 0.06, entryPrice: 5100, closePrice: 5250, pnl: 900, strategy: 'EMA Crossover', sector: 'Conglomerate', reason: 'TP', daysOffset: 1, hoursOffset: 3, sl: 5000, tp: 5250 },
    { symbol: 'PGAS', direction: 'SELL', lotSize: 0.05, entryPrice: 2400, closePrice: 2320, pnl: 200, strategy: 'Pivot Point', sector: 'Energy', reason: 'TP', daysOffset: 1, hoursOffset: 2, sl: 2480, tp: 2300 },
    // Yesterday losses (2)
    { symbol: 'EXCL', direction: 'BUY', lotSize: 0.04, entryPrice: 2800, closePrice: 2720, pnl: -320, strategy: 'RMI Trend Sync', sector: 'Telecommunication', reason: 'SL', daysOffset: 1, hoursOffset: 1.5, sl: 2720, tp: 2950 },
    { symbol: 'ICBP', direction: 'SELL', lotSize: 0.03, entryPrice: 10200, closePrice: 10400, pnl: -60, strategy: 'Linear Regression', sector: 'Consumer Goods', reason: 'Manual', daysOffset: 1, hoursOffset: 0.5, sl: 10500, tp: 9900 },
    // 2 days ago wins (2)
    { symbol: 'BRIS', direction: 'BUY', lotSize: 0.07, entryPrice: 5100, closePrice: 5200, pnl: 700, strategy: 'EMA Crossover', sector: 'Banking', reason: 'TP', daysOffset: 2, hoursOffset: 5, sl: 5000, tp: 5200 },
    { symbol: 'ANTM', direction: 'SELL', lotSize: 0.05, entryPrice: 1700, closePrice: 1620, pnl: 200, strategy: 'Momentum Scalping', sector: 'Mining', reason: 'Trailing Stop', daysOffset: 2, hoursOffset: 3, trailingStop: true, sl: 1760, tp: 1580 },
    // 2 days ago losses (2)
    { symbol: 'TLKM', direction: 'BUY', lotSize: 0.03, entryPrice: 3500, closePrice: 3420, pnl: -240, strategy: 'MA Ribbon', sector: 'Telecommunication', reason: 'SL', daysOffset: 2, hoursOffset: 2, sl: 3420, tp: 3650 },
    { symbol: 'GOTO', direction: 'BUY', lotSize: 0.20, entryPrice: 86, closePrice: 82, pnl: -800, strategy: 'EMA/RSI Filter', sector: 'Technology', reason: 'SL', daysOffset: 2, hoursOffset: 1, sl: 82, tp: 95 },
  ]

  const createdClosedTrades = []
  for (const t of closedTradeSpecs) {
    const closeTime = new Date(daysAgo(t.daysOffset).getTime() + (t.hoursOffset ?? 0) * 60 * 60 * 1000)
    const margin = (t.entryPrice * t.lotSize * 100000) / 25
    const trade = await db.trade.create({
      data: {
        symbol: t.symbol,
        direction: t.direction,
        lotSize: t.lotSize,
        entryPrice: t.entryPrice,
        currentPrice: t.closePrice,
        closePrice: t.closePrice,
        pnl: t.pnl,
        pnlPercent: (t.pnl / margin) * 100,
        status: 'CLOSED',
        strategy: t.strategy,
        sector: t.sector,
        reason: t.reason,
        sl: t.sl,
        tp: t.tp,
        trailingStop: t.trailingStop ?? false,
        leverage: 25,
        commission: t.lotSize * 1,
        slippage: t.lotSize * 0.5,
        margin,
        openTime: new Date(closeTime.getTime() - 30 * 60 * 1000), // 30 min before close
        closeTime,
        sizingMethod: 'FIXED_FRACTIONAL',
        riskAmount: t.sl ? Math.abs(t.entryPrice - t.sl) * t.lotSize * 100 : undefined,
      },
    })
    createdClosedTrades.push(trade)
  }
  console.log(`  ✓ Closed Trades: ${createdClosedTrades.length}`)

  // ============================================
  // 5. DAILY PERFORMANCE (3 days)
  // ============================================
  await db.dailyPerformance.deleteMany({})

  // Calculate PnL for each day
  // Recalculate properly
  const todayClosedPnl = closedTradeSpecs.filter(t => t.daysOffset === 0).reduce((s, t) => s + t.pnl, 0) // 500+1200+320+480-400-40 = 2060
  const todayOpenPnl = openTrades.reduce((s, t) => s + t.pnl, 0) // 350+700-90+1200+120-400-450+420 = 1850
  const todayStartBalance = 10000
  const todayEndBalance = todayStartBalance + todayClosedPnl + todayOpenPnl
  const todayWinCount = closedTradeSpecs.filter(t => t.daysOffset === 0 && t.pnl > 0).length
  const todayLossCount = closedTradeSpecs.filter(t => t.daysOffset === 0 && t.pnl < 0).length

  await db.dailyPerformance.create({
    data: {
      date: todayStr(),
      startBalance: todayStartBalance,
      endBalance: todayEndBalance,
      realizedPnl: todayClosedPnl,
      unrealizedPnl: todayOpenPnl,
      totalPnl: todayClosedPnl + todayOpenPnl,
      pnlPercent: ((todayClosedPnl + todayOpenPnl) / todayStartBalance) * 100,
      tradesOpened: openTrades.length,
      tradesClosed: todayWinCount + todayLossCount,
      winTrades: todayWinCount,
      lossTrades: todayLossCount,
      maxDrawdown: 0.5,
      peakEquity: todayEndBalance,
      troughEquity: todayStartBalance - 50,
      riskScoreAvg: 3.5,
      commissionPaid: openTrades.reduce((s, t) => s + t.commission, 0) + closedTradeSpecs.filter(t => t.daysOffset === 0).reduce((s, t) => s + t.lotSize * 1, 0),
      slippageCost: openTrades.reduce((s, t) => s + t.slippage, 0),
      deployedCapital: openTrades.reduce((s, t) => s + t.margin, 0),
      reserveCapital: todayEndBalance * 0.2,
      sizingMethodUsed: 'FIXED_FRACTIONAL',
      scalingFactor: 1.0,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 0,
      equityCurveStatus: 'NORMAL',
      equityCurveMaValue: 0,
      sessionPnl: todayClosedPnl,
      sessionTrades: todayWinCount + todayLossCount,
    },
  })

  // Yesterday: ~$150 profit, 5 wins, 2 losses
  const yesterdayStart = todayStartBalance - 150
  const yesterdayClosedPnl = closedTradeSpecs.filter(t => t.daysOffset === 1).reduce((s, t) => s + t.pnl, 0)
  await db.dailyPerformance.create({
    data: {
      date: daysAgoStr(1),
      startBalance: yesterdayStart,
      endBalance: yesterdayStart + yesterdayClosedPnl,
      realizedPnl: yesterdayClosedPnl,
      unrealizedPnl: 0,
      totalPnl: yesterdayClosedPnl,
      pnlPercent: (yesterdayClosedPnl / yesterdayStart) * 100,
      tradesOpened: 0,
      tradesClosed: 5,
      winTrades: 3,
      lossTrades: 2,
      maxDrawdown: 0.8,
      peakEquity: yesterdayStart + 1200,
      troughEquity: yesterdayStart - 320,
      riskScoreAvg: 4.2,
      commissionPaid: closedTradeSpecs.filter(t => t.daysOffset === 1).reduce((s, t) => s + t.lotSize * 1, 0),
      slippageCost: 1.5,
      deployedCapital: 0,
      reserveCapital: (yesterdayStart + yesterdayClosedPnl) * 0.2,
      sizingMethodUsed: 'FIXED_FRACTIONAL',
      scalingFactor: 1.05,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 2,
      equityCurveStatus: 'NORMAL',
      equityCurveMaValue: 0,
    },
  })

  // 2 days ago: ~-$80 loss, 2 wins, 4 losses
  const twoDaysAgoStart = yesterdayStart - yesterdayClosedPnl + 80
  const twoDaysAgoPnl = closedTradeSpecs.filter(t => t.daysOffset === 2).reduce((s, t) => s + t.pnl, 0)
  await db.dailyPerformance.create({
    data: {
      date: daysAgoStr(2),
      startBalance: twoDaysAgoStart,
      endBalance: twoDaysAgoStart + twoDaysAgoPnl,
      realizedPnl: twoDaysAgoPnl,
      unrealizedPnl: 0,
      totalPnl: twoDaysAgoPnl,
      pnlPercent: (twoDaysAgoPnl / twoDaysAgoStart) * 100,
      tradesOpened: 0,
      tradesClosed: 4,
      winTrades: 2,
      lossTrades: 2,
      maxDrawdown: 1.2,
      peakEquity: twoDaysAgoStart + 700,
      troughEquity: twoDaysAgoStart + twoDaysAgoPnl,
      riskScoreAvg: 5.8,
      commissionPaid: closedTradeSpecs.filter(t => t.daysOffset === 2).reduce((s, t) => s + t.lotSize * 1, 0),
      slippageCost: 2.0,
      deployedCapital: 0,
      reserveCapital: (twoDaysAgoStart + twoDaysAgoPnl) * 0.2,
      sizingMethodUsed: 'FIXED_FRACTIONAL',
      scalingFactor: 0.95,
      consecutiveLosses: 2,
      maxConsecutiveLosses: 2,
      equityCurveStatus: 'RECOVERING',
      equityCurveMaValue: 0,
    },
  })
  console.log('  ✓ Daily Performance: 3 days')

  // ============================================
  // 6. TRADING LOGS (25 entries)
  // ============================================
  await db.tradingLog.deleteMany({})

  const logEntries = [
    // DEBUG (5)
    { level: 'DEBUG', category: 'SYSTEM', message: 'Application startup sequence initiated', source: 'system', createdAt: minutesAgo(120) },
    { level: 'DEBUG', category: 'MT5_CONNECTION', message: 'Heartbeat timer set to 30s interval', source: 'mt5-connection', createdAt: minutesAgo(115) },
    { level: 'DEBUG', category: 'RISK_MANAGEMENT', message: 'Risk config loaded from database', source: 'risk-engine', createdAt: minutesAgo(110) },
    { level: 'DEBUG', category: 'MONEY_MANAGEMENT', message: 'Position sizing calculator initialized', source: 'money-management', createdAt: minutesAgo(105) },
    { level: 'DEBUG', category: 'SYSTEM', message: 'Log buffer initialized with 100ms flush interval', source: 'trading-logger', createdAt: minutesAgo(100) },
    // INFO (8)
    { level: 'INFO', category: 'MT5_CONNECTION', message: 'Connected to FINEX-Real5 (account 8812345)', source: 'mt5-connection', createdAt: minutesAgo(90) },
    { level: 'INFO', category: 'TRADE_EXECUTION', message: 'BUY BBCA 0.05 lot @ 9850 executed successfully', source: 'trade-executor', symbol: 'BBCA', createdAt: minutesAgo(80) },
    { level: 'INFO', category: 'TRADE_EXECUTION', message: 'SELL BBRI 0.10 lot @ 4750 executed successfully', source: 'trade-executor', symbol: 'BBRI', createdAt: minutesAgo(70) },
    { level: 'INFO', category: 'RISK_MANAGEMENT', message: 'Pre-trade check passed for ASII BUY 0.08 lot', source: 'risk-engine', symbol: 'ASII', createdAt: minutesAgo(60) },
    { level: 'INFO', category: 'TRADE_EXECUTION', message: 'BUY ASII 0.08 lot @ 5200 executed successfully', source: 'trade-executor', symbol: 'ASII', createdAt: minutesAgo(55) },
    { level: 'INFO', category: 'MONEY_MANAGEMENT', message: 'Daily performance updated: realized PnL $2060', source: 'money-management', createdAt: minutesAgo(30) },
    { level: 'INFO', category: 'MT5_CONNECTION', message: 'Heartbeat OK (latency: 42ms)', source: 'mt5-connection', createdAt: minutesAgo(15) },
    { level: 'INFO', category: 'SYSTEM', message: 'Log cleanup completed: 0 expired logs removed', source: 'trading-logger', createdAt: minutesAgo(5) },
    // WARN (5)
    { level: 'WARN', category: 'RISK_MANAGEMENT', message: 'Daily loss approaching limit (80% of max $200)', source: 'risk-engine', createdAt: minutesAgo(85) },
    { level: 'WARN', category: 'MONEY_MANAGEMENT', message: 'Position sizing reduced by scaling factor 0.95 due to recent losses', source: 'money-management', createdAt: minutesAgo(75) },
    { level: 'WARN', category: 'MT5_CONNECTION', message: 'Latency spike detected: 180ms (threshold: 200ms)', source: 'mt5-connection', createdAt: minutesAgo(50) },
    { level: 'WARN', category: 'RISK_MANAGEMENT', message: 'Sector concentration Banking at 12% (limit: 15%)', source: 'risk-engine', symbol: 'BBCA', createdAt: minutesAgo(40) },
    { level: 'WARN', category: 'TRADE_EXECUTION', message: 'GOTO order experienced 2 pip slippage on execution', source: 'trade-executor', symbol: 'GOTO', createdAt: minutesAgo(20) },
    // ERROR (4)
    { level: 'ERROR', category: 'TRADE_EXECUTION', message: 'UNVR SELL order rejected: MT5 error 10006 (Request rejected)', source: 'trade-executor', symbol: 'UNVR', details: 'MT5 returned TRADE_RETCODE_REJECT', createdAt: minutesAgo(65) },
    { level: 'ERROR', category: 'MT5_CONNECTION', message: 'Heartbeat failed: no response within 30s timeout', source: 'mt5-connection', createdAt: minutesAgo(45) },
    { level: 'ERROR', category: 'RISK_MANAGEMENT', message: 'Risk check failed for GOTO: slippage tolerance exceeded (5 pips > 3 pips limit)', source: 'risk-engine', symbol: 'GOTO', createdAt: minutesAgo(35) },
    { level: 'ERROR', category: 'MONEY_MANAGEMENT', message: 'Failed to calculate drawdown recovery: no performance data found', source: 'money-management', createdAt: minutesAgo(25) },
    // CRITICAL (2)
    { level: 'CRITICAL', category: 'MT5_CONNECTION', message: 'Connection degraded: 3 consecutive heartbeat failures', source: 'mt5-connection', details: 'Circuit breaker approaching OPEN threshold (5 failures)', createdAt: minutesAgo(95) },
    { level: 'CRITICAL', category: 'RISK_MANAGEMENT', message: 'Portfolio risk at 4.8% (limit: 5%) - approaching cap', source: 'risk-engine', createdAt: minutesAgo(10) },
    // FATAL (1)
    { level: 'FATAL', category: 'MT5_CONNECTION', message: 'Circuit breaker opened due to 5 consecutive connection failures', source: 'mt5-connection', details: 'All trading halted. Auto-reconnect in 60s.', createdAt: minutesAgo(93) },
  ]

  const createdLogs = []
  for (const log of logEntries) {
    const entry = await db.tradingLog.create({
      data: {
        level: log.level,
        category: log.category,
        message: log.message,
        source: log.source ?? null,
        details: log.details ?? null,
        symbol: log.symbol ?? null,
        createdAt: log.createdAt,
        metadata: '{}',
      },
    })
    createdLogs.push(entry)
  }
  console.log(`  ✓ Trading Logs: ${createdLogs.length}`)

  // ============================================
  // 7. RISK EVENTS (5 events)
  // ============================================
  await db.riskEvent.deleteMany({})

  const riskEvents = [
    {
      eventType: 'PROACTIVE_MC_70', severity: 'MEDIUM',
      message: 'Proactive margin call at 70% level triggered',
      details: 'Equity margin usage reached 72%. Size reduction recommended.',
      actionTaken: 'REDUCED_SIZE', resolved: true,
      resolvedAt: hoursAgo(1),
      autoResolveAt: hoursAgo(0.5),
      createdAt: hoursAgo(2),
    },
    {
      eventType: 'DAILY_LIMIT_APPROACHING', severity: 'MEDIUM',
      message: 'Daily loss limit 80% reached ($160 of $200 max)',
      details: 'Consider reducing position sizes or halting for the session.',
      actionTaken: 'NOTIFICATION_SENT', resolved: true,
      resolvedAt: hoursAgo(1.5),
      autoResolveAt: hoursAgo(1),
      createdAt: hoursAgo(3),
    },
    {
      eventType: 'CONCENTRATION_LIMIT', severity: 'HIGH',
      message: 'Banking sector concentration at 14% (limit: 15%)',
      details: 'BBCA, BBRI, BRIS, BMRI all in Banking sector. Adding more banking exposure is restricted.',
      actionTaken: 'TRADE_BLOCKED', resolved: false,
      createdAt: hoursAgo(0.5),
    },
    {
      eventType: 'SLIPPAGE_WARNING', severity: 'MEDIUM',
      message: 'GOTO experiencing high slippage: 4 pips average (tolerance: 3 pips)',
      details: 'Recent 5 GOTO trades averaged 4 pip slippage. Consider wider stops or reduced size.',
      actionTaken: 'NONE', resolved: false,
      createdAt: minutesAgo(20),
    },
    {
      eventType: 'CORRELATION_RISK', severity: 'HIGH',
      message: 'High correlation detected: BBCA-BBRI-BMRI banking cluster',
      details: 'Pearson correlation > 0.85 among 3 banking positions. Sector drawdown would amplify losses.',
      actionTaken: 'NONE', resolved: false,
      createdAt: minutesAgo(10),
    },
  ]

  const createdEvents = []
  for (const evt of riskEvents) {
    const event = await db.riskEvent.create({ data: evt })
    createdEvents.push(event)
  }
  console.log(`  ✓ Risk Events: ${createdEvents.length}`)

  // ============================================
  // 8. MT5 ERROR CODES (upsert all 17)
  // ============================================
  const errorCodes = [
    { code: 10004, description: 'Requote', severity: 'WARN', category: 'TRADE_EXECUTION', remediation: 'Retry with refreshed price from latest tick', retryable: true },
    { code: 10006, description: 'Request rejected', severity: 'ERROR', category: 'TRADE_EXECUTION', remediation: 'Log rejection and notify. Do not retry - requires manual investigation', retryable: false },
    { code: 10013, description: 'Invalid request', severity: 'ERROR', category: 'TRADE_EXECUTION', remediation: 'Validate all order parameters before resubmission. Check symbol, volume, price', retryable: false },
    { code: 10014, description: 'Invalid volume', severity: 'ERROR', category: 'TRADE_EXECUTION', remediation: 'Check lot size against symbol min/max/step. Round to valid lot step', retryable: false },
    { code: 10015, description: 'Invalid price', severity: 'WARN', category: 'TRADE_EXECUTION', remediation: 'Refresh price from latest tick. Check digits/normalization for symbol', retryable: true },
    { code: 10016, description: 'Invalid stops', severity: 'ERROR', category: 'TRADE_EXECUTION', remediation: 'Check SL/TP distances against minimum stop level. Verify price direction for BUY/SELL', retryable: false },
    { code: 10017, description: 'Trade disabled', severity: 'FATAL', category: 'TRADE_EXECUTION', remediation: 'Trading disabled by broker. Contact FINEX support immediately', retryable: false },
    { code: 10018, description: 'Market closed', severity: 'WARN', category: 'TRADE_EXECUTION', remediation: 'Wait for market open (IDX: 09:00-15:00 WIB). Queue order for next session', retryable: false },
    { code: 10019, description: 'Not enough money', severity: 'ERROR', category: 'TRADE_EXECUTION', remediation: 'Reduce lot size or close existing positions to free margin', retryable: false },
    { code: 10020, description: 'Prices changed', severity: 'WARN', category: 'TRADE_EXECUTION', remediation: 'Refresh price and retry. Use latest bid/ask from tick data', retryable: true },
    { code: 10021, description: 'No quotes', severity: 'WARN', category: 'DATA_FEED', remediation: 'No market data available. Wait for quotes to resume', retryable: true },
    { code: 10024, description: 'Too many requests', severity: 'WARN', category: 'MT5_CONNECTION', remediation: 'Rate limit hit. Apply exponential backoff starting at 1s', retryable: true },
    { code: 10026, description: 'Autotrading disabled', severity: 'FATAL', category: 'MT5_CONNECTION', remediation: 'Enable autotrading in MT5 terminal settings. System cannot operate without it', retryable: false },
    { code: 10028, description: 'Request locked', severity: 'WARN', category: 'TRADE_EXECUTION', remediation: 'Previous request still processing. Wait and retry after 500ms', retryable: true },
    { code: 10030, description: 'Invalid filling type', severity: 'ERROR', category: 'TRADE_EXECUTION', remediation: 'Use FOK (Fill or Kill) or RETURN filling type for FINEX', retryable: false },
    { code: 10031, description: 'No connection', severity: 'ERROR', category: 'MT5_CONNECTION', remediation: 'Initiate reconnection sequence. Check network and broker status', retryable: true },
    { code: 10036, description: 'Position closed', severity: 'INFO', category: 'TRADE_EXECUTION', remediation: 'Position already closed by broker or another request. Update local state', retryable: false },
  ]

  for (const ec of errorCodes) {
    await db.mt5ErrorCode.upsert({
      where: { code: ec.code },
      update: { description: ec.description, severity: ec.severity, category: ec.category, remediation: ec.remediation, retryable: ec.retryable },
      create: ec,
    })
  }
  console.log('  ✓ MT5 Error Codes: 17 (upserted)')

  // ============================================
  // 9. NEWS ARTICLES (5 IDX market news)
  // ============================================
  await db.newsArticle.deleteMany({})

  const newsArticles = [
    {
      title: 'Bank Indonesia Holds Rate at 5.75% Amid Global Uncertainty',
      content: 'Bank Indonesia decided to maintain its benchmark interest rate at 5.75% during today\'s board meeting, citing the need to preserve rupiah stability amid global economic uncertainty and geopolitical tensions. The central bank noted that inflation remains within the target range of 2.5-4.5%.',
      source: 'Bloomberg Indonesia',
      sentiment: 'POSITIVE',
      sentimentScore: 0.7,
      symbols: JSON.stringify(['BBCA', 'BBRI', 'BMRI']),
      category: 'Central Bank',
      publishedAt: hoursAgo(2),
    },
    {
      title: 'IHSG Drops 0.8% as Foreign Investors Net Sell IDR 1.2 Trillion',
      content: 'The Jakarta Composite Index (IHSG) fell 0.8% to 7,150 on Wednesday as foreign investors continued to offload Indonesian equities. Banking and commodity stocks led the decline. Analysts attribute the selling to rising US Treasury yields and a stronger dollar.',
      source: 'Kontan',
      sentiment: 'NEGATIVE',
      sentimentScore: -0.6,
      symbols: JSON.stringify(['BBCA', 'BBRI', 'ANTM']),
      category: 'Economic',
      publishedAt: hoursAgo(5),
    },
    {
      title: 'Banking Sector Posts Strong Q4 Earnings, Loan Growth at 12%',
      content: 'Indonesia\'s banking sector reported robust Q4 2024 earnings with aggregate net profit rising 15% year-on-year. Loan growth accelerated to 12%, driven by corporate and retail demand. NIM improved to 5.2%. BBCA and BBRI led with double-digit profit growth.',
      source: 'Investor Daily',
      sentiment: 'POSITIVE',
      sentimentScore: 0.8,
      symbols: JSON.stringify(['BBCA', 'BBRI', 'BMRI', 'BRIS']),
      category: 'Economic',
      publishedAt: hoursAgo(8),
    },
    {
      title: 'Nickel and Coal Prices Surge on Supply Constraints',
      content: 'Nickel prices jumped 3.5% while thermal coal rose 2% on tightening global supply. Indonesia\'s export restrictions on nickel ore continue to support elevated prices. Mining stocks ANTM and ADRO are expected to benefit from the commodity uptrend.',
      source: 'CNBC Indonesia',
      sentiment: 'POSITIVE',
      sentimentScore: 0.5,
      symbols: JSON.stringify(['ANTM', 'ADRO']),
      category: 'Commodity',
      publishedAt: hoursAgo(12),
    },
    {
      title: 'GOTO Restructuring Shows Results, Path to Profitability Narrowing',
      content: 'GoTo Group reported narrowing losses in Q4 as its restructuring efforts begin to bear fruit. The tech conglomerate cut operating expenses by 20% while growing revenue 8%. However, analysts remain cautious about the competitive landscape and cash burn rate.',
      source: 'Tech in Asia',
      sentiment: 'NEUTRAL',
      sentimentScore: 0.1,
      symbols: JSON.stringify(['GOTO']),
      category: 'Breaking',
      publishedAt: hoursAgo(18),
    },
  ]

  const createdNews = []
  for (const n of newsArticles) {
    const article = await db.newsArticle.create({ data: n })
    createdNews.push(article)
  }
  console.log(`  ✓ News Articles: ${createdNews.length}`)

  // ============================================
  // 10. AI ANALYSES (5 analyses)
  // ============================================
  await db.aiAnalysis.deleteMany({})

  const analyses = [
    {
      symbol: 'BBCA', marketCondition: 'TRENDING', confidence: 82,
      timeframe: 'H1', trendDirection: 'UP', volatility: 0.015,
      volumeAnalysis: 'Above average volume confirming uptrend',
      sentiment: 'BULLISH',
      recommendations: JSON.stringify([
        { action: 'BUY', entry: '9900', sl: '9750', tp: '10200', reason: 'Strong EMA crossover with volume confirmation' },
        { action: 'HOLD', entry: '', sl: '', tp: '', reason: 'Existing long positions should maintain trailing stops' },
      ]),
      factors: JSON.stringify([
        { name: 'Central Bank Policy', score: 75, impact: 'positive' },
        { name: 'Banking Sector Strength', score: 85, impact: 'positive' },
        { name: 'Technical Indicators', score: 80, impact: 'positive' },
        { name: 'Market Sentiment', score: 70, impact: 'positive' },
        { name: 'Volume Analysis', score: 78, impact: 'positive' },
      ]),
    },
    {
      symbol: 'BBRI', marketCondition: 'RANGE_BOUND', confidence: 65,
      timeframe: 'H1', trendDirection: 'SIDEWAYS', volatility: 0.012,
      volumeAnalysis: 'Normal volume, no clear direction',
      sentiment: 'NEUTRAL',
      recommendations: JSON.stringify([
        { action: 'WAIT', entry: '', sl: '', tp: '', reason: 'Ranging between 4650-4750. Wait for breakout.' },
      ]),
      factors: JSON.stringify([
        { name: 'Technical Indicators', score: 50, impact: 'neutral' },
        { name: 'Market Sentiment', score: 55, impact: 'neutral' },
        { name: 'Volume Analysis', score: 48, impact: 'neutral' },
      ]),
    },
    {
      symbol: 'TLKM', marketCondition: 'HIGH_VOLATILITY', confidence: 58,
      timeframe: 'H4', trendDirection: 'DOWN', volatility: 0.025,
      volumeAnalysis: 'Elevated volume on selling days',
      sentiment: 'BEARISH',
      recommendations: JSON.stringify([
        { action: 'SELL', entry: '3430', sl: '3500', tp: '3300', reason: 'Bearish MA ribbon with high volatility' },
      ]),
      factors: JSON.stringify([
        { name: 'Technical Indicators', score: 35, impact: 'negative' },
        { name: 'Volatility', score: 20, impact: 'negative' },
        { name: 'Sector Performance', score: 45, impact: 'neutral' },
      ]),
    },
    {
      symbol: 'ASII', marketCondition: 'TRENDING', confidence: 78,
      timeframe: 'H1', trendDirection: 'UP', volatility: 0.018,
      volumeAnalysis: 'Strong volume supporting price advance',
      sentiment: 'BULLISH',
      recommendations: JSON.stringify([
        { action: 'BUY', entry: '5350', sl: '5200', tp: '5600', reason: 'Pivot point bounce with momentum' },
      ]),
      factors: JSON.stringify([
        { name: 'Technical Indicators', score: 80, impact: 'positive' },
        { name: 'Conglomerate Sector', score: 72, impact: 'positive' },
        { name: 'Volume Analysis', score: 75, impact: 'positive' },
        { name: 'Economic Outlook', score: 68, impact: 'positive' },
      ]),
    },
    {
      symbol: 'GOTO', marketCondition: 'HIGH_VOLATILITY', confidence: 42,
      timeframe: 'M15', trendDirection: 'SIDEWAYS', volatility: 0.045,
      volumeAnalysis: 'Spike volume on news days, thin otherwise',
      sentiment: 'NEUTRAL',
      recommendations: JSON.stringify([
        { action: 'AVOID', entry: '', sl: '', tp: '', reason: 'High volatility and uncertain fundamentals. Risk too high.' },
      ]),
      factors: JSON.stringify([
        { name: 'Technical Indicators', score: 40, impact: 'negative' },
        { name: 'Volatility', score: 15, impact: 'negative' },
        { name: 'Fundamentals', score: 50, impact: 'neutral' },
        { name: 'Market Sentiment', score: 45, impact: 'neutral' },
      ]),
    },
  ]

  const createdAnalyses = []
  for (const a of analyses) {
    const analysis = await db.aiAnalysis.create({ data: a })
    createdAnalyses.push(analysis)
  }
  console.log(`  ✓ AI Analyses: ${createdAnalyses.length}`)

  // ---- Phase 6: News Fetch Logs ----
  console.log('Seeding Phase 6 data...')

  const fetchLogs = [
    { provider: 'FINNHUB', endpoint: '/company-news?symbol=BBCA', statusCode: 200, responseTimeMs: 342, articlesFetched: 12, articlesNew: 8, articlesDedup: 4, createdAt: new Date(Date.now() - 3600000) },
    { provider: 'MARKETAUX', endpoint: '/news/all?countries=id', statusCode: 200, responseTimeMs: 891, articlesFetched: 25, articlesNew: 20, articlesDedup: 5, createdAt: new Date(Date.now() - 7200000) },
    { provider: 'FINNHUB', endpoint: '/company-news?symbol=BBRI', statusCode: 200, responseTimeMs: 287, articlesFetched: 8, articlesNew: 5, articlesDedup: 3, createdAt: new Date(Date.now() - 5400000) },
    { provider: 'FINNHUB', endpoint: '/company-news?symbol=BMRI', statusCode: 429, responseTimeMs: 125, articlesFetched: 0, articlesNew: 0, articlesDedup: 0, error: 'Rate limit exceeded', createdAt: new Date(Date.now() - 1800000) },
    { provider: 'MARKETAUX', endpoint: '/news/all?countries=id', statusCode: 200, responseTimeMs: 763, articlesFetched: 18, articlesNew: 15, articlesDedup: 3, createdAt: new Date(Date.now() - 900000) },
  ]
  for (const log of fetchLogs) {
    await db.newsFetchLog.create({ data: log })
  }
  console.log('  ✓ News Fetch Logs: 5')

  // ---- Phase 6: Sentiment Snapshots ----
  const sentimentSnapshots = [
    { symbol: 'BBCA', overallScore: 62.5, articleCount: 8, positiveCount: 5, negativeCount: 2, neutralCount: 1, sentimentRegime: 'BULLISH', confidence: 72, weightedScore: 58.3, topPositiveWords: JSON.stringify(['profit', 'growth', 'dividend']), topNegativeWords: JSON.stringify(['risk']), sectorBreakdown: JSON.stringify({ Banking: 65, Overall: 62.5 }), createdAt: new Date(Date.now() - 1800000) },
    { symbol: 'BBRI', overallScore: 45.0, articleCount: 6, positiveCount: 3, negativeCount: 1, neutralCount: 2, sentimentRegime: 'NEUTRAL', confidence: 55, weightedScore: 40.2, topPositiveWords: JSON.stringify(['expansion', 'loan']), topNegativeWords: JSON.stringify(['NPL']), sectorBreakdown: JSON.stringify({ Banking: 48 }), createdAt: new Date(Date.now() - 2400000) },
    { symbol: 'TLKM', overallScore: -35.0, articleCount: 4, positiveCount: 1, negativeCount: 2, neutralCount: 1, sentimentRegime: 'BEARISH', confidence: 45, weightedScore: -30.5, topPositiveWords: JSON.stringify(['dividend']), topNegativeWords: JSON.stringify(['decline', 'competition']), sectorBreakdown: JSON.stringify({ Telecom: -35 }), createdAt: new Date(Date.now() - 3600000) },
    { symbol: 'MARKET', overallScore: 28.0, articleCount: 35, positiveCount: 18, negativeCount: 10, neutralCount: 7, sentimentRegime: 'NEUTRAL', confidence: 65, weightedScore: 25.0, topPositiveWords: JSON.stringify(['growth', 'GDP', 'strong']), topNegativeWords: JSON.stringify(['inflation', 'global']), sectorBreakdown: JSON.stringify({ Banking: 55, Mining: -20, Tech: 40, Consumer: 30 }), createdAt: new Date(Date.now() - 600000) },
    { symbol: 'ASII', overallScore: 55.0, articleCount: 5, positiveCount: 3, negativeCount: 1, neutralCount: 1, sentimentRegime: 'BULLISH', confidence: 60, weightedScore: 50.0, topPositiveWords: JSON.stringify(['sales', 'EV', 'innovation']), topNegativeWords: JSON.stringify(['supply']), sectorBreakdown: JSON.stringify({ Automotive: 55 }), createdAt: new Date(Date.now() - 1200000) },
    { symbol: 'BMRI', overallScore: -72.0, articleCount: 7, positiveCount: 1, negativeCount: 5, neutralCount: 1, sentimentRegime: 'EXTREME_FEAR', confidence: 78, weightedScore: -68.0, topPositiveWords: JSON.stringify(['stable']), topNegativeWords: JSON.stringify(['fraud', 'scandal', 'investigation', 'loss', 'penalty']), sectorBreakdown: JSON.stringify({ Banking: -72 }), createdAt: new Date(Date.now() - 300000) },
  ]
  for (const snap of sentimentSnapshots) {
    await db.sentimentSnapshot.create({ data: snap })
  }
  console.log('  ✓ Sentiment Snapshots: 6')

  // ---- Phase 6: Decision Logs ----
  const decisionLogs = [
    { symbol: 'BBCA', decision: 'BUY', confidence: 78, reasoning: 'Strong bullish technical setup (RSI recovering from oversold, MACD bullish crossover) supported by positive news flow (BI rate hold) and bullish sentiment (+62.5). Risk score moderate at 3.2.', factors: JSON.stringify({ technical: { score: 72, trend: 'UP' }, news: { score: 55, breaking: 0 }, sentiment: { score: 62.5, regime: 'BULLISH' }, risk: { score: 3.2, regime: 'NORMAL' } }), signalSources: JSON.stringify(['RSI_OVERSOLD', 'MACD_BULLISH', 'NEWS_POSITIVE', 'SENTIMENT_BULLISH']), riskScore: 3.2, sentimentScore: 62.5, volatilityRegime: 'NORMAL', strategyUsed: 'EMA Crossover', timeframe: 'H1', finalAction: 'BUY', overridden: false, createdAt: new Date(Date.now() - 900000) },
    { symbol: 'BMRI', decision: 'SKIP', confidence: 35, reasoning: 'Extreme fear sentiment regime (-72) blocks trading. Despite technical oversold conditions, sentiment filter requires position avoidance until regime stabilizes.', factors: JSON.stringify({ technical: { score: -45, trend: 'DOWN' }, news: { score: -80, breaking: 1 }, sentiment: { score: -72, regime: 'EXTREME_FEAR' }, risk: { score: 6.5, regime: 'HIGH_VOLATILITY' } }), signalSources: JSON.stringify(['SENTIMENT_EXTREME_FEAR', 'NEWS_NEGATIVE', 'RSI_OVERSOLD']), riskScore: 6.5, sentimentScore: -72, volatilityRegime: 'HIGH_VOLATILITY', strategyUsed: 'RMI Trend Sync', timeframe: 'H1', finalAction: 'SKIP', overridden: false, createdAt: new Date(Date.now() - 600000) },
    { symbol: 'TLKM', decision: 'SELL', confidence: 68, reasoning: 'Bearish sentiment (-35) with declining trend. MACD bearish crossover confirmed. Negative news regarding competition. Risk acceptable at 3.8.', factors: JSON.stringify({ technical: { score: -55, trend: 'DOWN' }, news: { score: -40, breaking: 0 }, sentiment: { score: -35, regime: 'BEARISH' }, risk: { score: 3.8, regime: 'NORMAL' } }), signalSources: JSON.stringify(['MACD_BEARISH', 'TREND_DOWN', 'SENTIMENT_BEARISH', 'NEWS_NEGATIVE']), riskScore: 3.8, sentimentScore: -35, volatilityRegime: 'NORMAL', strategyUsed: 'Pivot Point', timeframe: 'M15', finalAction: 'SELL', overridden: false, createdAt: new Date(Date.now() - 300000) },
    { symbol: 'ASII', decision: 'BUY', confidence: 72, reasoning: 'Bullish momentum with positive EV news catalyst. ADX confirming strong trend at 32. Sentiment supportive at +55. Volume increasing.', factors: JSON.stringify({ technical: { score: 65, trend: 'UP' }, news: { score: 60, breaking: 0 }, sentiment: { score: 55, regime: 'BULLISH' }, risk: { score: 2.8, regime: 'NORMAL' } }), signalSources: JSON.stringify(['ADX_STRONG_TREND', 'NEWS_POSITIVE', 'SENTIMENT_BULLISH', 'VOLUME_INCREASING']), riskScore: 2.8, sentimentScore: 55, volatilityRegime: 'NORMAL', strategyUsed: 'MA Ribbon', timeframe: 'H1', finalAction: 'HOLD', overridden: true, overrideReason: 'Manual override: waiting for pullback to support level', createdAt: new Date(Date.now() - 120000) },
    { symbol: 'BBRI', decision: 'HOLD', confidence: 45, reasoning: 'Mixed signals with neutral sentiment (+45). RSI neutral at 52. MACD flat. No strong directional conviction. Wait for clearer setup.', factors: JSON.stringify({ technical: { score: 10, trend: 'SIDEWAYS' }, news: { score: 15, breaking: 0 }, sentiment: { score: 45, regime: 'NEUTRAL' }, risk: { score: 2.5, regime: 'NORMAL' } }), signalSources: JSON.stringify(['RSI_NEUTRAL', 'MACD_NEUTRAL']), riskScore: 2.5, sentimentScore: 45, volatilityRegime: 'NORMAL', strategyUsed: 'Linear Regression', timeframe: 'H1', finalAction: 'HOLD', overridden: false, createdAt: new Date(Date.now() - 60000) },
  ]
  for (const dec of decisionLogs) {
    await db.decisionLog.create({ data: dec })
  }
  console.log('  ✓ Decision Logs: 5')

  // ---- Phase 6: AI Decision Config ----
  await db.aiDecisionConfig.upsert({
    where: { name: 'default' },
    update: {},
    create: {
      name: 'default',
      minConfidenceBuy: 65.0,
      minConfidenceSell: 65.0,
      sentimentWeight: 0.25,
      technicalWeight: 0.50,
      newsWeight: 0.25,
      maxPositionsPerDecision: 3,
      cooldownSeconds: 300,
      extremeSentimentBlock: true,
      volatilityScalingEnabled: true,
    },
  })
  console.log('  ✓ AI Decision Config: 1')

  console.log('Seed complete')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
