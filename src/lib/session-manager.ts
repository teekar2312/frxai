/**
 * Unified Session Manager — Phase 5
 * =================================
 * Centralizes all session management: IDX intraday sessions, global forex
 * sessions, session transitions, and session performance tracking.
 *
 * Eliminates duplication between:
 *   - src/app/api/sessions/route.ts (was hardcoded)
 *   - src/components/trading/TradingSessions.tsx (was hardcoded)
 *   - src/lib/mt5-connection.ts (IDX trading phase logic — now re-exported here)
 *   - src/lib/money-management.ts (session risk limits — now tracked here)
 */

import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'
import { getTradingPhase, isMarketOpen, type TradingPhase } from '@/lib/mt5-connection'

// ============================================
// TYPES & INTERFACES
// ============================================

/** Global forex session definition (shared source of truth) */
export interface ForexSession {
  name: string
  city: string
  timezone: string
  openHourUtc: number
  closeHourUtc: number
  color: string
  colorLight: string
  crossesMidnight: boolean
}

/** Forex session with runtime status */
export interface ForexSessionStatus extends ForexSession {
  isActive: boolean
  opensIn?: number
  closesIn?: number
}

/** Session overlap definition */
export interface SessionOverlap {
  name: string
  sessions: string[]
  startHourUtc: number
  endHourUtc: number
  color: string
  isActive: boolean
  description: string
}

/** IDX sub-session type */
export type IdxSubSession = 'MORNING' | 'AFTERNOON' | 'LUNCH' | 'PRE_OPEN' | 'PRE_CLOSE' | 'AFTER_HOURS'

/** Session transition event */
export interface SessionTransition {
  sessionType: string
  fromPhase: string
  toPhase: string
  eventAction: string
  timestamp: Date
  details?: string
}

/** Session state snapshot */
export interface SessionState {
  idxForePhase: TradingPhase
  idxSubSession: IdxSubSession
  idxIsOpen: boolean
  idxSessionName: string
  forexSessions: ForexSessionStatus[]
  overlaps: SessionOverlap[]
  activeForexSessions: string[]
  activeOverlaps: string[]
  isWeekend: boolean
  currentUtcTime: string
  utcHour: number
  utcMinute: number
  recommendation: string
  timeToNextPhase: number // seconds until next phase transition
  nextPhase: TradingPhase
}

/** Session performance record */
export interface SessionPerformanceRecord {
  date: string
  sessionType: string
  tradesOpened: number
  tradesClosed: number
  winTrades: number
  lossTrades: number
  pnl: number
  winRate: number
  avgPnl: number
  bestTrade: number
  worstTrade: number
}

/** Session risk budget */
export interface SessionRiskBudget {
  sessionType: IdxSubSession
  totalBudget: number // max loss allowed this session
  usedBudget: number // current session loss
  remainingBudget: number
  usedPct: number
  isLimitReached: boolean
  tradesThisSession: number
}

// ============================================
// FOREX SESSION DEFINITIONS (single source of truth)
// ============================================

export const FOREX_SESSIONS: ForexSession[] = [
  {
    name: 'Sydney',
    city: 'Sydney',
    timezone: 'AEST (UTC+10)',
    openHourUtc: 21,
    closeHourUtc: 6,
    color: '#8b5cf6',
    colorLight: '#c4b5fd',
    crossesMidnight: true,
  },
  {
    name: 'Tokyo',
    city: 'Tokyo',
    timezone: 'JST (UTC+9)',
    openHourUtc: 0,
    closeHourUtc: 9,
    color: '#f59e0b',
    colorLight: '#fcd34d',
    crossesMidnight: false,
  },
  {
    name: 'London',
    city: 'London',
    timezone: 'GMT (UTC+0)',
    openHourUtc: 7,
    closeHourUtc: 16,
    color: '#10b981',
    colorLight: '#6ee7b7',
    crossesMidnight: false,
  },
  {
    name: 'New York',
    city: 'New York',
    timezone: 'EST (UTC-5)',
    openHourUtc: 12,
    closeHourUtc: 21,
    color: '#ef4444',
    colorLight: '#fca5a5',
    crossesMidnight: false,
  },
]

