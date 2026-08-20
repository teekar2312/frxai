import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, CandleData } from '@/lib/trading-types';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';
import { detectMarketCondition } from '@/lib/indicators';
import type { OHLCV } from '@/lib/indicators';

export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  try {
    const body = await request.json();
    const { candles, pair } = body as { candles: CandleData[]; pair?: ForexPair };

    if (!candles || !Array.isArray(candles) || candles.length < 5) {
      return NextResponse.json(
        { error: 'At least 5 candles are required to detect market condition' },
        { status: 400 }
      );
    }

    // M-5: Upper bound on candle count
    if (candles.length > 10000) {
      return NextResponse.json({ error: 'Too many candles (max 10000)' }, { status: 400 });
    }

    const ohlcv: OHLCV[] = candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0,
    }));

    const condition = detectMarketCondition(ohlcv);

    // If pair is provided, look for AI analysis
    if (pair) {
      try {
        const aiAnalysis = await db.aiAnalysis.findFirst({
          where: { pair, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        });

        if (aiAnalysis) {
          const technicalCondition = condition;
          const aiCondition = aiAnalysis.marketCondition;
          const agree = technicalCondition === aiCondition;
          const combinedCondition = agree ? technicalCondition : technicalCondition;

          return NextResponse.json({
            success: true,
            technicalCondition,
            aiCondition,
            combinedCondition,
            disagreement: !agree,
            aiConfidence: aiAnalysis.confidence,
            aiRecommendation: aiAnalysis.recommendation,
            aiReasoning: (aiAnalysis.reasoning || '').slice(0, 200),
            candlesAnalyzed: candles.length,
            timestamp: Date.now(),
          });
        }
      } catch {
        // Non-critical — fall through to technical-only response
      }
    }

    return NextResponse.json({
      success: true,
      condition,
      candlesAnalyzed: candles.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    logApiError('Market Condition', error);
    return NextResponse.json(
      { error: 'Failed to detect market condition' },
      { status: 500 }
    );
  }
}
