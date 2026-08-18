/**
 * CRITICAL FIX: Alert checking extracted from GET /api/alerts into standalone function.
 * Called from the finnhub route (global price polling every 5s) so alerts work
 * regardless of which tab the user is viewing.
 */

import { db } from '@/lib/db';
import type { ForexPair } from '@/lib/trading-types';
import { getCachedQuote, getCurrentMidPrice } from '@/lib/price-cache';
import { sendPriceAlertEmail } from '@/lib/email-service';
import { safeLog } from '@/lib/safe-log';

interface TriggeredAlert {
  id: string;
  pair: string;
  targetPrice: number;
  currentPrice: number;
  condition: string;
  note?: string;
}

function checkAlertCondition(
  condition: string,
  currentPrice: number,
  targetPrice: number,
  previousPrice?: number,
): boolean {
  switch (condition) {
    case 'above':
      return currentPrice > targetPrice;
    case 'below':
      return currentPrice < targetPrice;
    case 'crosses_above':
      // HIGH FIX: When no previousPrice, skip cross check (return false)
      // so we don't falsely trigger if price is already past the target.
      // The cross will be detected on the next poll cycle.
      if (previousPrice === undefined) return false;
      return previousPrice <= targetPrice && currentPrice > targetPrice;
    case 'crosses_below':
      if (previousPrice === undefined) return false;
      return previousPrice >= targetPrice && currentPrice < targetPrice;
    default:
      return false;
  }
}

async function getCurrentPrice(pair: string): Promise<number | null> {
  const cached = getCachedQuote(pair as ForexPair);
  if (cached) return cached.quote.mid;
  const result = await getCurrentMidPrice(pair);
  return result?.mid ?? null;
}

/**
 * Check all active alerts against current prices.
 * Called from the finnhub route on every price tick.
 * Returns list of newly triggered alerts (for frontend notification).
 */
export async function checkAllAlerts(): Promise<TriggeredAlert[]> {
  try {
    const activeAlerts = await db.priceAlert.findMany({
      where: { isActive: true, isTriggered: false },
    });

    if (activeAlerts.length === 0) return [];

    // Group by pair to minimize price lookups
    const pairsToCheck = [...new Set(activeAlerts.map(a => a.pair))];
    const priceCache: Record<string, number | null> = {};
    for (const pair of pairsToCheck) {
      priceCache[pair] = await getCurrentPrice(pair);
    }

    const triggered: TriggeredAlert[] = [];

    for (const alert of activeAlerts) {
      const price = priceCache[alert.pair];
      if (price === null) continue;

      const previousPrice = alert.currentPrice ?? undefined;

      if (checkAlertCondition(alert.condition, price, alert.targetPrice, previousPrice)) {
        // MEDIUM FIX: Atomic updateMany to prevent duplicate emails on concurrent requests
        const updateResult = await db.priceAlert.updateMany({
          where: { id: alert.id, isTriggered: false },
          data: {
            isTriggered: true,
            triggeredAt: new Date(),
            isActive: false,
            currentPrice: price,
          },
        });

        // Only send email/activity log if this request won the race (count > 0)
        if (updateResult.count > 0) {
          triggered.push({
            id: alert.id,
            pair: alert.pair,
            targetPrice: alert.targetPrice,
            currentPrice: price,
            condition: alert.condition,
            note: alert.note || undefined,
          });

          // Activity log
          try {
            await db.activityLog.create({
              data: {
                level: 'info',
                category: 'alert',
                message: `Price alert triggered: ${alert.pair} ${alert.condition} ${alert.targetPrice} (current: ${price})`,
                pair: alert.pair,
                metadata: JSON.stringify({ alertId: alert.id, targetPrice: alert.targetPrice, condition: alert.condition }),
              },
            });
          } catch { /* non-critical */ }

          // Email notification (if enabled)
          if (alert.emailNotify) {
            sendPriceAlertEmail(alert.pair, alert.condition, alert.targetPrice, price, alert.note)
              .then(emailSent => {
                if (!emailSent) {
                  safeLog({ level: 'warn', route: 'AlertChecker', message: `Email failed for alert ${alert.id}` });
                }
              })
              .catch(err => {
                safeLog({ level: 'warn', route: 'AlertChecker', message: `Email error for alert ${alert.id}`, error: err instanceof Error ? err.message : String(err) });
              });
          }
        }
      } else {
        // Update currentPrice for cross-condition tracking
        try {
          await db.priceAlert.update({
            where: { id: alert.id },
            data: { currentPrice: price },
          });
        } catch { /* non-critical */ }
      }
    }

    return triggered;
  } catch (error) {
    safeLog({
      level: 'error',
      route: 'AlertChecker',
      message: 'Alert check cycle failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