export const FOREX_OVERLAPS: Omit<SessionOverlap, 'isActive'>[] = [
  {
    name: 'Sydney-Tokyo',
    sessions: ['Sydney', 'Tokyo'],
    startHourUtc: 21,
    endHourUtc: 9,
    color: '#f97316',
    description: 'Asian session overlap',
  },
  {
    name: 'Tokyo-London',
    sessions: ['Tokyo', 'London'],
    startHourUtc: 7,
    endHourUtc: 9,
    color: '#f97316',
    description: 'Asian-European transition',
  },
  {
    name: 'New York - London',
    sessions: ['London', 'New York'],
    startHourUtc: 12,
    endHourUtc: 16,
    color: '#ec4899',
    description: 'Highest liquidity overlap',
  },
]

// ============================================
// IDX SESSION DEFINITIONS (WIB = UTC+7)
// ============================================

/** IDX session boundaries in WIB (matches PHASE_BOUNDARIES_UTC in mt5-connection.ts)
 *  Pre-market: 09:00-09:05 WIB
 *  Session 1:  09:05-11:30 WIB
 *  Lunch:     11:30-13:00 WIB
 *  Session 2:  13:00-16:15 WIB
 *  Post-close: 16:15-17:00 WIB
 */
export const IDX_SESSIONS_WIB = {
  preOpenStart: { hour: 9, minute: 0 },       // 09:00 WIB — pre-market order queuing
  morningOpen: { hour: 9, minute: 5 },         // 09:05 WIB — Session 1 open
  preCloseStart: { hour: 11, minute: 29 },     // 11:29 WIB — 1 min before Session 1 close
  preCloseEnd: { hour: 11, minute: 30 },       // 11:30 WIB — Session 1 close / lunch start
  afternoonOpen: { hour: 13, minute: 0 },      // 13:00 WIB — Session 2 open
  marketClose: { hour: 16, minute: 15 },       // 16:15 WIB — market close
  postCloseEnd: { hour: 17, minute: 0 },       // 17:00 WIB — post-close period end
} as const

/** Map TradingPhase to IDX sub-session */
export function getIdxSubSession(phase: TradingPhase): IdxSubSession {
  switch (phase) {
    case 'PRE_OPEN':
      return 'PRE_OPEN'
    case 'OPEN': {
      // Determine if morning or afternoon by current UTC time
      const utcHour = new Date().getUTCHours()
      // Morning: 02:05-04:30 UTC = 09:05-11:30 WIB
      // Afternoon: 06:00-09:15 UTC = 13:00-16:15 WIB
      return utcHour < 5 ? 'MORNING' : 'AFTERNOON'
    }
    case 'PRE_CLOSE':
      return 'PRE_CLOSE'
    case 'CLOSED':
      return 'LUNCH'
    case 'AFTER_HOURS':
      return 'AFTER_HOURS'
  }
}

/** Human-readable session name */
export function getIdxSessionName(phase: TradingPhase): string {
  switch (phase) {
    case 'PRE_OPEN': return 'Pre-Opening'
    case 'OPEN': {
      const utcHour = new Date().getUTCHours()
      return utcHour < 5 ? 'Morning Session' : 'Afternoon Session'
    }
    case 'PRE_CLOSE': return 'Pre-Close'
    case 'CLOSED': return 'Lunch Break'
    case 'AFTER_HOURS': return 'After Hours'
  }
}

// ============================================
// FOREX SESSION STATUS CALCULATION
// ============================================

function getForexSessionStatus(session: ForexSession, utcHour: number): ForexSessionStatus {
  const isActive = session.crossesMidnight
    ? (utcHour >= session.openHourUtc || utcHour < session.closeHourUtc)
    : (utcHour >= session.openHourUtc && utcHour < session.closeHourUtc)

  let closesIn: number | undefined
  let opensIn: number | undefined

  if (isActive) {
    if (session.crossesMidnight) {
      closesIn = utcHour >= session.openHourUtc
        ? (24 - utcHour + session.closeHourUtc)
        : session.closeHourUtc - utcHour
    } else {
      closesIn = session.closeHourUtc - utcHour
    }
  } else {
    opensIn = session.crossesMidnight
      ? (session.openHourUtc > utcHour ? session.openHourUtc - utcHour : (24 - utcHour + session.openHourUtc))
      : session.openHourUtc - utcHour
  }

  return {
    ...session,
    isActive,
    opensIn: opensIn && opensIn > 0 ? opensIn : undefined,
    closesIn: closesIn && closesIn > 0 ? closesIn : undefined,
  }
}

