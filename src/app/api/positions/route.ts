import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair } from '@/lib/trading-types';
import { PAIR_PIP_VALUES, FINEX_CONFIG, FOREX_PAIRS } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { getCurrentMidPriceLegacy as getCurrentMidPrice } from '@/lib/price-fetcher';
import { getCurrentBidAsk } from '@/lib/price-cache';
import { logApiError, safeLog } from '@/lib/safe-log';
import { sendPositionOpenEmail, sendPositionCloseEmail } from '@/lib/email-service';

// GET - Fetch positions (supports ?status=open|closed|cancelled filter)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // H-4: Validate status query param
    const status = searchParams.get('status');
    const VALID_STATUSES = ['open', 'closed', 'cancelled'] as const;
    let where: Record<string, string> = {};
    if (status) {
      if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
        return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
      }
      where.status = status;
    }
    const positions = await db.tradingPosition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ positions });
  } catch (error) {
    logApiError('Positions', error);
    return NextResponse.json(
      { error: 'Failed to fetch positions' },
      { status: 500 }
    );
  }
}

// POST - Create new position
export async function POST(request: NextRequest) {
  // API-AUDIT-005: Rate limit BEFORE auth to prevent brute-force API key guessing
  const rateCheck = checkRateLimit(clientIp(request), 'trade');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  try {
    const body = await request.json();
    const {
      pair,
      direction,
      lotSize: requestedLotSize,
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

    // AUDIT-TRADE-11: Extract trailingStop from raw body
    const trailingStop = (body.trailingStop as number | null | undefined) ?? null;

    // L14: entryPrice is optional for simulation (can be fetched from market data)
    let entryPrice: number = body.entryPrice || 0;

    // POS-05: Validate pair against allowed list
    if (!pair || !FOREX_PAIRS.includes(pair as ForexPair)) {
      return NextResponse.json(
        { error: `Invalid pair. Must be one of: ${FOREX_PAIRS.join(', ')}` },
        { status: 400 }
      );
    }
    if (!direction) {
      return NextResponse.json(
        { error: 'direction is required' },
        { status: 400 }
      );
    }

    if (!['BUY', 'SELL'].includes(direction)) {
      return NextResponse.json(
        { error: 'direction must be BUY or SELL' },
        { status: 400 }
      );
    }

    // POS-01: Fetch TradingConfig from DB instead of using hardcoded FINEX_CONFIG
    let config = await db.tradingConfig.findFirst();
    if (!config) config = await db.tradingConfig.create({ data: { riskPerTrade: 0.75, stopLossMin: 5, stopLossMax: 15, riskRewardRatio: 1.5, maxOpenPositions: 3, dailyRiskLimit: 2.5, dailyTargetMin: 1, dailyTargetMax: 3, leverage: 100, spreadPip: 0.5, commissionPerLot: 1, marginCallLevel: 50, stopOutLevel: 20, autoTrading: false, autoTrailingStop: false, trailingStopPips: 10, avoidNewsTrading: true, accountBalance: 10000 } });

    // AUDIT-TRADE-03: Server-side auto-trading enforcement
    // If request has both strategy and aiConfidence, it's an auto-traded signal
    const isAutoTradedSignal = !!strategy && typeof aiConfidence === 'number';
    if (isAutoTradedSignal && !config.autoTrading) {
      return NextResponse.json(
        { error: 'Auto-trading is disabled in settings' },
        { status: 403 }
      );
    }

    if (!entryPrice || entryPrice === 0) {
      const mid = await getCurrentMidPrice(pair);
      if (mid) {
        // F-02: Spread-adjusted entry pricing
        const pipSize = PAIR_PIP_VALUES[pair]?.pipSize ?? 0.0001;
        const spreadAdjust = (config.spreadPip * pipSize) / 2;
        entryPrice = direction === 'BUY' ? mid + spreadAdjust : mid - spreadAdjust;
      }
    }

    if (!entryPrice || entryPrice === 0) {
      return NextResponse.json(
        { error: 'entryPrice is required (could not determine current price from market data)' },
        { status: 400 }
      );
    }

    // POS-03: SL/TP directional validation
    if (stopLoss !== undefined && stopLoss !== null && stopLoss > 0) {
      if (direction === 'BUY' && stopLoss >= entryPrice) {
        return NextResponse.json({ error: 'For BUY, stop-loss must be below entry price' }, { status: 400 });
      }
      if (direction === 'SELL' && stopLoss <= entryPrice) {
        return NextResponse.json({ error: 'For SELL, stop-loss must be above entry price' }, { status: 400 });
      }
    }
    if (takeProfit !== undefined && takeProfit !== null && takeProfit > 0) {
      if (direction === 'BUY' && takeProfit <= entryPrice) {
        return NextResponse.json({ error: 'For BUY, take-profit must be above entry price' }, { status: 400 });
      }
      if (direction === 'SELL' && takeProfit >= entryPrice) {
        return NextResponse.json({ error: 'For SELL, take-profit must be below entry price' }, { status: 400 });
      }
    }

    // POS-04: SL pip range validation
    const pipConfig = PAIR_PIP_VALUES[pair] || { standard: 10, pipSize: 0.0001 };
    if (stopLoss && stopLoss > 0) {
      const slPips = Math.abs(entryPrice - stopLoss) / pipConfig.pipSize;
      if (slPips < config.stopLossMin) {
        return NextResponse.json({ error: `Stop-loss too close: ${slPips.toFixed(1)} pips (minimum: ${config.stopLossMin} pips)` }, { status: 400 });
      }
      if (slPips > config.stopLossMax) {
        return NextResponse.json({ error: `Stop-loss too far: ${slPips.toFixed(1)} pips (maximum: ${config.stopLossMax} pips)` }, { status: 400 });
      }
    }

    // POS-02: Enforce daily risk limit
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayClosed = await db.tradingPosition.findMany({
      where: { status: 'closed', closedAt: { gte: todayStart } },
      select: { pnl: true },
    });
    const todayLoss = todayClosed.filter(p => p.pnl < 0).reduce((sum, p) => sum + Math.abs(p.pnl), 0);
    const dailyRiskAmount = (config.dailyRiskLimit / 100) * config.accountBalance;
    if (todayLoss >= dailyRiskAmount) {
      return NextResponse.json({ error: `Daily risk limit reached: $${todayLoss.toFixed(2)} lost of $${dailyRiskAmount.toFixed(2)} max` }, { status: 429 });
    }

    // Calculate lot size based on risk if not provided
    let lotSize = requestedLotSize;

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

    if (openCount >= config.maxOpenPositions) {
      return NextResponse.json(
        { error: `Maximum open positions reached (${config.maxOpenPositions})` },
        { status: 400 }
      );
    }

    // Calculate PnL metrics
    const pipValue = pipConfig.standard * lotSize;
    const calcRiskAmount = stopLoss ? Math.abs(entryPrice - stopLoss) / pipConfig.pipSize * pipValue : null;
    const calcRewardAmount = takeProfit ? Math.abs(takeProfit - entryPrice) / pipConfig.pipSize * pipValue : null;

    // AUDIT-TRADE-11: Process trailingStop from request body
    const finalTrailingStop = typeof trailingStop === 'number' && trailingStop > 0 ? trailingStop : null;
    const finalTrailingType = finalTrailingStop ? 'automatic' : 'manual';

    const position = await db.tradingPosition.create({
      data: {
        pair,
        direction,
        lotSize,
        entryPrice,
        currentPrice: entryPrice,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
        trailingStop: finalTrailingStop,
        trailingType: finalTrailingType,
        pipValue,
        riskAmount: calcRiskAmount,
        rewardAmount: calcRewardAmount,
        strategy: strategy ?? null,
        marketCondition: marketCondition ?? null,
        aiConfidence: aiConfidence ?? null,
        leverage: config.leverage,
        commission: config.commissionPerLot * lotSize,
        status: 'open',
      },
    });

    // Log position open
    try {
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'trading',
          message: `Opened ${direction} ${pair} @ ${entryPrice}, lot: ${lotSize}, SL: ${stopLoss ?? 'N/A'}, TP: ${takeProfit ?? 'N/A'}${finalTrailingStop ? `, TS: ${finalTrailingStop}p` : ''}`,
          pair,
          metadata: JSON.stringify({ positionId: position.id, lotSize, strategy }),
        },
      });
    } catch {
      // Non-critical
    }

    // Send email notification on position open
    sendPositionOpenEmail(pair, direction, lotSize, entryPrice, stopLoss ?? null, takeProfit ?? null).catch(() => {});

    // F-03: Check margin call / stop-out after position creation
    await checkMarginCall();

    return NextResponse.json({ position }, { status: 201 });
  } catch (error) {
    logApiError('Positions', error);
    return NextResponse.json(
      { error: 'Failed to create position' },
      { status: 500 }
    );
  }
}

