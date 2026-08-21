import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { FINEX_CONFIG } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';
import { AI_PROVIDERS, getModelsForProvider, VALID_AI_PROVIDER_IDS } from '@/lib/ai-provider';
import { getEmailConfigStatus } from '@/lib/email-service';

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
  aiProvider: 'zai',
  aiModel: 'default',
};

// GET - Fetch trading config (initialize default if none exists)
export async function GET() {
  try {
    let config;
    try {
      config = await db.tradingConfig.upsert({
        where: { id: 'default' },
        update: {},
        create: { ...DEFAULT_CONFIG },
      });
    } catch (e: unknown) {
      // H14: P2002 race condition — another request already created the default row
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
        config = await db.tradingConfig.findFirst();
      } else throw e;
    }

    const emailStatus = await getEmailConfigStatus();
    return NextResponse.json({ config, emailStatus });
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
  // API-AUDIT-005: Rate limit BEFORE auth
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  try {
    const body = await request.json();

    // Fetch current config for cross-field validation
    const currentConfig = await db.tradingConfig.findUnique({ where: { id: 'default' } });

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
      'aiProvider', 'aiModel', 'notifyEmail',
      'emailOnPositionOpen', 'emailOnPositionClose', 'emailOnAlertTrigger',
    ]);

    const stringFields = ['aiProvider', 'aiModel', 'notifyEmail'];

    // M-7: Handle config reset (H14: P2002-safe)
    if (body.reset === true) {
      await db.tradingConfig.deleteMany({});
      let resetConfig;
      try {
        resetConfig = await db.tradingConfig.create({ data: { ...DEFAULT_CONFIG } });
      } catch (e: unknown) {
        // H14: Race condition — another request already recreated the default row
        if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
          resetConfig = await db.tradingConfig.findFirst();
        } else throw e;
      }
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

    // Email notification fields
    const emailBooleanFields = ['emailOnPositionOpen', 'emailOnPositionClose', 'emailOnAlertTrigger'];

      if (key === 'notifyEmail') {
        const emailVal = String(value).trim();
        if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
          return NextResponse.json({ error: 'Invalid email format for notifyEmail' }, { status: 400 });
        }
        updateData[key] = emailVal || null;
      } else if (emailBooleanFields.includes(key)) {
        updateData[key] = Boolean(value);
      } else if (numericFields.includes(key)) {
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
      } else if (stringFields.includes(key)) {
        // AI-006: Validate AI provider/model fields
        const strVal = String(value);
        if (key === 'aiProvider') {
          if (!VALID_AI_PROVIDER_IDS.includes(strVal as typeof VALID_AI_PROVIDER_IDS[number])) {
            return NextResponse.json(
              { error: `Invalid aiProvider. Must be one of: ${VALID_AI_PROVIDER_IDS.join(', ')}` },
              { status: 400 }
            );
          }
          updateData[key] = strVal;
        } else if (key === 'aiModel') {
          // Validate model belongs to the selected provider (or a provider being set in same request)
          const targetProvider = (updateData.aiProvider || currentConfig?.aiProvider || 'zai') as typeof VALID_AI_PROVIDER_IDS[number];
          const validModels = getModelsForProvider(targetProvider);
          if (validModels.length > 0 && !validModels.some(m => m.id === strVal)) {
            return NextResponse.json(
              { error: `Invalid aiModel for ${AI_PROVIDERS[targetProvider]?.name}. Valid: ${validModels.map(m => m.id).join(', ')}` },
              { status: 400 }
            );
          }
          updateData[key] = strVal;
        }
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
      // BAPPEBTI compliance: only allow 1:100 leverage
      if (updateData.leverage !== 100) {
        return NextResponse.json(
          { error: 'BAPPEBTI compliance: leverage must be 100 (max 1:100)' },
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

    // API-AUDIT-010: Cross-field validation — merge incoming fields with current config
    // so cross-field checks work even when only one field is sent
    const mergedForValidation = { ...currentConfig, ...updateData } as Record<string, unknown>;

    // CFG-03: Cross-field validation on merged values
    if (typeof mergedForValidation.stopLossMin === 'number' && typeof mergedForValidation.stopLossMax === 'number') {
      if (mergedForValidation.stopLossMin >= mergedForValidation.stopLossMax) {
        return NextResponse.json({ error: 'stopLossMin must be less than stopLossMax' }, { status: 400 });
      }
    }
    if (typeof mergedForValidation.marginCallLevel === 'number' && typeof mergedForValidation.stopOutLevel === 'number') {
      if (mergedForValidation.marginCallLevel <= mergedForValidation.stopOutLevel) {
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
