import { NextRequest, NextResponse } from 'next/server';
import type { ForexPair, CandleData } from '@/lib/trading-types';
import {
  PAIR_TO_FINNHUB_SYMBOL, RESOLUTION_TO_SECONDS, VALID_FINNHUB_RESOLUTIONS,
  toFinnhubResolution,
} from '@/lib/trading-types';
import { refreshAllQuotes, isAnySimulated, getCacheAge } from '@/lib/price-cache';
import { fetchWithTimeout } from '@/lib/fetch-utils';
import { generateSimulatedCandles } from '@/lib/sim-candles';
import { logApiError, safeLog } from '@/lib/safe-log';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { checkAllAlerts } from '@/lib/alert-checker';
import { db } from '@/lib/db';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// Module-level tick counters for server-side scheduling (persist across requests)
let autoTradeTickCounter = 0;
let trailingStopTickCounter = 0;

interface FinnhubCandle {
  t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; s: string;
}

function normalizeCandles(raw: FinnhubCandle): CandleData[] {
  if (raw.s !== 'ok' || !raw.t) return [];
  return raw.t.map((time, i) => ({
    time: time * 1000,
    open: raw.o[i],
    high: raw.h[i],
    low: raw.l[i],
    close: raw.c[i],
    volume: raw.v[i] || 0,
  }));
}

/**
 * CRITICAL: Check all open simulation positions for SL/TP hits and close them.
 * Called on every price tick.
 */
async function checkPositionSLTP(currentPrices: Record<string, { bid: number; ask: number }>): Promise<Array<{ id: string; pair: string; direction: string; pnl: number; reason: string }>> {
  const closed: Array<{ id: string; pair: string; direction: string; pnl: number; reason: string }> = [];
  try {
    const openPositions = await db.tradingPosition.findMany({
      where: { status: 'open' },
    });

    for (const pos of openPositions) {
      const price = currentPrices[pos.pair];
      if (!price) continue;

      const currentMid = (price.bid + price.ask) / 2;
      let shouldClose = false;
      let reason = '';

      if (pos.direction === 'BUY') {
        if (pos.stopLoss && currentMid <= pos.stopLoss) {
          shouldClose = true;
          reason = 'STOP_LOSS';
        } else if (pos.takeProfit && currentMid >= pos.takeProfit) {
          shouldClose = true;
          reason = 'TAKE_PROFIT';
        }
      } else if (pos.direction === 'SELL') {
        if (pos.stopLoss && currentMid >= pos.stopLoss) {
          shouldClose = true;
          reason = 'STOP_LOSS';
        } else if (pos.takeProfit && currentMid <= pos.takeProfit) {
          shouldClose = true;
          reason = 'TAKE_PROFIT';
        }
      }

      if (shouldClose) {
        const pipValue = pos.pair === 'XAUUSD' || pos.pair === 'USDJPY' ? 0.01 : 0.0001;
        const pips = pos.direction === 'BUY'
          ? (currentMid - pos.entryPrice) / pipValue
          : (pos.entryPrice - currentMid) / pipValue;
        const pnl = pos.direction === 'BUY'
          ? (currentMid - pos.entryPrice) * pos.lotSize * (pos.pair === 'XAUUSD' ? 100 : 100000)
          : (pos.entryPrice - currentMid) * pos.lotSize * (pos.pair === 'XAUUSD' ? 100 : 100000);
        const finalPnl = pnl - (pos.commission || 0);

        await db.tradingPosition.update({
          where: { id: pos.id },
          data: {
            status: 'closed',
            currentPrice: currentMid,
            closedAt: new Date(),
            pnl: parseFloat(finalPnl.toFixed(2)),
            closeReason: reason,
          },
        });

        await db.notification.create({
          data: {
            type: reason === 'STOP_LOSS' ? 'stop_loss' : 'take_profit',
            title: `${reason === 'STOP_LOSS' ? '🛑 Stop Loss' : '✅ Take Profit'}: ${pos.pair} ${pos.direction}`,
            message: `${pos.pair} ${pos.direction} ditutup @ ${currentMid.toFixed(pos.pair === 'XAUUSD' || pos.pair === 'USDJPY' ? 3 : 5)} | P&L: ${finalPnl >= 0 ? '+' : ''}${finalPnl.toFixed(2)} (${pips >= 0 ? '+' : ''}${pips.toFixed(1)} pips)`,
            pair: pos.pair,
          },
        });

        await db.activityLog.create({
          data: {
            level: 'info',
            category: 'trading',
            message: `POSITION CLOSED (${reason}): ${pos.direction} ${pos.pair} @ ${currentMid.toFixed(5)}, P&L: ${finalPnl.toFixed(2)}`,
            pair: pos.pair,
            metadata: JSON.stringify({ positionId: pos.id, reason, pips: parseFloat(pips.toFixed(1)), pnl: finalPnl }),
          },
        });

        closed.push({ id: pos.id, pair: pos.pair, direction: pos.direction, pnl: finalPnl, reason });
      }
    }
  } catch (err) {
    safeLog({ level: 'error', route: 'SLTP', message: 'Error checking SL/TP', error: err instanceof Error ? err.message : String(err) });
  }
  return closed;
}

