/*
 * Trade Execution Engine — PART 1/10: types.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 19-27, 36-121):
 *   - TYPES & ENUMS (TradeStatus, OrderType, TradeTransition, Prisma row types)
 *   - CONSTANTS (VALID_TRANSITIONS)
 *   - TRADE STATE MACHINE (validateTransition, getAllowedTransitions)
 *
 * NOTE: the module-private constants PIP_VALUE_PER_LOT / DEFAULT_ATR_ESTIMATE /
 * DEFAULT_MAX_TRAILING_ADJUSTMENTS / MIN_IMPROVEMENT_TICKS (original lines
 * 82-92) moved together with their sole consumers (pnl/pipeline,
 * partial-close, trailing-stop) to keep the public export set unchanged.
 */

import { Prisma } from '@prisma/client'

/**
 * Prisma Trade row type (replaces former `any` annotations in this module).
 * `{}` is Prisma's canonical "no extra selection" type argument.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type TradeRecord = Prisma.TradeGetPayload<{}>
/** Prisma PendingOrder row type (same `{}` convention). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type PendingOrderRecord = Prisma.PendingOrderGetPayload<{}>

// ============================================
// TYPES & ENUMS
// ============================================

export type TradeStatus =
  | 'PENDING'
  | 'OPEN'
  | 'PARTIAL_FILLED'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELLED'

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT'

/** A single valid transition between trade statuses. */
export interface TradeTransition {
  from: TradeStatus
  to: TradeStatus
  event: string
}

// ============================================
// CONSTANTS
// ============================================

/** The complete set of valid trade state transitions. */
export const VALID_TRANSITIONS: TradeTransition[] = [
  // Order lifecycle
  { from: 'PENDING', to: 'OPEN', event: 'ORDER_FILLED' },
  { from: 'PENDING', to: 'REJECTED', event: 'RISK_BROKER_REJECTION' },
  { from: 'PENDING', to: 'CANCELLED', event: 'USER_SYSTEM_CANCEL' },

  // Open position lifecycle
  { from: 'OPEN', to: 'CLOSED', event: 'SL_TP_MANUAL_CLOSE' },
  { from: 'OPEN', to: 'PARTIAL_FILLED', event: 'PARTIAL_CLOSE_EXECUTED' },

  // Partial-filled lifecycle
  { from: 'PARTIAL_FILLED', to: 'CLOSED', event: 'REMAINING_CLOSED' },
  { from: 'PARTIAL_FILLED', to: 'PARTIAL_FILLED', event: 'ANOTHER_PARTIAL' },

  // Emergency — any state can be cancelled
  { from: 'PENDING', to: 'CANCELLED', event: 'EMERGENCY_CLOSE_ALL' },
  { from: 'OPEN', to: 'CANCELLED', event: 'EMERGENCY_CLOSE_ALL' },
  { from: 'PARTIAL_FILLED', to: 'CANCELLED', event: 'EMERGENCY_CLOSE_ALL' },
]

// ============================================
// TRADE STATE MACHINE
// ============================================

/**
 * Validate whether a transition from `from` to `to` is allowed.
 * Returns true if the transition exists in VALID_TRANSITIONS.
 */
export function validateTransition(
  from: TradeStatus,
  to: TradeStatus,
): boolean {
  return VALID_TRANSITIONS.some((t) => t.from === from && t.to === to)
}

/**
 * Get all valid next states from a given trade status.
 * Returns an array of TradeStatus values that are reachable.
 */
export function getAllowedTransitions(from: TradeStatus): TradeStatus[] {
  const seen = new Set<TradeStatus>()
  for (const t of VALID_TRANSITIONS) {
    if (t.from === from && !seen.has(t.to)) {
      seen.add(t.to)
    }
  }
  return Array.from(seen)
}
