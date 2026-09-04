/**
 * Shared database query helpers.
 *
 * Extracts query patterns that were duplicated across API routes and
 * lib modules. All helpers resolve the Prisma client through the DI
 * seam (getDb()) so they are unit-testable with an injected fake —
 * production behavior is identical to importing db directly.
 */

import { BASE_BALANCE } from './config'
import { getDb } from './di'

/** Trade statuses whose P&L counts toward account equity. */
export const EQUITY_TRADE_STATUSES = ['OPEN', 'PARTIAL_FILLED', 'CLOSED'] as const

/**
 * Current account equity = BASE_BALANCE + realized + unrealized P&L
 * across all OPEN / PARTIAL_FILLED / CLOSED trades (single aggregate
 * query — the pattern previously inlined in /api/trades POST).
 */
export async function getAccountEquity(): Promise<number> {
  const agg = await getDb().trade.aggregate({
    _sum: { pnl: true },
    where: { status: { in: [...EQUITY_TRADE_STATUSES] } },
  })
  return BASE_BALANCE + (agg._sum.pnl ?? 0)
}