/**
 * CRITICAL: Check pending orders against current prices and execute if triggered.
 */
async function checkPendingOrders(currentPrices: Record<string, { bid: number; ask: number }>): Promise<Array<{ id: string; pair: string; orderType: string; direction: string }>> {
  const executed: Array<{ id: string; pair: string; orderType: string; direction: string }> = [];
  try {
    const pendingOrders = await db.pendingOrder.findMany({
      where: { status: 'pending' },
    });

    for (const order of pendingOrders) {
      const price = currentPrices[order.pair];
      if (!price) continue;

      const currentMid = (price.bid + price.ask) / 2;
      let shouldExecute = false;

      switch (order.orderType) {
        case 'buy_limit':
          shouldExecute = currentMid <= order.price;
          break;
        case 'sell_limit':
          shouldExecute = currentMid >= order.price;
          break;
        case 'buy_stop':
          shouldExecute = currentMid >= order.price;
          break;
        case 'sell_stop':
          shouldExecute = currentMid <= order.price;
          break;
      }

      if (shouldExecute) {
        const direction = order.orderType.startsWith('buy') ? 'BUY' as const : 'SELL' as const;

        // Create position from pending order
        await db.tradingPosition.create({
          data: {
            pair: order.pair,
            direction,
            lotSize: order.lotSize,
            entryPrice: currentMid,
            currentPrice: currentMid,
            stopLoss: order.stopLoss,
            takeProfit: order.takeProfit,
            strategy: 'PENDING_ORDER',
            leverage: 100,
            status: 'open',
          },
        });

        // Mark pending order as executed
        await db.pendingOrder.update({
          where: { id: order.id },
          data: { status: 'executed', executedAt: new Date(), executedPrice: currentMid },
        });

        await db.notification.create({
          data: {
            type: 'order_executed',
            title: `📋 Pending Order Tereksekusi: ${direction} ${order.pair}`,
            message: `${order.orderType.replace('_', ' ').toUpperCase()} ${order.pair} @ ${currentMid.toFixed(5)} tereksekusi`,
            pair: order.pair,
          },
        });

        await db.activityLog.create({
          data: {
            level: 'info',
            category: 'trading',
            message: `PENDING ORDER EXECUTED: ${order.orderType} ${order.pair} @ ${currentMid.toFixed(5)}`,
            pair: order.pair,
            metadata: JSON.stringify({ orderId: order.id, orderType: order.orderType, executedPrice: currentMid }),
          },
        });

        executed.push({ id: order.id, pair: order.pair, orderType: order.orderType, direction });
      }

      // Check expiry
      if (order.expiresAt && new Date() > order.expiresAt && !shouldExecute) {
        await db.pendingOrder.update({
          where: { id: order.id },
          data: { status: 'expired' },
        });
        await db.notification.create({
          data: {
            type: 'order_expired',
            title: `⏰ Pending Order Kedaluwarsa: ${order.pair}`,
            message: `${order.orderType} ${order.pair} @ ${order.price} telah kedaluwarsa`,
            pair: order.pair,
          },
        });
      }
    }
  } catch (err) {
    safeLog({ level: 'error', route: 'PendingOrders', message: 'Error checking pending orders', error: err instanceof Error ? err.message : String(err) });
  }
  return executed;
}

