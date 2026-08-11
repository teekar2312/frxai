import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { FINEX_CONFIG } from '@/lib/trading-types';

const DEFAULT_CONFIG = {
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
  avoidNewsTrading: true,
  accountBalance: 10000,
};

// GET - Fetch trading config (initialize default if none exists)
export async function GET() {
  try {
    let config = await db.tradingConfig.findFirst();

    if (!config) {
      config = await db.tradingConfig.create({ data: DEFAULT_CONFIG });
    }

    return NextResponse.json({ config });
  } catch (error) {
    console.error('[Config GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch config', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// PUT - Update trading config
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate numeric fields
    const numericFields = [
      'riskPerTrade', 'stopLossMin', 'stopLossMax', 'riskRewardRatio',
      'maxOpenPositions', 'dailyRiskLimit', 'dailyTargetMin', 'dailyTargetMax',
      'leverage', 'spreadPip', 'commissionPerLot', 'marginCallLevel',
      'stopOutLevel', 'trailingStopPips', 'accountBalance',
    ];

    const updateData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;

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
      } else {
        updateData[key] = value;
      }
    }

    // Validate constraints
    if (updateData.riskPerTrade !== undefined) {
      if (updateData.riskPerTrade < 0.1 || updateData.riskPerTrade > 5) {
        return NextResponse.json(
          { error: 'riskPerTrade must be between 0.1 and 5 percent' },
          { status: 400 }
        );
      }
    }

    if (updateData.maxOpenPositions !== undefined) {
      if (updateData.maxOpenPositions < 1 || updateData.maxOpenPositions > FINEX_CONFIG.maxOpenPositions) {
        return NextResponse.json(
          { error: `maxOpenPositions must be between 1 and ${FINEX_CONFIG.maxOpenPositions}` },
          { status: 400 }
        );
      }
    }

    if (updateData.leverage !== undefined) {
      if (![100, 200, 300, 500].includes(updateData.leverage as number)) {
        return NextResponse.json(
          { error: 'leverage must be 100, 200, 300, or 500' },
          { status: 400 }
        );
      }
    }

    // Get or create config
    let config = await db.tradingConfig.findFirst();
    if (!config) {
      config = await db.tradingConfig.create({ data: DEFAULT_CONFIG });
    }

    const updated = await db.tradingConfig.update({
      where: { id: config.id },
      data: updateData,
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
    console.error('[Config PUT] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update config', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
