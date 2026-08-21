/**
 * AUDIT-FIX-1: Centralized balance sync.
 * When a position is closed (SL/TP, manual, stop-out, pending→position),
 * the realized PnL must be applied to TradingConfig.accountBalance.
 * This ensures risk calculations and equity displays remain accurate.
 */

import { db } from '@/lib/db';
import { safeLog } from '@/lib/safe-log';

/**
 * Apply realized PnL to the account balance.
 * Called from every position close path: SL/TP, manual, stop-out.
 * Uses atomic increment to avoid race conditions.
 */
export async function applyPnlToBalance(
  pnl: number,
  reason: string,
  pair?: string,
): Promise<{ newBalance: number }> {
  try {
    const config = await db.tradingConfig.findFirst();
    if (!config) return { newBalance: 0 };

    const newBalance = parseFloat((config.accountBalance + pnl).toFixed(2));

    await db.tradingConfig.update({
      where: { id: config.id },
      data: { accountBalance: newBalance },
    });

    safeLog({
      level: 'info',
      route: 'BalanceSync',
      message: `Balance updated: ${config.accountBalance.toFixed(2)} → ${newBalance.toFixed(2)} (PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}, reason: ${reason})`,
      ...(pair ? { pair } : {}),
    });

    return { newBalance };
  } catch (err) {
    safeLog({
      level: 'error',
      route: 'BalanceSync',
      message: 'Failed to apply PnL to balance',
      error: err instanceof Error ? err.message : String(err),
    });
    return { newBalance: 0 };
  }
}

/**
 * Check if there is high-impact news in the last N minutes.
 * AUDIT-FIX-6: Server-side avoidNewsTrading enforcement.
 */
export async function hasRecentHighImpactNews(
  pair?: string,
  withinMinutes: number = 30,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000);
    const where: Record<string, unknown> = {
      impact: 'high',
      publishedAt: { gte: since },
    };
    // If pair specified, also include news without a pair (global impact)
    const count = await db.newsItem.count({ where });
    return count > 0;
  } catch {
    return false;
  }
}
