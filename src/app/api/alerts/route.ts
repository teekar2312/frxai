import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair } from '@/lib/trading-types';
import { FOREX_PAIRS } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';
import { getCachedQuote, getCurrentMidPrice } from '@/lib/price-cache';
import { sendPriceAlertEmail } from '@/lib/email-service';

// FNH-002/FNH-010/C-001: Use centralized price cache instead of direct Finnhub calls
// RD-004: Falls back to getCurrentMidPrice when cache expired
async function getCurrentPrice(pair: string): Promise<number | null> {
  const cached = getCachedQuote(pair as ForexPair);
  if (cached) return cached.quote.mid;
  // Cache expired — try direct fetch
  const result = await getCurrentMidPrice(pair);
  return result?.mid ?? null;
}

function checkAlertCondition(
  condition: string,
  currentPrice: number,
  targetPrice: number,
  previousPrice?: number
): boolean {
  switch (condition) {
    case 'above':
      return currentPrice > targetPrice;
    case 'below':
      return currentPrice < targetPrice;
    case 'crosses_above':
      return previousPrice !== undefined
        ? previousPrice <= targetPrice && currentPrice > targetPrice
        : currentPrice > targetPrice;
    case 'crosses_below':
      return previousPrice !== undefined
        ? previousPrice >= targetPrice && currentPrice < targetPrice
        : currentPrice < targetPrice;
    default:
      return false;
  }
}

// GET - Fetch alerts and check for triggers
export async function GET() {
  try {
    const alerts = await db.priceAlert.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Get active alerts that haven't been triggered
    const activeAlerts = alerts.filter((a) => a.isActive && !a.isTriggered);
    const triggeredAlerts: Array<{ id: string; pair: string; targetPrice: number; currentPrice: number; condition: string; note?: string }> = [];

    // Check active alerts against current prices
    if (activeAlerts.length > 0) {
      // Group by pair to minimize API calls
      const pairsToCheck = [...new Set(activeAlerts.map((a) => a.pair))];
      const priceCache: Record<string, number | null> = {};

      for (const pair of pairsToCheck) {
        priceCache[pair] = await getCurrentPrice(pair);
      }

      // M-8: Check conditions first; only update price for non-triggered alerts
      // (triggered alerts already set currentPrice in the trigger update)
      for (const alert of activeAlerts) {
        const price = priceCache[alert.pair];
        if (price === null) continue;

        // ALR-01: Pass previousPrice (stored as currentPrice) for cross conditions
        const previousPrice = alert.currentPrice ?? undefined;

        if (checkAlertCondition(alert.condition, price, alert.targetPrice, previousPrice)) {
          // Trigger the alert (includes currentPrice update)
          await db.priceAlert.update({
            where: { id: alert.id },
            data: {
              isTriggered: true,
              triggeredAt: new Date(),
              isActive: false,
              currentPrice: price,
            },
          });

          triggeredAlerts.push({
            id: alert.id,
            pair: alert.pair,
            targetPrice: alert.targetPrice,
            currentPrice: price,
            condition: alert.condition,
            note: alert.note || undefined,
          });

          // Log the trigger
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
          } catch {
            // Non-critical
          }

          // Send email notification if enabled
          if (alert.emailNotify) {
            sendPriceAlertEmail(alert.pair, alert.condition, alert.targetPrice, price, alert.note).catch(() => {});
          }
        } else {
          // M-8: Only update price for non-triggered alerts
          try {
            await db.priceAlert.update({
              where: { id: alert.id },
              data: { currentPrice: price },
            });
          } catch { /* non-critical */ }
        }
      }
    }

    return NextResponse.json({
      alerts,
      triggeredAlerts: triggeredAlerts.length > 0 ? triggeredAlerts : undefined,
      activeCount: alerts.filter((a) => a.isActive && !a.isTriggered).length,
      triggeredCount: alerts.filter((a) => a.isTriggered).length,
    });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json(
      { error: 'Failed to fetch alerts' },
      { status: 500 }
    );
  }
}

// POST - Create new alert
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  try {
    const body = await request.json();
    const { pair, condition, targetPrice, note, emailNotify } = body as {
      pair: ForexPair;
      condition: 'above' | 'below' | 'crosses_above' | 'crosses_below';
      targetPrice: number;
      note?: string;
      emailNotify?: boolean;
    };

    if (!pair || !FOREX_PAIRS.includes(pair as ForexPair)) {
      return NextResponse.json(
        { error: `Invalid pair. Must be one of: ${FOREX_PAIRS.join(', ')}` },
        { status: 400 }
      );
    }
    if (!condition || !targetPrice) {
      return NextResponse.json(
        { error: 'pair, condition, and targetPrice are required' },
        { status: 400 }
      );
    }

    const validConditions = ['above', 'below', 'crosses_above', 'crosses_below'];
    if (!validConditions.includes(condition)) {
      return NextResponse.json(
        { error: `condition must be one of: ${validConditions.join(', ')}` },
        { status: 400 }
      );
    }

    // Get current price for the alert
    const currentPrice = await getCurrentPrice(pair);

    const alert = await db.priceAlert.create({
      data: {
        pair,
        condition,
        targetPrice,
        currentPrice,
        note: note || null,
        emailNotify: emailNotify ?? false,
        isActive: true,
        isTriggered: false,
      },
    });

    try {
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'alert',
          message: `Created price alert: ${pair} ${condition} ${targetPrice}`,
          pair,
          metadata: JSON.stringify({ alertId: alert.id }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({ alert }, { status: 201 });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json(
      { error: 'Failed to create alert' },
      { status: 500 }
    );
  }
}

// PUT - Update alert (toggle active, update fields)
export async function PUT(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  try {
    const body = await request.json();
    const { id, isActive, targetPrice, condition, note, emailNotify, resetTriggered } = body as {
      id: string;
      isActive?: boolean;
      targetPrice?: number;
      condition?: string;
      note?: string;
      emailNotify?: boolean;
      resetTriggered?: boolean;
    };

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existing = await db.priceAlert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (targetPrice !== undefined) updateData.targetPrice = targetPrice;
    // H-5: Validate condition field
    if (condition !== undefined) {
      const VALID_CONDITIONS = ['above', 'below', 'crosses_above', 'crosses_below'];
      if (!VALID_CONDITIONS.includes(condition)) {
        return NextResponse.json({ error: `condition must be one of: ${VALID_CONDITIONS.join(', ')}` }, { status: 400 });
      }
      updateData.condition = condition;
    }
    if (note !== undefined) updateData.note = note;
    if (emailNotify !== undefined) updateData.emailNotify = emailNotify;
    if (resetTriggered) {
      updateData.isTriggered = false;
      updateData.triggeredAt = null;
      updateData.isActive = true;
    }

    const updated = await db.priceAlert.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ alert: updated });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json(
      { error: 'Failed to update alert' },
      { status: 500 }
    );
  }
}

// DELETE - Delete alert
export async function DELETE(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const existing = await db.priceAlert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    await db.priceAlert.delete({ where: { id } });

    try {
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'alert',
          message: `Deleted price alert: ${existing.pair} ${existing.condition} ${existing.targetPrice}`,
          pair: existing.pair,
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json(
      { error: 'Failed to delete alert' },
      { status: 500 }
    );
  }
}