// ============================================
// TIME TO NEXT PHASE CALCULATION
// ============================================

function wibToUtcDecimal(wibHour: number, wibMinute: number = 0): number {
  let utcHour = wibHour - 7
  if (utcHour < 0) utcHour += 24
  return utcHour + wibMinute / 60
}

function getNextPhaseTransition(now: Date): { nextPhase: TradingPhase; secondsUntil: number } {
  const utcDecimal = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600

  const transitions: Array<{ phase: TradingPhase; utcDecimal: number }> = [
    { phase: 'PRE_OPEN', utcDecimal: wibToUtcDecimal(9, 0) },
    { phase: 'OPEN', utcDecimal: wibToUtcDecimal(9, 5) },
    { phase: 'PRE_CLOSE', utcDecimal: wibToUtcDecimal(11, 29) },
    { phase: 'CLOSED', utcDecimal: wibToUtcDecimal(11, 30) },
    { phase: 'OPEN', utcDecimal: wibToUtcDecimal(13, 0) },
    { phase: 'AFTER_HOURS', utcDecimal: wibToUtcDecimal(16, 15) },
  ]

  // Find the next transition that is in the future
  let nextTransition: { phase: TradingPhase; utcDecimal: number } | null = null

  for (const t of transitions) {
    if (t.utcDecimal > utcDecimal) {
      nextTransition = t
      break
    }
  }

  // If no transition found today, next is tomorrow's PRE_OPEN
  if (!nextTransition) {
    const nextDayPreOpen = wibToUtcDecimal(9, 0) + 24
    const secondsUntil = (nextDayPreOpen - utcDecimal) * 3600
    return { nextPhase: 'PRE_OPEN', secondsUntil: Math.max(0, Math.round(secondsUntil)) }
  }

  const secondsUntil = (nextTransition.utcDecimal - utcDecimal) * 3600
  return { nextPhase: nextTransition.phase, secondsUntil: Math.max(0, Math.round(secondsUntil)) }
}

// ============================================
// SESSION MANAGER (main class)
// ============================================

/** Track the last known phase to detect transitions */
let _lastKnownPhase: TradingPhase | null = null
let _lastPhaseCheckTime: Date | null = null

/**
 * Get the complete session state for the current moment.
 * This is the primary function that should be called by both API routes and the UI.
 */
export function getSessionState(now?: Date): SessionState {
  const d = now || new Date()
  const utcHour = d.getUTCHours()
  const utcMinute = d.getUTCMinutes()
  const dayOfWeek = d.getUTCDay()
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

  // IDX phase
  const idxPhase = getTradingPhase(d)
  const idxSubSession = getIdxSubSession(idxPhase)
  const idxSessionName = getIdxSessionName(idxPhase)
  const idxIsOpen = isMarketOpen(d)

  // Forex sessions
  const forexSessions = FOREX_SESSIONS.map(s => getForexSessionStatus(s, utcHour))

  // Overlaps
  const overlaps: SessionOverlap[] = FOREX_OVERLAPS.map(o => {
    const isOverlapActive = o.startHourUtc > o.endHourUtc
      ? (utcHour >= o.startHourUtc || utcHour < o.endHourUtc)
      : (utcHour >= o.startHourUtc && utcHour < o.endHourUtc)
    return { ...o, isActive: isOverlapActive }
  })

  const activeForexSessions = forexSessions.filter(s => s.isActive).map(s => s.name)
  const activeOverlaps = overlaps.filter(o => o.isActive).map(o => o.name)

  // Recommendation
  let recommendation: string
  if (isWeekend) {
    recommendation = 'Market is closed for the weekend'
  } else if (!idxIsOpen && activeForexSessions.length === 0) {
    recommendation = 'IDX closed — No active forex sessions'
  } else if (!idxIsOpen) {
    recommendation = `IDX ${idxSessionName} — Forex: ${activeForexSessions.join(', ')}`
  } else {
    const forexPart = activeForexSessions.length > 0
      ? ` | Forex: ${activeForexSessions.join(', ')}`
      : ''
    recommendation = `IDX ${idxSessionName} (Active)${forexPart}`
  }

  // Time to next phase
  const { nextPhase, secondsUntil: timeToNextPhase } = getNextPhaseTransition(d)

  return {
    idxForePhase: idxPhase,
    idxSubSession,
    idxIsOpen,
    idxSessionName,
    forexSessions,
    overlaps,
    activeForexSessions,
    activeOverlaps,
    isWeekend,
    currentUtcTime: d.toISOString(),
    utcHour,
    utcMinute,
    recommendation,
    timeToNextPhase,
    nextPhase,
  }
}

