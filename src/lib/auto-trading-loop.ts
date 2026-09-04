/**
 * Auto-Trading Loop Orchestrator
 * ================================
 * Server-side singleton that periodically:
 *   1. Checks if auto-trading is enabled (via DB flag)
 *   2. Checks if market is open
 *   3. Runs AI decision engine for watched symbols
 *   4. Runs risk pre-trade checks
 *   5. Executes approved trades via the trade execution pipeline
 *   6. Handles CLOSE_ALL and REDUCE decisions
 *   7. Syncs broker positions periodically
 *
 * The loop is controlled via API endpoints:
 *   - GET  /api/auto-trading  → status, last scan, recent decisions
 *   - POST /api/auto-trading  → start / stop / configure
 */

import { db } from './db'
import logger from './trading-logger'
import { makeDecision, makeMultiStrategyDecision, type AiDecision, STRATEGY_REGISTRY, defaultTechnicalFactors, defaultNewsFactors, defaultSentimentFactors, defaultRiskFactors } from './ai-decision-engine'
import { executeTrade, closeTrade, emergencyCloseAll, type TradeRecord } from './trade-execution-engine'
import { preTradeCheck } from './risk-engine'
import { isMarketOpen, getTradingPhase, getPricesFromBridge, getPositionsFromBridge, validateSymbol } from './mt5-connection'
import mt5Connection from './mt5-connection'

// ============================================
// TYPES
// ============================================

export interface AutoTradingConfig {
  enabled: boolean
  scanIntervalMs: number
  mode: 'SINGLE_STRATEGY' | 'MULTI_STRATEGY'
  strategyId: string        // for SINGLE_STRATEGY mode
  timeframe: string
  maxOpenPositions: number
  watchlist: string[]        // symbols to scan
  enabledStrategies: string[] // for MULTI_STRATEGY mode
  adaptiveLearning: boolean
  positionSyncIntervalMs: number
  reduceOnConsecutiveLosses: number  // consecutive losses before reducing
  closeAllOnRiskScore: number         // risk score threshold for CLOSE_ALL
}

export interface AutoTradingStatus {
  running: boolean
  enabled: boolean
  config: AutoTradingConfig
  lastScanAt: Date | null
  nextScanAt: Date | null
  scanCount: number
  tradesOpened: number
  tradesRejected: number
  tradesClosedByAI: number
  lastError: string | null
  currentDecisions: AiDecision[]
 uptimeSeconds: number
  startedAt: Date | null
  brokerPositionsSynced: boolean
  lastSyncAt: Date | null
}

interface ScanResult {
  timestamp: Date
  symbol: string
  decision: AiDecision
  actionTaken: 'EXECUTED' | 'REJECTED_RISK' | 'REJECTED_COOLDOWN' | 'SKIPPED' | 'CLOSE_ALL' | 'REDUCE' | 'HOLD' | 'ERROR'
  actionDetails: string
  tradeId?: string
}

// ============================================
// DEFAULT CONFIG
// ============================================

const DEFAULT_CONFIG: AutoTradingConfig = {
  enabled: false,
  scanIntervalMs: 60_000,         // 1 minute
  mode: 'MULTI_STRATEGY',
  strategyId: 'ai-composite',
  timeframe: 'M15',
  maxOpenPositions: 3,
  watchlist: ['BBRI', 'BBCA', 'BMRI', 'TLKM', 'ASII', 'ANTM'],
  enabledStrategies: STRATEGY_REGISTRY.map(s => s.id),
  adaptiveLearning: true,
  positionSyncIntervalMs: 120_000, // 2 minutes
  reduceOnConsecutiveLosses: 4,
  closeAllOnRiskScore: 9,
}

// ============================================
// SINGLETON
// ============================================

let _instance: AutoTradingLoop | null = null

export function getAutoTradingLoop(): AutoTradingLoop {
  if (!_instance) {
    _instance = new AutoTradingLoop()
  }
  return _instance
}

// ============================================
// AUTO-TRADING LOOP CLASS
// ============================================