// F-03: Margin call / stop-out check
async function checkMarginCall() {
  try {
    const tradingConfig = await db.tradingConfig.findFirst();
    if (!tradingConfig) return;

    const openPositions = await db.tradingPosition.findMany({ where: { status: 'open' } });
    if (openPositions.length === 0) return;

    // Calculate total equity (balance + sum of PnL)
    const totalPnl = openPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
    const equity = tradingConfig.accountBalance + totalPnl;

    // Calculate total margin used (simplified: notional / leverage)
    let totalMarginUsed = 0;
    for (const pos of openPositions) {
      const pipCfg = PAIR_PIP_VALUES[pos.pair as ForexPair] || { pipSize: 0.0001 };
      const exchangeRate = pos.pair === 'USDJPY' ? (pos.currentPrice || pos.entryPrice) : 1;
      const contractSize = 100000;
      totalMarginUsed += (pos.lotSize * contractSize) / ((tradingConfig.leverage || 100) * exchangeRate);
    }

    if (totalMarginUsed <= 0) return;
    const marginLevel = (equity / totalMarginUsed) * 100;

    // Stop-out: force-close worst PnL position
    if (marginLevel <= tradingConfig.stopOutLevel) {
      const worst = openPositions.reduce((w, p) => ((p.pnl ?? 0) < (w.pnl ?? 0) ? p : w), openPositions[0]);
      if (worst) {
        const closePrice = worst.currentPrice || worst.entryPrice;
        const pipCfg = PAIR_PIP_VALUES[worst.pair as ForexPair] || { standard: 10, pipSize: 0.0001 };
        const pipValue = pipCfg.standard * worst.lotSize;
        const priceDiff = worst.direction === 'BUY'
          ? closePrice - worst.entryPrice
          : worst.entryPrice - closePrice;
        const pnlPips = priceDiff / pipCfg.pipSize;
        const pnl = pnlPips * pipValue - worst.commission;

        await db.tradingPosition.update({
          where: { id: worst.id },
          data: { currentPrice: closePrice, pnl, pnlPips, status: 'closed', closedAt: new Date() },
        });
        try {
          await db.activityLog.create({
            data: {
              level: 'error',
              category: 'trading',
              message: `STOP-OUT: Force-closed ${worst.direction} ${worst.pair} (margin level ${marginLevel.toFixed(1)}%)`,
              pair: worst.pair,
              metadata: JSON.stringify({ positionId: worst.id, marginLevel, pnl }),
            },
          });
        } catch { /* non-critical */ }
      }
    }
    // Margin call warning
    else if (marginLevel <= tradingConfig.marginCallLevel) {
      try {
        await db.activityLog.create({
          data: {
            level: 'warn',
            category: 'trading',
            message: `MARGIN CALL: Margin level at ${marginLevel.toFixed(1)}% (threshold: ${tradingConfig.marginCallLevel}%)`,
            metadata: JSON.stringify({ marginLevel, totalMarginUsed, equity }),
          },
        });
      } catch { /* non-critical */ }
    }
  } catch (err) {
    // Non-critical — don't let margin check failures break the main flow
    safeLog({ level: 'error', route: 'Positions', message: 'Margin call check failed', error: err instanceof Error ? err.message : String(err) });
  }
}

