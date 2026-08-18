import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair } from '@/lib/trading-types';
import { FOREX_PAIRS } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';
import { getCurrentMidPrice } from '@/lib/price-cache';

const VALID_CONDITIONS = ['above', 'below', 'crosses_above', 'crosses_below'];

// GET - Fetch all alerts (no checking — moved to alert-checker.ts + finnhub route)
export async function GET() {
  try {
    const alerts = await db.priceAlert.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      alerts,
      activeCount: alerts.filter(a => a.isActive && !a.isTriggered).length,
      triggeredCount: alerts.filter(a => a.isTriggered).length,
    });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
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
    const { pair, condition, targetPrice, note, emailNotify } = body;

    // Validate pair
    if (!pair || !FOREX_PAIRS.includes(pair as ForexPair)) {
      return NextResponse.json({ error: `Invalid pair. Must be one of: ${FOREX_PAIRS.join(', ')}` }, { status: 400 });
    }

    // HIGH FIX: Runtime type validation (not just TS assertion)
    if (typeof targetPrice !== 'number' || !isFinite(targetPrice) || targetPrice <= 0) {
      return NextResponse.json({ error: 'targetPrice must be a positive number' }, { status: 400 });
    }

    // Validate condition
    if (!condition || !VALID_CONDITIONS.includes(condition)) {
      return NextResponse.json({ error: `condition must be one of: ${VALID_CONDITIONS.join(', ')}` }, { status: 400 });
    }

    // MEDIUM FIX: Prevent duplicate active alerts for same pair+condition+targetPrice
    const existing = await db.priceAlert.findFirst({
      where: { pair, condition, targetPrice, isActive: true, isTriggered: false },
    });
    if (existing) {
      return NextResponse.json({ error: 'An active alert with the same pair, condition, and target price already exists' }, { status: 409 });
    }

    // Get current price for the alert
    const currentPrice = await getCurrentMidPrice(pair);

    const alert = await db.priceAlert.create({
      data: {
        pair,
        condition,
        targetPrice,
        currentPrice: currentPrice?.mid ?? null,
        note: typeof note === 'string' ? note : null,
        emailNotify: !!emailNotify,
        isActive: true,
        isTriggered: false,
      },
    });

    try {
      await db.activityLog.create({
        data: {
          level: 'info', category: 'alert',
          message: `Created price alert: ${pair} ${condition} ${targetPrice}`,
          pair,
          metadata: JSON.stringify({ alertId: alert.id }),
        },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({ alert }, { status: 201 });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}

// PUT - Update alert (toggle active, update fields, reset triggered)
export async function PUT(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  try {
    const body = await request.json();
    const { id, isActive, targetPrice, condition, note, emailNotify, resetTriggered } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const existing = await db.priceAlert.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (targetPrice !== undefined) {
      if (typeof targetPrice !== 'number' || !isFinite(targetPrice) || targetPrice <= 0) {
        return NextResponse.json({ error: 'targetPrice must be a positive number' }, { status: 400 });
      }
      updateData.targetPrice = targetPrice;
    }
    if (condition !== undefined) {
      if (!VALID_CONDITIONS.includes(condition)) {
        return NextResponse.json({ error: `condition must be one of: ${VALID_CONDITIONS.join(', ')}` }, { status: 400 });
      }
      updateData.condition = condition;
    }
    if (note !== undefined) updateData.note = typeof note === 'string' ? note : null;
    if (emailNotify !== undefined) updateData.emailNotify = !!emailNotify;

    // LOW FIX: Guard resetTriggered — only reset if actually triggered
    if (resetTriggered) {
      if (!existing.isTriggered) {
        return NextResponse.json({ error: 'Alert is not triggered, nothing to reset' }, { status: 400 });
      }
      updateData.isTriggered = false;
      updateData.triggeredAt = null;
      updateData.isActive = true;
      updateData.currentPrice = null; // Reset price tracking for fresh cross detection
    }

    const updated = await db.priceAlert.update({ where: { id }, data: updateData });
    return NextResponse.json({ alert: updated });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}

// DELETE - Delete alert (or clear all triggered alerts)
export async function DELETE(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const clearTriggered = searchParams.get('clearTriggered') === 'true';

    // MEDIUM FIX: Support bulk clearing of triggered alerts
    if (clearTriggered) {
      const result = await db.priceAlert.deleteMany({ where: { isTriggered: true } });
      try {
        await db.activityLog.create({
          data: { level: 'info', category: 'alert', message: `Cleared ${result.count} triggered alerts` },
        });
      } catch { /* non-critical */ }
      return NextResponse.json({ success: true, deletedCount: result.count });
    }

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
          level: 'info', category: 'alert',
          message: `Deleted price alert: ${existing.pair} ${existing.condition} ${existing.targetPrice}`,
          pair: existing.pair,
        },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    logApiError('Alerts', error);
    return NextResponse.json({ error: 'Failed to delete alert' }, { status: 500 });
  }
}