class AutoTradingLoop {
  private config: AutoTradingConfig = { ...DEFAULT_CONFIG }
  private _running = false
  private _scanTimer: ReturnType<typeof setTimeout> | null = null
  private _syncTimer: ReturnType<typeof setInterval> | null = null
  private _startedAt: Date | null = null
  private _lastScanAt: Date | null = null
  private _lastSyncAt: Date | null = null
  private _scanCount = 0
  private _tradesOpened = 0
  private _tradesRejected = 0
  private _tradesClosedByAI = 0
  private _lastError: string | null = null
  private _currentDecisions: AiDecision[] = []
  private _recentScans: ScanResult[] = []
  private _isScanning = false

  // ---- Public API ----

  getStatus(): AutoTradingStatus {
    const now = new Date()
    const nextScan = this._running && this.config.scanIntervalMs
      ? new Date((this._lastScanAt?.getTime() ?? now.getTime()) + this.config.scanIntervalMs)
      : null

    return {
      running: this._running,
      enabled: this.config.enabled,
      config: { ...this.config },
      lastScanAt: this._lastScanAt,
      nextScanAt: nextScan,
      scanCount: this._scanCount,
      tradesOpened: this._tradesOpened,
      tradesRejected: this._tradesRejected,
      tradesClosedByAI: this._tradesClosedByAI,
      lastError: this._lastError,
      currentDecisions: this._currentDecisions,
      uptimeSeconds: this._startedAt
        ? Math.floor((now.getTime() - this._startedAt.getTime()) / 1000)
        : 0,
      startedAt: this._startedAt,
      brokerPositionsSynced: this._lastSyncAt !== null,
      lastSyncAt: this._lastSyncAt,
    }
  }

  getRecentScans(limit: number = 20): ScanResult[] {
    return this._recentScans.slice(-limit)
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    if (this._running) {
      return { success: true }
    }

    // Load config from DB
    await this.loadConfigFromDb()

    if (!this.config.enabled) {
      // Auto-enable when explicitly starting
      this.config.enabled = true
      await this.persistConfigToDb()
    }

    // Check MT5 connection
    if (!mt5Connection.isConnected()) {
      this._lastError = 'MT5 not connected. Start the MT5 connection first.'
      logger.warn('AUTO_TRADING', 'Cannot start: MT5 not connected')
      return { success: false, error: this._lastError }
    }

    this._running = true
    this._startedAt = new Date()
    this._lastError = null

    // Start scanning loop
    this.scheduleNextScan()

    // Start periodic position sync
    this._syncTimer = setInterval(
      () => this.syncBrokerPositions(),
      this.config.positionSyncIntervalMs,
    )

    logger.info('AUTO_TRADING', 'Auto-trading loop STARTED', {
      metadata: {
        mode: this.config.mode,
        scanIntervalMs: this.config.scanIntervalMs,
        watchlist: this.config.watchlist,
        maxOpenPositions: this.config.maxOpenPositions,
      },
    })

    return { success: true }
  }

  async stop(): Promise<void> {
    this._running = false

    if (this._scanTimer) {
      clearTimeout(this._scanTimer)
      this._scanTimer = null
    }

    if (this._syncTimer) {
      clearInterval(this._syncTimer)
      this._syncTimer = null
    }

    logger.info('AUTO_TRADING', 'Auto-trading loop STOPPED', {
      metadata: {
        totalScans: this._scanCount,
        tradesOpened: this._tradesOpened,
        tradesRejected: this._tradesRejected,
        tradesClosedByAI: this._tradesClosedByAI,
        uptimeSeconds: this._startedAt
          ? Math.floor((Date.now() - this._startedAt.getTime()) / 1000)
          : 0,
      },
    })
  }

  async updateConfig(updates: Partial<AutoTradingConfig>): Promise<AutoTradingConfig> {
    // Validate watchlist symbols
    if (updates.watchlist) {
      for (const symbol of updates.watchlist) {
        const mapping = validateSymbol(symbol)
        if (!mapping) {
          throw new Error(`Unknown symbol: ${symbol}`)
        }
      }
    }

    // Validate strategy IDs
    if (updates.enabledStrategies) {
      for (const id of updates.enabledStrategies) {
        if (!STRATEGY_REGISTRY.find(s => s.id === id)) {
          throw new Error(`Unknown strategy: ${id}`)
        }
      }
    }

    if (updates.strategyId && updates.strategyId !== 'ai-composite') {
      if (!STRATEGY_REGISTRY.find(s => s.id === updates.strategyId)) {
        throw new Error(`Unknown strategy: ${updates.strategyId}`)
      }
    }

    Object.assign(this.config, updates)
    await this.persistConfigToDb()

    logger.info('AUTO_TRADING', 'Config updated', {
      metadata: updates,
    })

    return { ...this.config }
  }

