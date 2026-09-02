// Centralized configuration constants for the trading system

import { db } from './db'

export const BASE_BALANCE = Number(process.env.BASE_BALANCE) || 10000
export const LEVERAGE = 25 // FINEX Indonesia leverage 1:25
export const COMMISSION_PER_LOT = 1 // FINEX Indonesia commission $1/lot
export const PIP_VALUE_PER_LOT = 100_000 // Pip value per standard lot

/**
 * Get current account equity by aggregating BASE_BALANCE with all trade P&L.
 * Includes both realized (CLOSED) and unrealized (OPEN/PARTIAL_FILLED) P&L.
 */
export async function getCurrentEquity(): Promise<number> {
  try {
    const trades = await db.trade.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL_FILLED', 'CLOSED'] } },
      select: { pnl: true },
    })
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0)
    return Math.round((BASE_BALANCE + totalPnl) * 100) / 100
  } catch {
    return BASE_BALANCE
  }
}
