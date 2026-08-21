import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';
import type { ForexPair } from '@/lib/trading-types';

const AUTO_TRADE_PAIRS: ForexPair[] = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
const MIN_CONFIDENCE = 0.6;

// POST - Process auto-execution engine
export async function POST(request: NextRequest) {
  // Skip rate limit for internal scheduler calls
  const isInternalCall = request.headers.get('x-internal-call') === 'true';
  if (!isInternalCall) {
    const rateCheck = checkRateLimit(clientIp(request), 'trade');
    if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  }

  const auth = isInternalCall ? { authorized: true } : requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  try {
    // 1. Check if autoTrading is enabled in TradingConfig
    const config = await db.tradingConfig.findFirst();
    if (!config || !config.autoTrading) {
      return NextResponse.json(
        { error: 'Auto-trading is disabled in settings', executed: [] },
        { status: 403 }
      );
    }

    // 2. Check max open positions
    const openCount = await db.tradingPosition.count({ where: { status: 'open' } });
    if (openCount >= config.maxOpenPositions) {
      return NextResponse.json({
        message: 'Max open positions reached',
        executed: [],
      });
    }

    // 3. Fetch latest AI analysis for each pair
    const analyses = await db.aiAnalysis.findMany({
      where: {
        pair: { in: AUTO_TRADE_PAIRS },
        recommendation: { in: ['BUY', 'SELL'] },
        confidence: { gte: MIN_CONFIDENCE },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Deduplicate: take only the latest analysis per pair
    const latestByPair = new Map<string, (typeof analyses)[0]>();
    for (const a of analyses) {
      if (!latestByPair.has(a.pair)) {
        latestByPair.set(a.pair, a);
      }
    }

    const executed: Array<{
      pair: string;
      direction: string;
      confidence: number;
      positionId: string;
    }> = [];

    // 4. For each qualifying analysis, create a position
    for (const [pair, analysis] of latestByPair) {
      if (!analysis.entryPrice || !analysis.stopLoss || !analysis.takeProfit) {
        safeLog({
          level: 'warn',
          route: 'AutoExecute',
          message: `Skipping ${pair}: analysis missing entry/SL/TP`,
          pair,
        });
        continue;
      }

      const direction = analysis.recommendation;
      if (direction !== 'BUY' && direction !== 'SELL') continue;

      // Check if there's already an open position for this pair
      const existingOpen = await db.tradingPosition.findFirst({
        where: { pair, status: 'open' },
      });
      if (existingOpen) {
        safeLog({
          level: 'info',
          route: 'AutoExecute',
          message: `Skipping ${pair}: already has open position`,
          pair,
        });
        continue;
      }

      // Validate SL/TP direction
      if (direction === 'BUY' && (analysis.stopLoss >= analysis.entryPrice || analysis.takeProfit <= analysis.entryPrice)) continue;
      if (direction === 'SELL' && (analysis.stopLoss <= analysis.entryPrice || analysis.takeProfit >= analysis.entryPrice)) continue;

      // Create the position
      const position = await db.tradingPosition.create({
        data: {
          pair,
          direction,
          lotSize: analysis.lotSize || 0.01,
          entryPrice: analysis.entryPrice,
          currentPrice: analysis.entryPrice,
          stopLoss: analysis.stopLoss,
          takeProfit: analysis.takeProfit,
          strategy: analysis.strategyUsed || 'AUTO',
          marketCondition: analysis.marketCondition,
          aiConfidence: analysis.confidence,
          riskLevel: analysis.riskLevel,
          aiRecommendation: analysis.recommendation,
          leverage: config.leverage,
          commission: config.commissionPerLot * (analysis.lotSize || 0.01),
          status: 'open',
        },
      });

      // 5. Create in-app notification
      await db.notification.create({
        data: {
          type: 'auto_trade',
          title: `Auto-Trade: ${direction} ${pair}`,
          message: `Auto-executed ${direction} ${pair} @ ${analysis.entryPrice} (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`,
          pair,
          data: JSON.stringify({
            positionId: position.id,
            confidence: analysis.confidence,
            strategy: analysis.strategyUsed,
            entryPrice: analysis.entryPrice,
            stopLoss: analysis.stopLoss,
            takeProfit: analysis.takeProfit,
          }),
        },
      });

      // 6. Log to activity log
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'trading',
          message: `AUTO-EXECUTE: ${direction} ${pair} @ ${analysis.entryPrice}, confidence: ${(analysis.confidence * 100).toFixed(1)}%`,
          pair,
          metadata: JSON.stringify({ positionId: position.id, confidence: analysis.confidence, strategy: analysis.strategyUsed }),
        },
      });

      executed.push({
        pair,
        direction,
        confidence: analysis.confidence,
        positionId: position.id,
      });
    }

    safeLog({
      level: 'info',
      route: 'AutoExecute',
      message: `Auto-execution complete: ${executed.length} trade(s) executed`,
    });

    return NextResponse.json({ executed });
  } catch (error) {
    logApiError('AutoExecute', error);
    return NextResponse.json({ error: 'Auto-execution failed', executed: [] }, { status: 500 });
  }
}
