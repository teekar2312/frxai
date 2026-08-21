import { NextRequest, NextResponse } from 'next/server';
import { MT5_BRIDGE_URL, BRIDGE_HEADERS } from '@/lib/mt5-config';
import { PAIR_PIP_VALUES } from '@/lib/trading-types';
import { logApiError, safeLog } from '@/lib/safe-log';
import { requireAuthForMutation } from '@/lib/api-auth';

// POST /api/mt5/trailing-stop
// Processes trailing stop for MT5 live positions.
// Reads positions from MT5 bridge, computes new SL, sends modify_order.
export async function POST(request: NextRequest) {
  // H3: Add auth check for mutation
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  try {
    // 1. Fetch open positions from MT5 bridge
    const posRes = await fetch(`${MT5_BRIDGE_URL}/api/positions`, {
      headers: BRIDGE_HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!posRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch MT5 positions' }, { status: 503 });
    }
    const mt5Positions = (await posRes.json()) as Array<{
      ticket: number;
      pair: string;
      direction: 'BUY' | 'SELL';
      entryPrice: number;
      currentPrice: number;
      stopLoss: number | null;
      takeProfit: number | null;
      pnl: number;
      pnlPips: number;
      comment: string;
      openTime: string;
    }>;

    if (!mt5Positions || mt5Positions.length === 0) {
      return NextResponse.json({ processed: 0, updated: 0 });
    }

    // 2. Fetch config for autoTrailingStop settings
    // We need DB access for this, but since this is a dedicated MT5 route,
    // we use the dynamic import to avoid circular deps
    const { db } = await import('@/lib/db');
    const config = await db.tradingConfig.findFirst();
    const autoTrailingStop = config?.autoTrailingStop ?? false;
    const configTrailingPips = config?.trailingStopPips ?? 10;

    // Only process if autoTrailingStop is enabled
    if (!autoTrailingStop) {
      return NextResponse.json({ processed: mt5Positions.length, updated: 0, reason: 'autoTrailingStop disabled' });
    }

    // 3. Process each position
    let updatedCount = 0;
    // RISK-011: Use centralized PAIR_PIP_VALUES instead of hardcoded map

    for (const pos of mt5Positions) {
      const pipConfig = PAIR_PIP_VALUES[pos.pair as keyof typeof PAIR_PIP_VALUES];
      const pipSize = pipConfig?.pipSize ?? 0.0001;
      const trailingDistance = configTrailingPips * pipSize;
      const { ticket, direction, entryPrice, currentPrice, stopLoss } = pos;

      if (!currentPrice || currentPrice <= 0) continue;

      let newSl: number | null = null;

      if (direction === 'BUY') {
        const trailingLevel = currentPrice - trailingDistance;
        if (trailingLevel > entryPrice) {
          if (stopLoss === null || trailingLevel > stopLoss) {
            const decimals = pipSize < 0.001 ? 5 : 3;
            newSl = parseFloat(trailingLevel.toFixed(decimals));
          }
        }
      } else {
        const trailingLevel = currentPrice + trailingDistance;
        if (trailingLevel < entryPrice) {
          if (stopLoss === null || trailingLevel < stopLoss) {
            const decimals = pipSize < 0.001 ? 5 : 3;
            newSl = parseFloat(trailingLevel.toFixed(decimals));
          }
        }
      }

      if (newSl === null) continue;

      // Send modify_order to MT5 bridge
      try {
        const modRes = await fetch(`${MT5_BRIDGE_URL}/api/orders/${ticket}`, {
          method: 'PATCH',
          headers: BRIDGE_HEADERS,
          body: JSON.stringify({ stopLoss: newSl }),
          signal: AbortSignal.timeout(10000),
        });
        if (modRes.ok) {
          const modData = await modRes.json();
          if (modData.success !== false) {
            updatedCount++;
            // TS-04: Log MT5 trailing stop adjustment
            try {
              await db.activityLog.create({
                data: {
                  level: 'info',
                  category: 'mt5_trailing_stop',
                  message: `MT5 Trailing stop: ${direction} ${pos.pair} #${ticket} SL ${stopLoss ?? 'none'} → ${newSl} (${configTrailingPips} pips)`,
                  pair: pos.pair,
                  metadata: JSON.stringify({ ticket, trailingPips: configTrailingPips, oldSl: stopLoss, newSl, currentPrice }),
                },
              });
            } catch { /* non-critical */ }
          }
        }
      } catch (err) {
        safeLog({
          level: 'warn',
          route: 'MT5 TrailingStop',
          message: `Failed to modify SL for #${ticket}`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ processed: mt5Positions.length, updated: updatedCount });
  } catch (error) {
    logApiError('MT5 TrailingStop', error);
    return NextResponse.json(
      { error: 'MT5 trailing stop processing failed' },
      { status: 500 },
    );
  }
}
