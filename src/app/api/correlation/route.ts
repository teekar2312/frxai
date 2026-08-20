import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';
import { generateSimulatedCandles } from '@/lib/sim-candles';
import type { ForexPair } from '@/lib/trading-types';

const DEFAULT_PAIRS: ForexPair[] = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
const ALL_PAIRS: ForexPair[] = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
const CANDLE_COUNT = 100;

/**
 * Pearson correlation coefficient between two arrays of returns.
 * Returns value between -1 and 1.
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const meanX = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanY = y.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }

  const denominator = Math.sqrt(sumSqX * sumSqY);
  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Calculate price returns (percentage change) from closes.
 */
function calculateReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  return returns;
}

// GET - Calculate correlation matrix
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const pairsParam = searchParams.get('pairs');

    let pairs: ForexPair[];
    if (pairsParam) {
      const requested = pairsParam.toUpperCase().split(',').map(p => p.trim());
      pairs = requested.filter(p => ALL_PAIRS.includes(p as ForexPair)) as ForexPair[];
      if (pairs.length < 2) {
        return NextResponse.json(
          { error: 'At least 2 valid pairs required. Valid pairs: ' + ALL_PAIRS.join(', ') },
          { status: 400 }
        );
      }
    } else {
      pairs = DEFAULT_PAIRS;
    }

    // Generate H1 candles for each pair
    const pairReturns: Map<string, number[]> = new Map();
    for (const pair of pairs) {
      const candles = generateSimulatedCandles(pair, CANDLE_COUNT, 3600);
      const closes = candles.map(c => c.close);
      const returns = calculateReturns(closes);
      pairReturns.set(pair, returns);
    }

    // Build correlation matrix
    const matrix: number[][] = [];
    for (let i = 0; i < pairs.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < pairs.length; j++) {
        if (i === j) {
          row.push(1.0);
        } else {
          const x = pairReturns.get(pairs[i]) || [];
          const y = pairReturns.get(pairs[j]) || [];
          const corr = pearsonCorrelation(x, y);
          row.push(Math.round(corr * 10000) / 10000);
        }
      }
      matrix.push(row);
    }

    safeLog({
      level: 'debug',
      route: 'Correlation',
      message: `Correlation matrix computed for ${pairs.length} pairs`,
    });

    return NextResponse.json({ pairs, matrix });
  } catch (error) {
    logApiError('Correlation', error);
    return NextResponse.json({ error: 'Failed to compute correlation matrix' }, { status: 500 });
  }
}
