import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { FINEX_CONFIG } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { logApiError } from '@/lib/safe-log';

const DEFAULT_CONFIG = {
  id: 'default',
  riskPerTrade: 0.75,
  stopLossMin: 5,
  stopLossMax: 15,
  riskRewardRatio: 1.5,
  maxOpenPositions: 3,
  dailyRiskLimit: 2.5,
  dailyTargetMin: 1,
  dailyTargetMax: 3,
  leverage: FINEX_CONFIG.leverage,
  spreadPip: FINEX_CONFIG.spreadPip,
  commissionPerLot: FINEX_CONFIG.commissionPerLot,
  marginCallLevel: FINEX_CONFIG.marginCallLevel,
  stopOutLevel: FINEX_CONFIG.stopOutLevel,
  autoTrading: false,
  autoTrailingStop: false,
  trailingStopPips: 10,
  // D-01/F-07: Add minLot and maxLotPerOrder
  minLot: FINEX_CONFIG.minLot,
  maxLotPerOrder: FINEX_CONFIG.maxLotPerOrder,
  avoidNewsTrading: true,
  accountBalance: 10000,
};

// GET - Fetch trading config (initialize default if none exists)
export async function GET() {
  try {
    const config = await db.tradingConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { ...DEFAULT_CONFIG },
    });

    return NextResponse.json({ config });
  } catch (error) {
    logApiError('Config', error);
    return NextResponse.json(
      { error: 'Failed to fetch config' },
      { status: 500 }
    );
  }
}

// PUT - Update trading config
export async function PUT(request: NextRequest) {
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  try {
    const body = await request.json();

    // Validate numeric fields
    const numericFields = [
      'riskPerTrade', 'stopLossMin', 'stopLossMax', 'riskRewardRatio',
      'maxOpenPositions', 'dailyRiskLimit', 'dailyTargetMin', 'dailyTargetMax',
      'leverage', 'spreadPip', 'commissionPerLot', 'marginCallLevel',
      'stopOutLevel', 'trailingStopPips', 'accountBalance',
      // D-01/F-07: Add minLot and maxLotPerOrder
      'minLot', 'maxLotPerOrder',
    ];

    const updateData: Record<string, unknown> = {};

    const allowedFields = new Set([
      ...numericFields,
      'autoTrading', 'autoTrailingStop', 'avoidNewsTrading',
    ]);

    // M-7: Handle config reset
    if (body.reset === true) {
      await db.tradingConfig.deleteMany({});
      const resetConfig = await db.tradingConfig.create({ data: { ...DEFAULT_CONFIG } });
      try {
        await db.activityLog.create({
          data: { level: 'info', category: 'system', message: 'Trading config reset to defaults' },
        });
      } catch { /* non-critical */ }
      return NextResponse.json({ config: resetConfig });
    }

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (!allowedFields.has(key)) continue; // CFG-02: Reject unknown fields

      if (numericFields.includes(key)) {
        const num = Number(value);
        if (isNaN(num)) {
          return NextResponse.json(
            { error: `Invalid value for ${key}: must be a number` },
            { status: 400 }
          );
        }
        updateData[key] = num;
      } else if (key === 'autoTrading' || key === 'autoTrailingStop' || key === 'avoidNewsTrading') {
        updateData[key] = Boolean(value);
      }
    }

    // Validate constraints
    if (typeof updateData.riskPerTrade === 'number') {
      if (updateData.riskPerTrade < 0.1 || updateData.riskPerTrade > 5) {
        return NextResponse.json(
          { error: 'riskPerTrade must be between 0.1 and 5 percent' },
          { status: 400 }
        );
      }
    }

    if (typeof updateData.maxOpenPositions === 'number') {
      if (updateData.maxOpenPositions < 1 || updateData.maxOpenPositions > FINEX_CONFIG.maxOpenPositions) {
        return NextResponse.json(
          { error: `maxOpenPositions must be between 1 and ${FINEX_CONFIG.maxOpenPositions}` },
          { status: 400 }
        );
      }
    }

    if (typeof updateData.leverage === 'number') {
      if (![100, 200, 300, 500].includes(updateData.leverage)) {
        return NextResponse.json(
          { error: 'leverage must be 100, 200, 300, or 500' },
          { status: 400 }
        );
      }
    }

    if (typeof updateData.stopLossMin === 'number' && (updateData.stopLossMin < 1 || updateData.stopLossMin > 100)) {
      return NextResponse.json({ error: 'stopLossMin must be between 1 and 100 pips' }, { status: 400 });
    }
    if (typeof updateData.stopLossMax === 'number' && (updateData.stopLossMax < 5 || updateData.stopLossMax > 500)) {
      return NextResponse.json({ error: 'stopLossMax must be between 5 and 500 pips' }, { status: 400 });
    }
    if (typeof updateData.dailyRiskLimit === 'number' && (updateData.dailyRiskLimit < 0.1 || updateData.dailyRiskLimit > 20)) {
      return NextResponse.json({ error: 'dailyRiskLimit must be between 0.1 and 20 percent' }, { status: 400 });
    }
    if (typeof updateData.trailingStopPips === 'number' && (updateData.trailingStopPips < 1 || updateData.trailingStopPips > 100)) {
      return NextResponse.json({ error: 'trailingStopPips must be between 1 and 100' }, { status: 400 });
    }
    if (typeof updateData.accountBalance === 'number' && updateData.accountBalance < 100) {
      return NextResponse.json({ error: 'accountBalance must be at least 100' }, { status: 400 });
    }
    if (typeof updateData.commissionPerLot === 'number' && (updateData.commissionPerLot < 0 || updateData.commissionPerLot > 50)) {
      return NextResponse.json({ error: 'commissionPerLot must be between 0 and 50' }, { status: 400 });
    }
    // D-01/F-07: Validate minLot and maxLotPerOrder with FINEX_CONFIG bounds
    if (typeof updateData.minLot === 'number') {
      updateData.minLot = Math.max(FINEX_CONFIG.minLot, Math.min(FINEX_CONFIG.maxLotPerOrder, updateData.minLot));
    }
    if (typeof updateData.maxLotPerOrder === 'number') {
      updateData.maxLotPerOrder = Math.max(FINEX_CONFIG.minLot, Math.min(FINEX_CONFIG.maxLotPerOrder, updateData.maxLotPerOrder));
    }

    // CFG-03: Cross-field validation
    if (typeof updateData.stopLossMin === 'number' && typeof updateData.stopLossMax === 'number') {
      if (updateData.stopLossMin >= updateData.stopLossMax) {
        return NextResponse.json({ error: 'stopLossMin must be less than stopLossMax' }, { status: 400 });
      }
    }
    if (typeof updateData.marginCallLevel === 'number' && typeof updateData.stopOutLevel === 'number') {
      if (updateData.marginCallLevel <= updateData.stopOutLevel) {
        return NextResponse.json({ error: 'marginCallLevel must be greater than stopOutLevel' }, { status: 400 });
      }
    }

    // H-3: Atomic upsert — single operation instead of separate upsert+update (TOCTOU fix)
    const updated = await db.tradingConfig.upsert({
      where: { id: 'default' },
      update: updateData,
      create: { ...DEFAULT_CONFIG, ...updateData },
    });

    // Log config change
    try {
      const changedKeys = Object.keys(updateData);
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'system',
          message: `Trading config updated: ${changedKeys.join(', ')}`,
          metadata: JSON.stringify(updateData),
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({ config: updated });
  } catch (error) {
    logApiError('Config', error);
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 }
    );
  }
}
