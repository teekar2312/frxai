import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, RiskCalculation } from '@/lib/trading-types';
import { PAIR_PIP_VALUES } from '@/lib/trading-types';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';
import { getCachedQuote } from '@/lib/price-cache';

export async function GET() {
  try {
    const serverConfig = await db.tradingConfig.findFirst();
    if (!serverConfig) {
      return NextResponse.json({ todayRiskUsed: 0, dailyRiskLimit: 2.5, dailyTargetReached: false });
    }

    // RISK-001: Compute actual today's risk used from closed positions
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayClosed = await db.tradingPosition.findMany({
      where: { status: 'closed', closedAt: { gte: todayStart } },
      select: { pnl: true },
    });
    const todayLoss = todayClosed.filter(p => p.pnl < 0).reduce((sum, p) => sum + Math.abs(p.pnl), 0);
    const todayProfit = todayClosed.filter(p => p.pnl > 0).reduce((sum, p) => sum + p.pnl, 0);
    const dailyRiskUsed = serverConfig.accountBalance > 0 ? (todayLoss / serverConfig.accountBalance) * 100 : 0;
    const dailyTargetAmount = (serverConfig.dailyTargetMax / 100) * serverConfig.accountBalance;
    const dailyTargetReached = todayProfit >= dailyTargetAmount;

    return NextResponse.json({
      todayRiskUsed: parseFloat(dailyRiskUsed.toFixed(2)),
      dailyRiskLimit: serverConfig.dailyRiskLimit,
      dailyTargetReached,
      todayLoss: parseFloat(todayLoss.toFixed(2)),
      todayProfit: parseFloat(todayProfit.toFixed(2)),
    });
  } catch (error) {
    logApiError('Risk', error);
    return NextResponse.json({ todayRiskUsed: 0, dailyRiskLimit: 2.5, dailyTargetReached: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // S-7E-03: Content-Type validation
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  // R-04/S-6E-01: Rate limiting
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  try {
    const body = await request.json();
    const {
      accountBalance,
      pair,
      stopLossPips,
      riskPerTrade,
      dailyRiskLimit,
      currentPositions: _currentPositions = 0,
      todayRiskUsed: _todayRiskUsed = 0,
      aiConfidence,
      riskLevel,
    } = body as {
      accountBalance: number;
      pair: ForexPair;
      stopLossPips: number;
      riskPerTrade?: number;
      dailyRiskLimit?: number;
      currentPositions?: number;
      todayRiskUsed?: number;
      aiConfidence?: number;
      riskLevel?: 'low' | 'medium' | 'high';
    };

    // RISK-01/02/03: Use server-side values instead of client-provided
    let serverConfig = await db.tradingConfig.findFirst();
    if (!serverConfig) serverConfig = await db.tradingConfig.create({ data: { riskPerTrade: 0.75, stopLossMin: 5, stopLossMax: 15, riskRewardRatio: 1.5, maxOpenPositions: 3, dailyRiskLimit: 2.5, dailyTargetMin: 1, dailyTargetMax: 3, leverage: 100, spreadPip: 0.5, commissionPerLot: 1, marginCallLevel: 50, stopOutLevel: 20, autoTrading: false, autoTrailingStop: false, trailingStopPips: 10, avoidNewsTrading: true, accountBalance: 10000 } });

    const serverBalance = serverConfig.accountBalance;
    const serverPositions = await db.tradingPosition.count({ where: { status: 'open' } });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayClosed = await db.tradingPosition.findMany({
      where: { status: 'closed', closedAt: { gte: todayStart } },
      select: { pnl: true },
    });
    const serverTodayRisk = todayClosed.filter(p => p.pnl < 0).reduce((sum, p) => sum + Math.abs(p.pnl), 0);

    // Server-side values ALWAYS take priority; client values only used as fallback when DB is empty
    const finalBalance = serverBalance > 0 ? serverBalance : (accountBalance && accountBalance > 0 ? accountBalance : serverBalance);
    const finalPositions = serverPositions;
    const finalTodayRisk = serverTodayRisk;
    const finalRiskPct = riskPerTrade ?? serverConfig.riskPerTrade;
    const finalDailyLimit = dailyRiskLimit ?? serverConfig.dailyRiskLimit;

    // Validate inputs
    if (!finalBalance || finalBalance <= 0) {
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

    const pipConfig = PAIR_PIP_VALUES[pair];
    const leverage = serverConfig.leverage;

    // Risk amount in account currency
    const riskAmount = finalBalance * (finalRiskPct / 100);

    // Remaining daily risk
    const remainingDailyRisk = Math.max(0, (finalDailyLimit / 100) * finalBalance - finalTodayRisk);

    // AI confidence-based lot size scaling
    let confidenceFactor = 1.0;
    const aiAdjusted = aiConfidence !== undefined || riskLevel !== undefined;
    let canTrade = remainingDailyRisk >= riskAmount;

    // Lot size calculation based on FINEX Indonesia specs
    // Formula: Risk Amount / (Stop Loss Pips * Pip Value per Standard Lot)
    // Pip Value per Standard Lot = PAIR_PIP_VALUES[pair].standard
    let lotSize = riskAmount / (stopLossPips * pipConfig.standard);

    // Apply server-side constraints from TradingConfig
    const serverMinLot = serverConfig.minLot ?? 0.01;
    const serverMaxLot = serverConfig.maxLotPerOrder ?? 50;
    lotSize = Math.max(serverMinLot, lotSize);
    lotSize = Math.min(serverMaxLot, lotSize);

    if (aiConfidence !== undefined) {
      if (aiConfidence < 0.6) {
        confidenceFactor = 0;
        canTrade = false;
      } else if (aiConfidence < 0.7) {
        confidenceFactor = 0.5;
      } else if (aiConfidence < 0.8) {
        confidenceFactor = 0.75;
      } else if (aiConfidence < 0.9) {
        confidenceFactor = 0.9;
      } else {
        confidenceFactor = 1.0;
      }
    }

    // Apply confidence factor to lot size
    if (confidenceFactor === 0) {
      lotSize = serverMinLot;
    } else {
      lotSize = lotSize * confidenceFactor;
      lotSize = Math.max(serverMinLot, lotSize);
      lotSize = Math.min(serverMaxLot, lotSize);
    }
    // Round to 2 decimal places
    lotSize = parseFloat(lotSize.toFixed(2));

    // Recalculate pip value and potential loss/profit with adjusted lot size
    const pipValue = pipConfig.standard * lotSize;
    const potentialLoss = stopLossPips * pipValue;
    const suggestedTPPips = Math.round(stopLossPips * serverConfig.riskRewardRatio);
    const potentialProfit = suggestedTPPips * pipValue;
    const riskRewardRatio = potentialLoss > 0 ? potentialProfit / potentialLoss : 0;

    // R-03/RISK-003: Fix margin formula — use correct contract size per pair
    // XAUUSD: 100 troy ounces per standard lot (not 100,000)
    // Forex pairs: 100,000 units per standard lot
    const contractSize = pair === 'XAUUSD' ? 100 : 100000;
    // API-AUDIT-007: Try to get current USDJPY rate from price cache; fallback to 150
    const usdjpyQuote = pair === 'USDJPY' ? getCachedQuote('USDJPY') : null;
    const exchangeRate = usdjpyQuote ? usdjpyQuote.quote.mid : (pair === 'USDJPY' ? 150 : 1);
    const marginRequired = (lotSize * contractSize) / (leverage * exchangeRate);

    // Margin as percentage of account
    const marginPct = finalBalance > 0 ? (marginRequired / finalBalance) * 100 : 0;

    const result: RiskCalculation = {
      accountBalance: finalBalance,
      riskPerTrade: finalRiskPct,
      riskAmount: parseFloat(riskAmount.toFixed(2)),
      stopLossPips,
      lotSize,
      pipValue: parseFloat(pipValue.toFixed(2)),
      potentialLoss: parseFloat(potentialLoss.toFixed(2)),
      potentialProfit: parseFloat(potentialProfit.toFixed(2)),
      riskRewardRatio: parseFloat(riskRewardRatio.toFixed(2)),
      dailyRiskLimit: finalDailyLimit,
      remainingDailyRisk: parseFloat(remainingDailyRisk.toFixed(2)),
      maxPositions: serverConfig.maxOpenPositions - finalPositions,
      currentPositions: finalPositions,
    };

    // Additional FINEX-specific information
    const extras = {
      canTrade,
      suggestedTPPips,
      marginRequired: parseFloat(marginRequired.toFixed(2)),
      marginPct: parseFloat(marginPct.toFixed(2)),
      commission: parseFloat((serverConfig.commissionPerLot * lotSize).toFixed(2)),
      leverage,
      // F-05: Read marginCallLevel/stopOutLevel from serverConfig
      marginCallLevel: serverConfig.marginCallLevel,
      stopOutLevel: serverConfig.stopOutLevel,
      pipSize: pipConfig.pipSize,
      warnings: [] as string[],
      aiRiskAdjustment: aiAdjusted ? {
        confidenceFactor,
        riskLevel: riskLevel ?? null,
      } : null,
    };

    // Generate warnings
    if (!canTrade && aiConfidence !== undefined && aiConfidence < 0.6) {
      extras.warnings.push(`AI confidence too low (${aiConfidence}) — trading not recommended`);
    } else if (!canTrade) {
      extras.warnings.push(`Daily risk limit: only $${remainingDailyRisk.toFixed(2)} remaining`);
    }
    if (marginPct > 50) {
      extras.warnings.push(`High margin usage: ${marginPct.toFixed(1)}% of account`);
    }
    if (finalPositions >= serverConfig.maxOpenPositions - 1) {
      extras.warnings.push(`Near max positions limit: ${finalPositions}/${serverConfig.maxOpenPositions}`);
    }
    if (lotSize === serverMaxLot) {
      extras.warnings.push(`Lot size capped at maximum: ${serverMaxLot}`);
    }
    if (lotSize === serverMinLot && riskAmount > stopLossPips * pipConfig.standard * serverMinLot) {
      extras.warnings.push(`Lot size at minimum (${serverMinLot}) - risk reduced from ${finalRiskPct}%`);
    }
    // AI risk level warnings
    if (riskLevel === 'high') {
      extras.warnings.push('⚠️ AI menilai risiko tinggi — pertimbangkan untuk mengurangi ukuran posisi');
    } else if (riskLevel === 'medium') {
      extras.warnings.push('ℹ️ AI menilai risiko sedang — gunakan manajemen risiko ketat');
    }

    return NextResponse.json({
      success: true,
      risk: result,
      details: extras,
      aiAdjusted,
      aiConfidenceUsed: aiConfidence ?? null,
      riskLevelUsed: riskLevel ?? null,
    });
  } catch (error) {
    // S-8E-01: Replace console.error with logApiError
    logApiError('Risk', error);
    return NextResponse.json(
      { error: 'Risk calculation failed' },
      { status: 500 }
    );
  }
}