  // ---- Private: Scan Loop ----

  private scheduleNextScan(): void {
    if (!this._running) return

    this._scanTimer = setTimeout(
      () => this.runScanCycle(),
      this.config.scanIntervalMs,
    )
  }

  private async runScanCycle(): Promise<void> {
    if (!this._running) return
    if (this._isScanning) {
      // Previous scan still running, skip this cycle
      this.scheduleNextScan()
      return
    }

    this._isScanning = true
    const scanStart = Date.now()

    try {
      // Pre-checks
      if (!this.config.enabled) {
        logger.info('AUTO_TRADING', 'Scan skipped: auto-trading disabled')
        this.scheduleNextScan()
        return
      }

      if (!isMarketOpen()) {
        const phase = getTradingPhase()
        logger.info('AUTO_TRADING', `Scan skipped: market not open (phase: ${phase})`)
        this.scheduleNextScan()
        return
      }

      if (!mt5Connection.isConnected()) {
        this._lastError = 'MT5 disconnected during scan'
        logger.warn('AUTO_TRADING', 'Scan skipped: MT5 not connected')
        this.scheduleNextScan()
        return
      }

      // Check current open positions
      const openPositions = await db.trade.findMany({ where: { status: 'OPEN' } })
      if (openPositions.length >= this.config.maxOpenPositions) {
        logger.info('AUTO_TRADING', `Scan skipped: max positions reached (${openPositions.length}/${this.config.maxOpenPositions})`)
        this.scheduleNextScan()
        return
      }

      // Filter watchlist to symbols not already open
      const openSymbols = new Set(openPositions.map(p => p.symbol))
      const symbolsToScan = this.config.watchlist.filter(s => !openSymbols.has(s))

      if (symbolsToScan.length === 0) {
        logger.info('AUTO_TRADING', 'Scan skipped: all watchlist symbols already have open positions')
        this.scheduleNextScan()
        return
      }

      // Run AI decisions
      this._currentDecisions = []

      for (const symbol of symbolsToScan) {
        try {
          const decision = this.config.mode === 'MULTI_STRATEGY'
            ? await makeMultiStrategyDecision({
                symbol,
                timeframe: this.config.timeframe,
                enabledStrategies: this.config.enabledStrategies.length > 0
                  ? this.config.enabledStrategies
                  : undefined,
              })
            : await makeDecision(
                symbol,
                this.config.timeframe,
                undefined,
                this.config.adaptiveLearning,
              )

          this._currentDecisions.push(decision)

          // Process the decision
          const scanResult = await this.processDecision(decision, openPositions)
          this._recentScans.push(scanResult)

          // If we've opened a position, check if we've hit the max
          if (scanResult.actionTaken === 'EXECUTED') {
            // Re-count from DB to be accurate
            const currentOpen = await db.trade.count({ where: { status: 'OPEN' } })
            if (currentOpen >= this.config.maxOpenPositions) {
              logger.info('AUTO_TRADING', `Max positions reached after opening trade, stopping scan`)
              break
            }
          }

          // Handle CLOSE_ALL immediately
          if (decision.decision === 'CLOSE_ALL') {
            logger.warn('AUTO_TRADING', `CLOSE_ALL decision for ${symbol}, closing all positions`)
            await this.handleCloseAll(decision)
            break
          }

          // Handle REDUCE
          if (decision.decision === 'REDUCE') {
            await this.handleReduce(decision, openPositions)
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          this._lastError = errMsg
          logger.error('AUTO_TRADING', `Error scanning ${symbol}`, {
            symbol,
            details: errMsg,
          })
          this._recentScans.push({
            timestamp: new Date(),
            symbol,
            decision: {
              symbol,
              decision: 'HOLD',
              confidence: 0,
              reasoning: `Error: ${errMsg}`,
              technicalFactors: defaultTechnicalFactors(),
              newsFactors: defaultNewsFactors(),
              sentimentFactors: defaultSentimentFactors(),
              riskFactors: defaultRiskFactors(),
              suggestedLotSize: 0,
              suggestedSl: 0,
              suggestedTp: 0,
              strategyUsed: 'AUTO_TRADING',
              timeframe: this.config.timeframe,
              signalSources: [],
              volatilityMultiplier: 1,
              llmEnhancement: null,
              createdAt: new Date(),
            },
            actionTaken: 'ERROR',
            actionDetails: errMsg,
          })
        }
      }

      this._scanCount++
      this._lastScanAt = new Date()
      this._lastError = null

      const scanDuration = Date.now() - scanStart
      logger.info('AUTO_TRADING', `Scan cycle #${this._scanCount} completed`, {
        metadata: {
          scanDurationMs: scanDuration,
          symbolsScanned: symbolsToScan.length,
          decisions: this._currentDecisions.map(d => `${d.symbol}:${d.decision}(${d.confidence}%)`).join(', '),
        },
      })

      // Trim recent scans to last 100
      if (this._recentScans.length > 100) {
        this._recentScans = this._recentScans.slice(-100)
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this._lastError = errMsg
      logger.error('AUTO_TRADING', 'Scan cycle failed', { details: errMsg })
    } finally {
      this._isScanning = false
      this.scheduleNextScan()
    }
  }

  private async processDecision(
    decision: AiDecision,
    _openPositions: TradeRecord[],
  ): Promise<ScanResult> {
    const { symbol, decision: dec, confidence, suggestedLotSize, suggestedSl, suggestedTp } = decision

    // HOLD / SKIP → no action
    if (dec === 'HOLD' || dec === 'SKIP') {
      return {
        timestamp: new Date(),
        symbol,
        decision,
        actionTaken: 'SKIPPED',
        actionDetails: dec === 'SKIP' ? decision.reasoning : 'No actionable signal',
      }
    }

    // REDUCE and CLOSE_ALL handled by caller
    if (dec === 'REDUCE' || dec === 'CLOSE_ALL') {
      return {
        timestamp: new Date(),
        symbol,
        decision,
        actionTaken: dec === 'CLOSE_ALL' ? 'CLOSE_ALL' : 'REDUCE',
        actionDetails: decision.reasoning,
      }
    }

    // BUY or SELL → run risk check then execute
    if (dec !== 'BUY' && dec !== 'SELL') {
      return {
        timestamp: new Date(),
        symbol,
        decision,
        actionTaken: 'SKIPPED',
        actionDetails: `Unexpected decision type: ${dec}`,
      }
    }

    // Get current price
    let currentPrice = suggestedSl && suggestedTp
      ? (suggestedSl + suggestedTp) / 2
      : 0

    try {
      const prices = await getPricesFromBridge()
      const symbolPrices = prices[symbol]
      if (symbolPrices) {
        currentPrice = dec === 'BUY' ? symbolPrices.ask : symbolPrices.bid
      }
    } catch {
      // Use estimated price from decision factors
      const mid = (decision.technicalFactors.supportLevel + decision.technicalFactors.resistanceLevel) / 2
      if (mid > 0) currentPrice = mid
    }

    if (currentPrice <= 0) {
      return {
        timestamp: new Date(),
        symbol,
        decision,
        actionTaken: 'SKIPPED',
        actionDetails: 'Could not determine current price',
      }
    }

    // Run pre-trade risk check
    try {
      const riskCheck = await preTradeCheck({
        symbol,
        direction: dec,
        lotSize: suggestedLotSize,
        entryPrice: currentPrice,
        sl: suggestedSl,
        tp: suggestedTp,
        strategy: decision.strategyUsed,
        aiConfidence: confidence,
      })

      if (!riskCheck.approved) {
        this._tradesRejected++
        return {
          timestamp: new Date(),
          symbol,
          decision,
          actionTaken: 'REJECTED_RISK',
          actionDetails: riskCheck.reason || 'Risk check failed',
        }
      }

      // Use risk-adjusted lot size if suggested
      const finalLotSize = riskCheck.suggestedLotSize > 0
        ? Math.min(riskCheck.suggestedLotSize, suggestedLotSize)
        : suggestedLotSize

      // Execute the trade
      const result = await executeTrade({
        symbol,
        direction: dec,
        lotSize: finalLotSize,
        price: currentPrice,
        sl: suggestedSl,
        tp: suggestedTp,
        strategy: decision.strategyUsed,
        timeframe: decision.timeframe,
        marketCond: decision.technicalFactors.trendDirection,
        aiConfidence: confidence,
        comment: `AUTO-${decision.strategyUsed}-${Date.now()}`,
      })

      if (result.success) {
        this._tradesOpened++
        return {
          timestamp: new Date(),
          symbol,
          decision,
          actionTaken: 'EXECUTED',
          actionDetails: `Trade opened: ${dec} ${symbol} @ ${currentPrice} lot=${finalLotSize} SL=${suggestedSl} TP=${suggestedTp}`,
          tradeId: result.trade?.id,
        }
      } else {
        this._tradesRejected++
        return {
          timestamp: new Date(),
          symbol,
          decision,
          actionTaken: 'REJECTED_RISK',
          actionDetails: result.error || 'Execution failed',
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this._tradesRejected++
      return {
        timestamp: new Date(),
        symbol,
        decision,
        actionTaken: 'ERROR',
        actionDetails: errMsg,
      }
    }
  }

  private async handleCloseAll(decision: AiDecision): Promise<void> {
    try {
      await emergencyCloseAll('AUTO_TRADING_CLOSE_ALL')
      this._tradesClosedByAI += decision.riskFactors.openPositions
      logger.warn('AUTO_TRADING', 'CLOSE_ALL executed', {
        metadata: {
          reason: decision.reasoning,
          riskScore: decision.riskFactors.riskScore,
          positionsClosed: decision.riskFactors.openPositions,
        },
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this._lastError = `CLOSE_ALL failed: ${errMsg}`
      logger.error('AUTO_TRADING', 'CLOSE_ALL failed', { details: errMsg })
    }
  }

  private async handleReduce(decision: AiDecision, openPositions: TradeRecord[]): Promise<void> {
    // Find the weakest position (lowest PnL or lowest confidence) and close it
    if (openPositions.length === 0) return

    try {
      // Sort by PnL ascending (worst first)
      const sorted = [...openPositions].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))
      const weakest = sorted[0]

      if (weakest && weakest.id) {
        await closeTrade(weakest.id, `AI REDUCE signal: ${decision.reasoning}`)
        this._tradesClosedByAI++
        logger.info('AUTO_TRADING', `Reduced position: closed ${weakest.symbol}`, {
          symbol: weakest.symbol,
          tradeId: weakest.id,
          metadata: { pnl: weakest.pnl, reason: decision.reasoning },
        })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this._lastError = `REDUCE failed: ${errMsg}`
      logger.error('AUTO_TRADING', 'REDUCE failed', { details: errMsg })
    }
  }

  // ---- Position Sync ----

  private async syncBrokerPositions(): Promise<void> {
    if (!this._running) return
    if (!mt5Connection.isConnected()) return

    try {
      const brokerPositions = await getPositionsFromBridge()
      this._lastSyncAt = new Date()

      logger.info('AUTO_TRADING', `Broker position sync: ${brokerPositions.length} positions`, {
        metadata: { brokerPositionCount: brokerPositions.length },
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.warn('AUTO_TRADING', `Position sync failed: ${errMsg}`)
    }
  }

  // ---- Config Persistence ----

  private async loadConfigFromDb(): Promise<void> {
    try {
      const sysConfig = await db.systemConfig.findUnique({
        where: { key: '__auto_trading_config__' },
      })

      if (sysConfig?.value) {
        const parsed = JSON.parse(sysConfig.value) as Partial<AutoTradingConfig>
        Object.assign(this.config, parsed)
      }
    } catch (err) {
      logger.warn('AUTO_TRADING', 'Failed to load config from DB, using defaults', {
        details: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async persistConfigToDb(): Promise<void> {
    try {
      await db.systemConfig.upsert({
        where: { key: '__auto_trading_config__' },
        update: { value: JSON.stringify(this.config) },
        create: { key: '__auto_trading_config__', value: JSON.stringify(this.config) },
      })
    } catch (err) {
      logger.error('AUTO_TRADING', 'Failed to persist config to DB', {
        details: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export { AutoTradingLoop }