/**
 * Check for and record IDX session phase transitions.
 * Should be called periodically (e.g., every 5 seconds).
 * Returns the transition if one occurred, null otherwise.
 */
export async function checkAndRecordTransition(now?: Date): Promise<SessionTransition | null> {
  const d = now || new Date()
  const currentPhase = getTradingPhase(d)

  if (_lastKnownPhase === null) {
    _lastKnownPhase = currentPhase
    _lastPhaseCheckTime = d
    return null
  }

  if (currentPhase === _lastKnownPhase) {
    return null
  }

  const fromPhase = _lastKnownPhase
  const toPhase = currentPhase
  _lastKnownPhase = currentPhase
  _lastPhaseCheckTime = d

  // Determine event action
  let eventAction: string
  let sessionType: string
  let details: string

  if (toPhase === 'OPEN' && (fromPhase === 'CLOSED' || fromPhase === 'PRE_OPEN' || fromPhase === 'AFTER_HOURS')) {
    eventAction = 'SESSION_OPEN'
    sessionType = d.getUTCHours() < 5 ? 'IDX_MORNING' : 'IDX_AFTERNOON'
    details = `Session opened at ${d.toISOString()}`
  } else if (toPhase === 'CLOSED' && (fromPhase === 'OPEN' || fromPhase === 'PRE_CLOSE')) {
    eventAction = 'SESSION_CLOSE'
    sessionType = 'IDX_MORNING'
    details = `Session closed at ${d.toISOString()}`
  } else if (toPhase === 'AFTER_HOURS') {
    eventAction = 'SESSION_CLOSE'
    sessionType = 'IDX_FULL'
    details = `Market closed for the day at ${d.toISOString()}`
  } else {
    eventAction = 'PHASE_TRANSITION'
    sessionType = 'IDX_FULL'
    details = `Phase changed from ${fromPhase} to ${toPhase} at ${d.toISOString()}`
  }

  const transition: SessionTransition = {
    sessionType,
    fromPhase,
    toPhase,
    eventAction,
    timestamp: d,
    details,
  }

  // Persist to DB
  try {
    await db.sessionEvent.create({
      data: {
        sessionType,
        fromPhase,
        toPhase,
        eventAction,
        details,
      },
    })

    logger.info('SESSION_MANAGER', `Phase transition: ${fromPhase} → ${toPhase}`, {
      metadata: { eventAction, sessionType, details },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('SESSION_MANAGER', `Failed to persist session event: ${msg}`)
  }

  return transition
}

/**
 * Reset the last known phase (useful for testing or after server restart).
 */
export function resetPhaseTracker(): void {
  _lastKnownPhase = null
  _lastPhaseCheckTime = null
}

// ============================================
// SESSION PERFORMANCE TRACKING
// ============================================

/**
 * Track session-level performance.
 * Call this when a trade is opened or closed within a session.
 */
export async function trackSessionPerformance(params: {
  date?: string
  sessionType?: IdxSubSession
  isClose?: boolean
  pnl?: number
}): Promise<void> {
  const now = new Date()
  const today = params.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now)
  const phase = getTradingPhase(now)
  const subSession = params.sessionType || getIdxSubSession(phase)

  // Map sub-session to performance tracking session type
  let perfSessionType: string
  if (subSession === 'MORNING') {
    perfSessionType = 'MORNING'
  } else if (subSession === 'AFTERNOON') {
    perfSessionType = 'AFTERNOON'
  } else {
    perfSessionType = 'FULL_DAY'
  }

  try {
    const existing = await db.sessionPerformance.findUnique({
      where: { date_sessionType: { date: today, sessionType: perfSessionType } },
    })

    if (existing) {
      const updates: Record<string, unknown> = {}
      if (params.isClose && params.pnl !== undefined) {
        updates.tradesClosed = existing.tradesClosed + 1
        updates.pnl = existing.pnl + params.pnl
        updates.winTrades = existing.winTrades + (params.pnl > 0 ? 1 : 0)
        updates.lossTrades = existing.lossTrades + (params.pnl <= 0 ? 1 : 0)
        const totalClosed = updates.tradesClosed as number
        updates.winRate = totalClosed > 0 ? Math.round(((updates.winTrades as number) / totalClosed) * 10000) / 100 : 0
        updates.avgPnl = totalClosed > 0 ? Math.round((updates.pnl as number / totalClosed) * 100) / 100 : 0
        updates.bestTrade = Math.max(existing.bestTrade, params.pnl)
        updates.worstTrade = Math.min(existing.worstTrade, params.pnl)
      } else if (!params.isClose) {
        updates.tradesOpened = existing.tradesOpened + 1
      }

      await db.sessionPerformance.update({
        where: { date_sessionType: { date: today, sessionType: perfSessionType } },
        data: updates,
      })
    } else {
      await db.sessionPerformance.create({
        data: {
          date: today,
          sessionType: perfSessionType,
          tradesOpened: params.isClose ? 0 : 1,
          tradesClosed: params.isClose ? 1 : 0,
          winTrades: params.isClose && params.pnl && params.pnl > 0 ? 1 : 0,
          lossTrades: params.isClose && params.pnl && params.pnl <= 0 ? 1 : 0,
          pnl: params.isClose ? (params.pnl ?? 0) : 0,
          winRate: params.isClose && params.pnl && params.pnl > 0 ? 100 : 0,
          avgPnl: params.isClose ? (params.pnl ?? 0) : 0,
          bestTrade: params.isClose ? (params.pnl ?? 0) : 0,
          worstTrade: params.isClose ? (params.pnl ?? 0) : 0,
        },
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('SESSION_MANAGER', `Failed to track session performance: ${msg}`)
  }
}

/**
 * Get session performance summary for today.
 */
export async function getTodaySessionPerformance(): Promise<{
  morning: SessionPerformanceRecord | null
  afternoon: SessionPerformanceRecord | null
  fullDay: SessionPerformanceRecord | null
}> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

  try {
    const records = await db.sessionPerformance.findMany({
      where: { date: today },
    })

    const byType = (type: string) => records.find(r => r.sessionType === type) ?? null

    return {
      morning: byType('MORNING'),
      afternoon: byType('AFTERNOON'),
      fullDay: byType('FULL_DAY'),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('SESSION_MANAGER', `Failed to get session performance: ${msg}`)
    return { morning: null, afternoon: null, fullDay: null }
  }
}

/**
 * Get recent session events (for audit/debugging).
 */
export async function getRecentSessionEvents(limit: number = 20): Promise<Array<{
  id: string
  sessionType: string
  fromPhase: string
  toPhase: string
  eventAction: string
  details: string | null
  createdAt: Date
}>> {
  try {
    return await db.sessionEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('SESSION_MANAGER', `Failed to get session events: ${msg}`)
    return []
  }
}

// ============================================
// SESSION RISK BUDGET
// ============================================

/**
 * Calculate the risk budget for the current trading session.
 * Integrates with the session risk limit from RiskConfig.
 */
export async function getSessionRiskBudget(equity: number): Promise<SessionRiskBudget> {
  const phase = getTradingPhase()
  const subSession = getIdxSubSession(phase)

  // Get session risk limit from RiskConfig
  let sessionRiskLimitPct = 1.0 // default 1% of equity
  try {
    const config = await db.riskConfig.findFirst({ where: { name: 'default' } })
    if (config) {
      sessionRiskLimitPct = config.sessionRiskLimitPct
    }
  } catch {
    // use default
  }

  const totalBudget = equity * (sessionRiskLimitPct / 100)

  // Calculate used budget (session losses from today's closed trades)
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  let usedBudget = 0
  let tradesThisSession = 0

  try {
    // Get today's trades using WIB date boundaries
    // WIB midnight (00:00 WIB) = 17:00 UTC previous day
    // WIB end-of-day (23:59:59 WIB) = 16:59:59 UTC same day
    const [y, m, d] = todayStr.split('-').map(Number)
    const todayStart = new Date(Date.UTC(y, m - 1, d - 1, 17, 0, 0, 0))  // 00:00 WIB
    const todayEnd = new Date(Date.UTC(y, m - 1, d, 16, 59, 59, 999))   // 23:59:59 WIB

    const closedTrades = await db.trade.findMany({
      where: {
        status: 'CLOSED',
        closeTime: { gte: todayStart, lte: todayEnd },
        pnl: { lt: 0 }, // only losses count against session budget
      },
    })

    usedBudget = closedTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0)
    tradesThisSession = closedTrades.length
  } catch {
    // use defaults
  }

  const remainingBudget = Math.max(0, totalBudget - usedBudget)
  const usedPct = totalBudget > 0 ? (usedBudget / totalBudget) * 100 : 0
  const isLimitReached = usedBudget >= totalBudget

  return {
    sessionType: subSession,
    totalBudget: Math.round(totalBudget * 100) / 100,
    usedBudget: Math.round(usedBudget * 100) / 100,
    remainingBudget: Math.round(remainingBudget * 100) / 100,
    usedPct: Math.round(usedPct * 100) / 100,
    isLimitReached,
    tradesThisSession,
  }
}

/**
 * Check if trading is allowed based on session rules.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export function checkSessionTradingRules(): { allowed: boolean; reason?: string } {
  const phase = getTradingPhase()

  if (phase === 'CLOSED') {
    return { allowed: false, reason: 'Market is closed (lunch break 11:30-13:00 WIB)' }
  }

  if (phase === 'AFTER_HOURS') {
    return { allowed: false, reason: 'Market is closed (after hours, opens 09:05 WIB)' }
  }

  if (phase === 'PRE_CLOSE') {
    // Allow existing position management but block new entries
    return { allowed: false, reason: 'Pre-close window — no new entries allowed' }
  }

  const dayOfWeek = new Date().getUTCDay()
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { allowed: false, reason: 'Weekend — IDX market is closed' }
  }

  return { allowed: true }
}

// ============================================
// SESSION-AWARE POSITION SIZING MULTIPLIER
// ============================================

/**
 * Get a position sizing multiplier based on session conditions.
 * Morning sessions get full size, afternoon sessions may get reduced size
 * due to lower liquidity, and pre-open gets 50% max.
 */
export function getSessionSizingMultiplier(): number {
  const phase = getTradingPhase()
  const subSession = getIdxSubSession(phase)

  switch (subSession) {
    case 'PRE_OPEN':
      return 0.5  // 50% during pre-opening auction
    case 'MORNING':
      return 1.0  // Full size in morning session
    case 'AFTERNOON':
      return 0.85 // 85% in afternoon (slightly lower liquidity)
    case 'PRE_CLOSE':
      return 0.3  // 30% near close — minimal new exposure
    case 'LUNCH':
    case 'AFTER_HOURS':
      return 0.0  // No new positions
    default:
      return 1.0
  }
}

// ============================================
// SESSION TRADING CONFIG (selectable sessions)
// ============================================

/** Individual session toggle for trading */
export interface SessionToggle {
  key: string          // e.g. 'idx_morning', 'overlap_tokyo_london'
  label: string        // Display name
  enabled: boolean     // Whether trading is allowed during this session
  type: 'idx' | 'forex' | 'overlap'
}

/** Complete session trading configuration */
export interface SessionTradingConfig {
  idxSessions: SessionToggle[]
  forexOverlaps: SessionToggle[]
  updatedAt: string
}

/** All available session options with defaults */
const DEFAULT_SESSION_CONFIG: SessionTradingConfig = {
  idxSessions: [
    { key: 'idx_morning', label: 'Morning Session (09:05-11:30 WIB)', enabled: true, type: 'idx' },
    { key: 'idx_afternoon', label: 'Afternoon Session (13:00-16:15 WIB)', enabled: true, type: 'idx' },
  ],
  forexOverlaps: [
    {
      key: 'overlap_tokyo_london',
      label: 'Overlap Tokyo - London (07:00-09:00 UTC / 14:00-16:00 WIB)',
      enabled: false,
      type: 'overlap',
    },
    {
      key: 'overlap_ny_london',
      label: 'Overlap New York - London (12:00-16:00 UTC / 19:00-23:00 WIB)',
      enabled: false,
      type: 'overlap',
    },
    {
      key: 'overlap_sydney_tokyo',
      label: 'Overlap Sydney - Tokyo (21:00-09:00 UTC / 04:00-16:00 WIB)',
      enabled: false,
      type: 'overlap',
    },
  ],
  updatedAt: new Date().toISOString(),
}

const SESSION_CONFIG_KEY = '__trading_session_config__'

/**
 * Get the current session trading configuration.
 * Returns defaults if nothing is stored in DB.
 */
export async function getSessionTradingConfig(): Promise<SessionTradingConfig> {
  try {
    const row = await db.systemConfig.findUnique({ where: { key: SESSION_CONFIG_KEY } })
    if (row) {
      const parsed = JSON.parse(row.value) as SessionTradingConfig
      // Merge with defaults to handle new fields added after initial save
      return {
        idxSessions: DEFAULT_SESSION_CONFIG.idxSessions.map(ds => {
          const saved = parsed.idxSessions?.find(s => s.key === ds.key)
          return saved ? { ...ds, ...saved } : ds
        }),
        forexOverlaps: DEFAULT_SESSION_CONFIG.forexOverlaps.map(ds => {
          const saved = parsed.forexOverlaps?.find(s => s.key === ds.key)
          return saved ? { ...ds, ...saved } : ds
        }),
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      }
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SESSION_CONFIG, updatedAt: new Date().toISOString() }
}

/**
 * Update the session trading configuration.
 * Accepts partial updates (only the toggles that changed).
 */
export async function updateSessionTradingConfig(
  updates: { idxSessions?: Array<{ key: string; enabled: boolean }>; forexOverlaps?: Array<{ key: string; enabled: boolean }> }
): Promise<SessionTradingConfig> {
  const current = await getSessionTradingConfig()

  // Apply IDX session updates
  if (updates.idxSessions) {
    for (const u of updates.idxSessions) {
      const target = current.idxSessions.find(s => s.key === u.key)
      if (target) target.enabled = u.enabled
    }
  }

  // Apply overlap updates
  if (updates.forexOverlaps) {
    for (const u of updates.forexOverlaps) {
      const target = current.forexOverlaps.find(s => s.key === u.key)
      if (target) target.enabled = u.enabled
    }
  }

  current.updatedAt = new Date().toISOString()

  // Persist
  try {
    await db.systemConfig.upsert({
      where: { key: SESSION_CONFIG_KEY },
      update: { value: JSON.stringify(current) },
      create: { key: SESSION_CONFIG_KEY, value: JSON.stringify(current) },
    })

    logger.info('SESSION_MANAGER', 'Session trading config updated', {
      metadata: { config: current },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('SESSION_MANAGER', `Failed to persist session config: ${msg}`)
  }

  return current
}

/**
 * Check if a specific overlap session is enabled for trading.
 */
export async function isOverlapEnabled(overlapKey: string): Promise<boolean> {
  const config = await getSessionTradingConfig()
  return config.forexOverlaps.some(o => o.key === overlapKey && o.enabled)
}

/**
 * Get all currently active (enabled + time-wise active) overlap sessions.
 */
export async function getActiveOverlapSessions(): Promise<Array<{ key: string; label: string; name: string }>> {
  const config = await getSessionTradingConfig()
  const utcHour = new Date().getUTCHours()
  const utcMinute = new Date().getUTCMinutes()

  const overlapMap: Record<string, string> = {
    overlap_tokyo_london: 'Tokyo-London',
    overlap_ny_london: 'New York - London',
    overlap_sydney_tokyo: 'Sydney-Tokyo',
  }

  const active: Array<{ key: string; label: string; name: string }> = []

  for (const overlap of config.forexOverlaps) {
    if (!overlap.enabled) continue
    const overlapDef = FOREX_OVERLAPS.find(o => o.name === overlapMap[overlap.key])
    if (!overlapDef) continue

    const isActive = overlapDef.startHourUtc > overlapDef.endHourUtc
      ? (utcHour >= overlapDef.startHourUtc || utcHour < overlapDef.endHourUtc)
      : (utcHour >= overlapDef.startHourUtc && utcHour < overlapDef.endHourUtc)

    // Check minute-level precision for Tokyo-London (07:00-09:00) and NY-London (12:00-16:00)
    if (isActive) {
      active.push({
        key: overlap.key,
        label: overlap.label,
        name: overlapDef.name,
      })
    }
  }

  return active
}

/**
 * Get the session quality score (0-100) for signal filtering.
 * Considers: time in session, forex overlap (if enabled), volatility regime.
 */
export async function getSessionQualityScoreAsync(): Promise<number> {
  const phase = getTradingPhase()
  const subSession = getIdxSubSession(phase)
  const utcHour = new Date().getUTCHours()
  const utcMinute = new Date().getUTCMinutes()
  const config = await getSessionTradingConfig()

  let score = 0

  // Base score from IDX session type
  switch (subSession) {
    case 'MORNING': score = 80; break
    case 'AFTERNOON': score = 70; break
    case 'PRE_OPEN': score = 30; break
    case 'PRE_CLOSE': score = 20; break
    default: score = 0
  }

  // Bonus for enabled forex overlap sessions (higher liquidity)
  const tokyoLondon = config.forexOverlaps.find(o => o.key === 'overlap_tokyo_london')
  const nyLondon = config.forexOverlaps.find(o => o.key === 'overlap_ny_london')
  const sydneyTokyo = config.forexOverlaps.find(o => o.key === 'overlap_sydney_tokyo')

  if (tokyoLondon?.enabled && utcHour >= 7 && utcHour < 9) {
    score += 10  // Tokyo-London overlap bonus
  }
  if (nyLondon?.enabled && utcHour >= 12 && utcHour < 16) {
    score += 15  // New York - London overlap bonus (highest liquidity)
  }
  if (sydneyTokyo?.enabled) {
    const isActive = utcHour >= 21 || utcHour < 9
    if (isActive) score += 5  // Sydney-Tokyo overlap (modest bonus)
  }

  // Penalty for first 15 minutes of session (opening volatility)
  // Morning: UTC 02:05-02:20 = WIB 09:05-09:20
  if (subSession === 'MORNING' && utcHour === 2 && utcMinute < 15) {
    score -= 10 // Opening volatility
  }
  // Afternoon: UTC 06:00-06:15 = WIB 13:00-13:15
  if (subSession === 'AFTERNOON' && utcHour === 6 && utcMinute < 15) {
    score -= 10 // Opening volatility
  }
  // Approaching close (last 30 min: UTC 08:45-09:15 = WIB 15:45-16:15)
  if (subSession === 'AFTERNOON' && utcHour >= 8 && utcMinute >= 45) {
    score -= 15
  }
  // Last 5 min urgency (UTC 09:10-09:15 = WIB 16:10-16:15)
  if (subSession === 'AFTERNOON' && utcHour >= 9 && utcMinute >= 10) {
    score -= 10
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * Synchronous version of getSessionQualityScore (uses defaults, no DB read).
 * Kept for backward compatibility with callers that don't need config-aware scoring.
 */
export function getSessionQualityScore(): number {
  const phase = getTradingPhase()
  const subSession = getIdxSubSession(phase)
  const utcHour = new Date().getUTCHours()
  const utcMinute = new Date().getUTCMinutes()

  let score = 0

  // Base score from IDX session type
  switch (subSession) {
    case 'MORNING': score = 80; break
    case 'AFTERNOON': score = 70; break
    case 'PRE_OPEN': score = 30; break
    case 'PRE_CLOSE': score = 20; break
    default: score = 0
  }

  // Bonus for forex overlap (always applied in sync version for backward compat)
  if (utcHour >= 7 && utcHour < 9) score += 10  // Tokyo-London overlap
  if (utcHour >= 12 && utcHour < 16) score += 15 // New York - London overlap

  // Penalty for first 15 minutes of session (opening volatility)
  if (subSession === 'MORNING' && utcHour === 2 && utcMinute < 15) {
    score -= 10
  }
  if (subSession === 'AFTERNOON' && utcHour === 6 && utcMinute < 15) {
    score -= 10
  }
  if (subSession === 'AFTERNOON' && utcHour >= 8 && utcMinute >= 45) {
    score -= 15
  }
  if (subSession === 'AFTERNOON' && utcHour >= 9 && utcMinute >= 10) {
    score -= 10
  }

  return Math.max(0, Math.min(100, score))
}
