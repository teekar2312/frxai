import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair } from '@/lib/trading-types';
import { PAIR_PIP_VALUES, FINEX_CONFIG } from '@/lib/trading-types';

// GET - Fetch all positions
export async function GET() {
  try {
    const positions = await db.tradingPosition.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ positions });
  } catch (error) {
    console.error('[Positions GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch positions', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// POST - Create new position
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      pair,
      direction,
      lotSize: requestedLotSize,
      entryPrice,
      stopLoss,
      takeProfit,
      strategy,
      marketCondition,
      aiConfidence,
      riskAmount,
    } = body as {
      pair: ForexPair;
      direction: 'BUY' | 'SELL';
      lotSize?: number;
      entryPrice?: number;
      stopLoss?: number;
      takeProfit?: number;
      strategy?: string;
      marketCondition?: string;
      aiConfidence?: number;
      riskAmount?: number;
    };

    if (!pair || !direction) {
      return NextResponse.json(
        { error: 'pair and direction are required' },
        { status: 400 }
      );
    }

    // Try to get entryPrice from Finnhub if not provided
    if (!entryPrice || entryPrice === 0) {
      try {
        const finnhubRes = await fetch('http://localhost:3000/api/finnhub');
        if (finnhubRes.ok) {
          const finnhubData = await finnhubRes.json();
          const quote = finnhubData.quotes?.[pair as string];
          if (quote?.mid) {
            entryPrice = quote.mid;
          }
        }
      } catch {
        // Finnhub fetch failed, will check below
      }
    }

    if (!entryPrice || entryPrice === 0) {
      return NextResponse.json(
        { error: 'entryPrice is required (could not determine current price from market data)' },
        { status: 400 }
      );
    }

    if (!['BUY', 'SELL'].includes(direction)) {
      return NextResponse.json(
        { error: 'direction must be BUY or SELL' },
        { status: 400 }
      );
    }

    // Calculate lot size based on risk if not provided
    let lotSize = requestedLotSize;
    const pipConfig = PAIR_PIP_VALUES[pair] || { standard: 10, pipSize: 0.0001 };

    if (!lotSize && stopLoss && riskAmount) {
      const slPips = Math.abs(entryPrice - stopLoss) / pipConfig.pipSize;
      if (slPips > 0) {
        lotSize = parseFloat((riskAmount / (slPips * pipConfig.standard)).toFixed(2));
      }
    }

    if (!lotSize) {
      lotSize = FINEX_CONFIG.minLot;
    }

    // Validate lot size
    if (lotSize < FINEX_CONFIG.minLot) lotSize = FINEX_CONFIG.minLot;
    if (lotSize > FINEX_CONFIG.maxLotPerOrder) lotSize = FINEX_CONFIG.maxLotPerOrder;

    // Check max open positions
    const openCount = await db.tradingPosition.count({
      where: { status: 'open' },
    });

    if (openCount >= FINEX_CONFIG.maxOpenPositions) {
      return NextResponse.json(
        { error: `Maximum open positions reached (${FINEX_CONFIG.maxOpenPositions})` },
        { status: 400 }
      );
    }

    // Calculate PnL metrics
    const pipValue = pipConfig.standard * lotSize;
    const calcRiskAmount = stopLoss ? Math.abs(entryPrice - stopLoss) / pipConfig.pipSize * pipValue : null;
    const calcRewardAmount = takeProfit ? Math.abs(takeProfit - entryPrice) / pipConfig.pipSize * pipValue : null;

    const position = await db.tradingPosition.create({
      data: {
        pair,
        direction,
        lotSize,
        entryPrice,
        currentPrice: entryPrice,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
        pipValue,
        riskAmount: calcRiskAmount,
        rewardAmount: calcRewardAmount,
        strategy: strategy ?? null,
        marketCondition: marketCondition ?? null,
        aiConfidence: aiConfidence ?? null,
        leverage: FINEX_CONFIG.leverage,
        commission: FINEX_CONFIG.commissionPerLot * lotSize,
        status: 'open',
      },
    });

    // Log position open
    try {
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'trading',
          message: `Opened ${direction} ${pair} @ ${entryPrice}, lot: ${lotSize}, SL: ${stopLoss ?? 'N/A'}, TP: ${takeProfit ?? 'N/A'}`,
          pair,
          metadata: JSON.stringify({ positionId: position.id, lotSize, strategy }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({ position }, { status: 201 });
  } catch (error) {
    console.error('[Positions POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create position', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// PUT - Update position (close, modify SL/TP, trailing stop)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, stopLoss, takeProfit, trailingStop, currentPrice } = body as {
      id: string;
      action: 'close' | 'modify' | 'update_price' | 'trailing_stop';
      stopLoss?: number;
      takeProfit?: number;
      trailingStop?: number;
      currentPrice?: number;
    };

    if (!id || !action) {
      return NextResponse.json(
        { error: 'id and action are required' },
        { status: 400 }
      );
    }

    const existing = await db.tradingPosition.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }
    if (existing.status !== 'open') {
      return NextResponse.json({ error: `Position is already ${existing.status}` }, { status: 400 });
    }

    if (action === 'close') {
      const closePrice = currentPrice || existing.entryPrice;
      const pipConfig = PAIR_PIP_VALUES[existing.pair as ForexPair] || { standard: 10, pipSize: 0.0001 };
      const pipValue = pipConfig.standard * existing.lotSize;
      const priceDiff = existing.direction === 'BUY'
        ? closePrice - existing.entryPrice
        : existing.entryPrice - closePrice;
      const pnlPips = priceDiff / pipConfig.pipSize;
      const pnl = pnlPips * pipValue - existing.commission;

      const updated = await db.tradingPosition.update({
        where: { id },
        data: {
          currentPrice: closePrice,
          pnl,
          pnlPips,
          status: 'closed',
          closedAt: new Date(),
        },
      });

      // Log close
      try {
        await db.activityLog.create({
          data: {
            level: pnl >= 0 ? 'info' : 'warn',
            category: 'trading',
            message: `Closed ${existing.direction} ${existing.pair} @ ${closePrice}, PnL: ${pnl.toFixed(2)} (${pnlPips.toFixed(1)} pips)`,
            pair: existing.pair,
            metadata: JSON.stringify({ positionId: id, pnl, pnlPips, closePrice }),
          },
        });
      } catch {
        // Non-critical
      }

      // Email notification simulation
      console.log(`[EMAIL NOTIFY] Position closed: ${existing.pair} ${existing.direction}, PnL: $${pnl.toFixed(2)}`);

      return NextResponse.json({ position: updated });
    }

    if (action === 'modify') {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (stopLoss !== undefined) updateData.stopLoss = stopLoss;
      if (takeProfit !== undefined) updateData.takeProfit = takeProfit;

      const updated = await db.tradingPosition.update({
        where: { id },
        data: updateData,
      });

      try {
        await db.activityLog.create({
          data: {
            level: 'info',
            category: 'trading',
            message: `Modified ${existing.pair} position - SL: ${stopLoss ?? 'unchanged'}, TP: ${takeProfit ?? 'unchanged'}`,
            pair: existing.pair,
          },
        });
      } catch {
        // Non-critical
      }

      return NextResponse.json({ position: updated });
    }

    if (action === 'update_price') {
      if (!currentPrice) {
        return NextResponse.json({ error: 'currentPrice is required for update_price' }, { status: 400 });
      }
      const pipConfig = PAIR_PIP_VALUES[existing.pair as ForexPair] || { standard: 10, pipSize: 0.0001 };
      const pipValue = pipConfig.standard * existing.lotSize;
      const priceDiff = existing.direction === 'BUY'
        ? currentPrice - existing.entryPrice
        : existing.entryPrice - currentPrice;
      const pnlPips = priceDiff / pipConfig.pipSize;
      const pnl = pnlPips * pipValue - existing.commission;

      const updated = await db.tradingPosition.update({
        where: { id },
        data: {
          currentPrice,
          pnl,
          pnlPips,
        },
      });

      return NextResponse.json({ position: updated });
    }

    if (action === 'trailing_stop') {
      if (trailingStop === undefined) {
        return NextResponse.json({ error: 'trailingStop value is required' }, { status: 400 });
      }
      const updated = await db.tradingPosition.update({
        where: { id },
        data: {
          trailingStop,
          trailingType: 'automatic',
        },
      });

      return NextResponse.json({ position: updated });
    }

    return NextResponse.json({ error: 'Invalid action. Use: close, modify, update_price, trailing_stop' }, { status: 400 });
  } catch (error) {
    console.error('[Positions PUT] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update position', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// DELETE - Cancel position
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const existing = await db.tradingPosition.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }
    if (existing.status !== 'open') {
      return NextResponse.json(
        { error: `Cannot cancel a ${existing.status} position` },
        { status: 400 }
      );
    }

    const cancelled = await db.tradingPosition.update({
      where: { id },
      data: {
        status: 'cancelled',
        closedAt: new Date(),
      },
    });

    try {
      await db.activityLog.create({
        data: {
          level: 'warn',
          category: 'trading',
          message: `Cancelled ${existing.direction} ${existing.pair} position`,
          pair: existing.pair,
          metadata: JSON.stringify({ positionId: id }),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({ position: cancelled });
  } catch (error) {
    console.error('[Positions DELETE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel position', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