export async function GET(request: NextRequest) {
  // FNH-001: Rate limiting — max 12 req/min (4 pairs × 3 polls, leaves room for alerts)
  const rateCheck = checkRateLimit(clientIp(request), 'finnhub');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    // Candle data request
    if (type === 'candles') {
      const symbolParam = searchParams.get('symbol') as ForexPair | null;
      const resolutionParam = searchParams.get('resolution') || 'M5';

      // FNH-014: Validate resolution
      if (!VALID_FINNHUB_RESOLUTIONS.includes(resolutionParam)) {
        return NextResponse.json({ error: `Invalid resolution. Must be one of: ${VALID_FINNHUB_RESOLUTIONS.join(', ')}` }, { status: 400 });
      }
      const count = Math.min(Math.max(1, parseInt(searchParams.get('count') || '100', 10)), 5000);

      if (!symbolParam || !PAIR_TO_FINNHUB_SYMBOL[symbolParam]) {
        return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
      }

      const intervalSeconds = RESOLUTION_TO_SECONDS[resolutionParam] || 300;

      // Return simulated candles if no API key (FNH-007: consistent fallback)
      if (!apiKey) {
        const candles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true });
      }

      // FNH-014: Convert alias to Finnhub numeric format
      const finnhubResolution = toFinnhubResolution(resolutionParam);
      const finnhubSymbol = PAIR_TO_FINNHUB_SYMBOL[symbolParam];
      const now = Math.floor(Date.now() / 1000);
      const from = now - count * (RESOLUTION_TO_SECONDS[resolutionParam] || 300);
      const url = `${FINNHUB_BASE}/stock/candle?symbol=${finnhubSymbol}&resolution=${finnhubResolution}&from=${from}&to=${now}&token=${apiKey}`;

      try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          const candles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
          return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true, fallback: true });
        }
        const data: FinnhubCandle = await res.json();
        const candles = normalizeCandles(data);
        if (candles.length === 0) {
          const simCandles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
          return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: simCandles.length, candles: simCandles, simulated: true, fallback: true });
        }
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles });
      } catch {
        const candles = generateSimulatedCandles(symbolParam, count, intervalSeconds);
        return NextResponse.json({ pair: symbolParam, resolution: resolutionParam, count: candles.length, candles, simulated: true, fallback: true });
      }
    }

    // Default: fetch all forex quotes via centralized cache (C-001)
    const { quotes, simulated } = await refreshAllQuotes();

    // CRITICAL FIX: Check all price alerts on every price tick (not just when alerts tab is open)
    const triggeredAlerts = await checkAllAlerts();

    // CRITICAL: Check SL/TP on every price tick
    const sltpClosed = await checkPositionSLTP(quotes);

    // CRITICAL: Check pending orders on every price tick
    const executedPending = await checkPendingOrders(quotes);

    // Server-side auto-trading scheduler (every 30 seconds = 6 ticks at 5s intervals)
    autoTradeTickCounter++;
    let autoTradeResult: unknown = null;
    if (autoTradeTickCounter >= 6) {
      autoTradeTickCounter = 0;
      try {
        const config = await db.tradingConfig.findFirst();
        if (config?.autoTrading) {
          const autoRes = await fetch('http://localhost:3000/api/auto-execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Internal-Call': 'true' },
          });
          if (autoRes.ok) autoTradeResult = await autoRes.json();
        }
      } catch { /* non-critical */ }
    }

    // Server-side trailing stop processing (every 50 seconds = 10 ticks at 5s intervals)
    trailingStopTickCounter++;
    if (trailingStopTickCounter >= 10) {
      trailingStopTickCounter = 0;
      try {
        const config = await db.tradingConfig.findFirst();
        if (config?.autoTrailingStop) {
          await fetch('http://localhost:3000/api/trailing-stop/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Internal-Call': 'true' },
          });
        }
      } catch { /* non-critical */ }
    }

    // RB-003: Add Cache-Control header (quotes don't change faster than ~1s)
    return new NextResponse(
      JSON.stringify({
        timestamp: Date.now(),
        quotes,
        simulated,
        cacheAgeMs: getCacheAge(),
        anySimulated: isAnySimulated(),
        triggeredAlerts: triggeredAlerts.length > 0 ? triggeredAlerts : undefined,
        closedPositions: sltpClosed.length > 0 ? sltpClosed : undefined,
        executedPendingOrders: executedPending.length > 0 ? executedPending : undefined,
        autoTradeResult: autoTradeResult ?? undefined,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=2, s-maxage=2',
        },
      },
    );
  } catch (error) {
    logApiError('Finnhub', error);
    // API-AUDIT-008: Wrap refreshAllQuotes fallback in its own try-catch
    let fallbackQuotes: Record<string, unknown> = {};
    let fallbackSimulated = true;
    try {
      const fallback = await refreshAllQuotes();
      fallbackQuotes = fallback.quotes;
      fallbackSimulated = fallback.simulated;
    } catch {
      // If even the fallback fails, return minimal error response
    }
    return NextResponse.json({ timestamp: Date.now(), quotes: fallbackQuotes, simulated: fallbackSimulated, error: 'fallback' });
  }
}
