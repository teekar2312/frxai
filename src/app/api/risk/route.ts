import { NextRequest, NextResponse } from 'next/server';
import type { ForexPair, RiskCalculation } from '@/lib/trading-types';
import { PAIR_PIP_VALUES, FINEX_CONFIG } from '@/lib/trading-types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      accountBalance,
      pair,
      stopLossPips,
      riskPerTrade,
      dailyRiskLimit,
      currentPositions = 0,
      todayRiskUsed = 0,
    } = body as {
      accountBalance: number;
      pair: ForexPair;
      stopLossPips: number;
      riskPerTrade?: number;
      dailyRiskLimit?: number;
      currentPositions?: number;
      todayRiskUsed?: number;
    };

    // Validate inputs
    if (!accountBalance || accountBalance <= 0) {
      return NextResponse.json({ error: 'accountBalance must be positive' }, { status: 400 });
    }
    if (!pair || !PAIR_PIP_VALUES[pair]) {
      return NextResponse.json(
        { error: `Invalid pair. Must be one of: ${Object.keys(PAIR_PIP_VALUES).join(', ')}` },
        { status: 400 }
      );
    }
    if (!stopLossPips || stopLossPips <= 0) {
      return NextResponse.json({ error: 'stopLossPips must be positive' }, { status: 400 });
    }

    const riskPct = riskPerTrade ?? 0.75;
    const dailyLimit = dailyRiskLimit ?? 2.5;
    const pipConfig = PAIR_PIP_VALUES[pair];
    const leverage = FINEX_CONFIG.leverage;

    // Risk amount in account currency
    const riskAmount = accountBalance * (riskPct / 100);

    // Remaining daily risk
    const remainingDailyRisk = Math.max(0, (dailyLimit / 100) * accountBalance - todayRiskUsed);

    // Check if daily risk limit would be exceeded
    const canTrade = remainingDailyRisk >= riskAmount;

    // Lot size calculation based on FINEX Indonesia specs
    // Formula: Risk Amount / (Stop Loss Pips * Pip Value per Standard Lot)
    // Pip Value per Standard Lot = PAIR_PIP_VALUES[pair].standard
    let lotSize = riskAmount / (stopLossPips * pipConfig.standard);

    // Apply FINEX constraints
    lotSize = Math.max(FINEX_CONFIG.minLot, lotSize);
    lotSize = Math.min(FINEX_CONFIG.maxLotPerOrder, lotSize);
    // Round to 2 decimal places
    lotSize = parseFloat(lotSize.toFixed(2));

    // Actual pip value for the calculated lot size
    const pipValue = pipConfig.standard * lotSize;

    // Potential loss = Stop Loss Pips * Pip Value
    const potentialLoss = stopLossPips * pipValue;

    // Suggested take profit based on risk:reward ratio
    const suggestedTPPips = Math.round(stopLossPips * FINEX_CONFIG.riskRewardRatio);
    const potentialProfit = suggestedTPPips * pipValue;

    // Risk:Reward ratio
    const riskRewardRatio = potentialLoss > 0 ? potentialProfit / potentialLoss : 0;

    // Margin required for the position
    const contractSize = 100000; // Standard lot
    const marginRequired = (lotSize * contractSize * pipConfig.pipSize) / leverage;

    // Margin as percentage of account
    const marginPct = accountBalance > 0 ? (marginRequired / accountBalance) * 100 : 0;

    const result: RiskCalculation = {
      accountBalance,
      riskPerTrade: riskPct,
      riskAmount: parseFloat(riskAmount.toFixed(2)),
      stopLossPips,
      lotSize,
      pipValue: parseFloat(pipValue.toFixed(2)),
      potentialLoss: parseFloat(potentialLoss.toFixed(2)),
      potentialProfit: parseFloat(potentialProfit.toFixed(2)),
      riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
      dailyRiskLimit: dailyLimit,
      remainingDailyRisk: parseFloat(remainingDailyRisk.toFixed(2)),
      maxPositions: FINEX_CONFIG.maxOpenPositions - currentPositions,
      currentPositions,
    };

    // Additional FINEX-specific information
    const extras = {
      canTrade,
      suggestedTPPips,
      marginRequired: parseFloat(marginRequired.toFixed(2)),
      marginPct: parseFloat(marginPct.toFixed(2)),
      commission: parseFloat((FINEX_CONFIG.commissionPerLot * lotSize).toFixed(2)),
      leverage,
      marginCallLevel: FINEX_CONFIG.marginCallLevel,
      stopOutLevel: FINEX_CONFIG.stopOutLevel,
      pipSize: pipConfig.pipSize,
      warnings: [] as string[],
    };

    // Generate warnings
    if (!canTrade) {
      extras.warnings.push(`Daily risk limit: only $${remainingDailyRisk.toFixed(2)} remaining`);
    }
    if (marginPct > 50) {
      extras.warnings.push(`High margin usage: ${marginPct.toFixed(1)}% of account`);
    }
    if (currentPositions >= FINEX_CONFIG.maxOpenPositions - 1) {
      extras.warnings.push(`Near max positions limit: ${currentPositions}/${FINEX_CONFIG.maxOpenPositions}`);
    }
    if (lotSize === FINEX_CONFIG.maxLotPerOrder) {
      extras.warnings.push(`Lot size capped at maximum: ${FINEX_CONFIG.maxLotPerOrder}`);
    }
    if (lotSize === FINEX_CONFIG.minLot && riskAmount > stopLossPips * pipConfig.standard * FINEX_CONFIG.minLot) {
      extras.warnings.push(`Lot size at minimum (${FINEX_CONFIG.minLot}) - risk reduced from ${riskPct}%`);
    }

    return NextResponse.json({
      success: true,
      risk: result,
      details: extras,
    });
  } catch (error) {
    console.error('[Risk API] Error:', error);
    return NextResponse.json(
      { error: 'Risk calculation failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
