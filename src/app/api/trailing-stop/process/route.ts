import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair } from '@/lib/trading-types';
import { PAIR_PIP_VALUES } from '@/lib/trading-types';
import { logApiError } from '@/lib/safe-log';
import { getCachedQuote } from '@/lib/price-cache';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';

// POST /api/trailing-stop/process
// Trailing stop execution engine — called periodically by the frontend or scheduler.
// Processes all open simulation positions that have trailingStop > 0.
// Also auto-applies trailing stop to positions opened when autoTrailingStop is on.
// Updates currentPrice from price cache, computes new SL, and updates the position.
export async function POST(request: NextRequest) {
  // Skip rate limit for internal scheduler calls
  const isInternalCall = request.headers.get('x-internal-call') === 'true';
  if (!isInternalCall) {
    const rateCheck = checkRateLimit(clientIp(request), 'trade');
    if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  }

  try {
    // 1. Fetch config
    const config = await db.tradingConfig.findFirst();
    const autoTrailingStop = config?.autoTrailingStop ?? false;
    const configTrailingPips = config?.trailingStopPips ?? 10;

    if (!autoTrailingStop) {
      // Still process positions with explicit trailing stop set manually
    }

    // 2. Fetch all open positions that should have trailing stop
    // Includes: positions with explicit trailingStop > 0, AND
    // when autoTrailingStop is on, all open positions
    const positions = await db.tradingPosition.findMany({
      where: { status: 'open' },
    });

    if (positions.length === 0) {
      return NextResponse.json({ processed: 0, updated: 0, pricesUpdated: 0 });
    }

    let updatedCount = 0;
    let pricesUpdated = 0;
    const results: Array<{ id: string; pair: string; oldSl: number | null; newSl: number; reason: string }> = [];

    for (const pos of positions) {
      const pair = pos.pair as ForexPair;
      const pipConfig = PAIR_PIP_VALUES[pair] || { standard: 10, pipSize: 0.0001 };
      const pipSize = pipConfig.pipSize;

      // Determine if this position should have trailing stop
      const trailingPips = pos.trailingStop ?? (autoTrailingStop ? configTrailingPips : 0);
      if (trailingPips <= 0) continue;

      // 3. Update currentPrice from price cache
      const quote = getCachedQuote(pair);
      let currentPrice = pos.currentPrice || 0;

      if (quote && quote.quote) {
        currentPrice = quote.quote.mid;
        if (currentPrice > 0 && currentPrice !== pos.currentPrice) {
          // Update PnL while we're at it
          const direction = pos.direction as 'BUY' | 'SELL';
          const pipValue = pipConfig.standard * pos.lotSize;
          const priceDiff = direction === 'BUY'
            ? currentPrice - pos.entryPrice
            : pos.entryPrice - currentPrice;
          const pnlPips = priceDiff / pipSize;
          const pnl = pnlPips * pipValue - pos.commission;

          await db.tradingPosition.update({
            where: { id: pos.id },
            data: { currentPrice, pnl, pnlPips },
          });
          pricesUpdated++;
        }
      }

      if (!currentPrice || currentPrice <= 0) continue;

      // 4. Compute trailing stop
      const trailingDistance = trailingPips * pipSize;
      const direction = pos.direction as 'BUY' | 'SELL';
      const entryPrice = pos.entryPrice;
      const currentSl = pos.stopLoss;

      let newSl: number | null = null;
      let reason = '';

      if (direction === 'BUY') {
        const trailingLevel = currentPrice - trailingDistance;
        if (trailingLevel > entryPrice) {
          if (currentSl === null || trailingLevel > currentSl) {
            const decimals = pipSize < 0.001 ? 5 : 3;
            newSl = parseFloat(trailingLevel.toFixed(decimals));
            reason = currentSl === null ? 'activated' : 'tightened';
          }
        }
      } else {
        const trailingLevel = currentPrice + trailingDistance;
        if (trailingLevel < entryPrice) {
          if (currentSl === null || trailingLevel < currentSl) {
            const decimals = pipSize < 0.001 ? 5 : 3;
            newSl = parseFloat(trailingLevel.toFixed(decimals));
            reason = currentSl === null ? 'activated' : 'tightened';
          }
        }
      }

      if (newSl === null) continue;

      // 5. Update position SL in DB
      await db.tradingPosition.update({
        where: { id: pos.id },
        data: { stopLoss: newSl },
      });

      // Auto-enable trailing stop on position if it was triggered by config autoTrailingStop
      if (!pos.trailingStop && autoTrailingStop) {
        await db.tradingPosition.update({
          where: { id: pos.id },
          data: { trailingStop: configTrailingPips, trailingType: 'automatic' },
        });
      }

      updatedCount++;
      results.push({ id: pos.id, pair: pos.pair, oldSl: currentSl, newSl, reason });

      // 6. Activity log
      try {
        await db.activityLog.create({
          data: {
            level: 'info',
            category: 'trailing_stop',
            message: `Trailing stop ${reason}: ${direction} ${pos.pair} SL ${currentSl ?? 'none'} → ${newSl} (${trailingPips} pips)`,
            pair: pos.pair,
            metadata: JSON.stringify({ positionId: pos.id, trailingPips, oldSl: currentSl, newSl, currentPrice }),
          },
        });
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json({
      processed: positions.length,
      updated: updatedCount,
      pricesUpdated,
      results: results.length > 0 ? results : undefined,
    });
  } catch (error) {
    logApiError('TrailingStop', error);
    return NextResponse.json(
      { error: 'Trailing stop processing failed' },
      { status: 500 },
    );
  }
}
