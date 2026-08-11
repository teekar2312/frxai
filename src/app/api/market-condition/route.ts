import { NextRequest, NextResponse } from 'next/server';
import type { CandleData } from '@/lib/trading-types';
import { detectMarketCondition } from '@/lib/indicators';
import type { OHLCV } from '@/lib/indicators';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { candles } = body as { candles: CandleData[] };

    if (!candles || !Array.isArray(candles) || candles.length < 5) {
      return NextResponse.json(
        { error: 'At least 5 candles are required to detect market condition' },
        { status: 400 }
      );
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

    return NextResponse.json({
      success: true,
      condition,
      candlesAnalyzed: candles.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('[Market Condition API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to detect market condition', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