// PUT - Update position (close, modify SL/TP, trailing stop)
export async function PUT(request: NextRequest) {
  // API-AUDIT-005: Rate limit BEFORE auth
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
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
      // RD-001: Use spread-aware pricing for close
      let closePrice = currentPrice || 0;
      if (!closePrice || closePrice === 0) {
        const bidAsk = await getCurrentBidAsk(existing.pair, existing.direction as 'BUY' | 'SELL');
        if (bidAsk) closePrice = bidAsk.price;
        else {
          const mid = await getCurrentMidPrice(existing.pair);
          if (mid) closePrice = mid;
        }
      }
      if (!closePrice || closePrice === 0) {
        return NextResponse.json(
          { error: 'currentPrice is required and could not be determined from market data' },
          { status: 400 }
        );
      }
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

      // Send email notification on position close
      sendPositionCloseEmail(existing.pair, existing.direction, existing.lotSize, existing.entryPrice, closePrice, pnl).catch(() => {});

      // F-03: Check margin call / stop-out after closing position
      await checkMarginCall();

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
      // TS-07: Validate trailing stop value
      if (typeof trailingStop !== 'number' || trailingStop < 1 || trailingStop > 100) {
        return NextResponse.json({ error: 'trailingStop must be between 1 and 100 pips' }, { status: 400 });
      }
      const updated = await db.tradingPosition.update({
        where: { id },
        data: {
          trailingStop,
          trailingType: 'manual',
        },
      });

      // TS-04: Log manual trailing stop change
      try {
        await db.activityLog.create({
          data: {
            level: 'info',
            category: 'trailing_stop',
            message: `Manual trailing stop set: ${existing.pair} ${trailingStop} pips`,
            pair: existing.pair,
            metadata: JSON.stringify({ positionId: id, trailingStop }),
          },
        });
      } catch {
        // Non-critical
      }

      return NextResponse.json({ position: updated });
    }

    return NextResponse.json({ error: 'Invalid action. Use: close, modify, update_price, trailing_stop' }, { status: 400 });
  } catch (error) {
    logApiError('Positions', error);
    return NextResponse.json(
      { error: 'Failed to update position' },
      { status: 500 }
    );
  }
}

// DELETE - Cancel position
export async function DELETE(request: NextRequest) {
  // API-AUDIT-005: Rate limit BEFORE auth
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
    logApiError('Positions', error);
    return NextResponse.json(
      { error: 'Failed to cancel position' },
      { status: 500 }
    );
  }
}
