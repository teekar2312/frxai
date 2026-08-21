import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, MarketCondition, StrategyName } from '@/lib/trading-types';
import { STRATEGY_LABELS } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';
import { aiComplete, resolveAiConfig } from '@/lib/ai-provider';
import { generateSimulatedCandles } from '@/lib/sim-candles';
import {
  ema, rsi, macd, atr, bollingerBands, supertrend,
  schaffTrendCycle, linearRegressionChannel, stochastic, momentum,
  williamsR, cci, parabolicSAR, detectMarketCondition,
} from '@/lib/indicators';
import type { OHLCV } from '@/lib/indicators';

const VALID_PAIRS: ForexPair[] = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
const VALID_CONDITIONS: MarketCondition[] = ['trending', 'range_bound', 'high_volatility', 'low_volatility'];
const VALID_RECOMMENDATIONS = ['BUY', 'SELL', 'HOLD', 'AVOID'] as const;
const VALID_STRATEGIES: StrategyName[] = [
  'MA_RIBBON', 'MOMENTUM_SCALPING', 'PIVOT_POINT', 'EMA_CROSSOVER',
  'RMI_TREND_SYNC', 'LINEAR_REGRESSION', 'EMA_RSI_FILTER',
];
const DEFAULT_TIMEFRAMES = ['M15', 'H1', 'H4', 'D1'];
const ALL_VALID_TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

async function computeTimeframeIndicators(pair: ForexPair, timeframe: string): Promise<Record<string, unknown>> {
  const tfSeconds: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 };
  const seconds = tfSeconds[timeframe] || 300;
  const candles = generateSimulatedCandles(pair, 200, seconds);
  const ohlcv: OHLCV[] = candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 }));
  const closes = ohlcv.map(c => c.close);

  const ema5 = ema(closes, 5);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdResult = macd(closes, 12, 26, 9);
  const atr14 = atr(ohlcv, 14);
  const bb = bollingerBands(closes, 20, 2);
  const stResult = supertrend(ohlcv, 10, 3);
  const stoch = stochastic(ohlcv, 14, 3);
  const mom10 = momentum(closes, 10);
  const wr = williamsR(ohlcv, 14);
  const cci20 = cci(ohlcv, 20);
  const psar = parabolicSAR(ohlcv);
  const stc = schaffTrendCycle(closes, 23, 50, 10);
  const lrc = linearRegressionChannel(closes, 20);

  const last = (arr: number[]) => { const v = arr[arr.length - 1]; return v !== undefined && !isNaN(v) ? v : null; };
  const currentPrice = closes[closes.length - 1];
  const marketCondition = detectMarketCondition(ohlcv);

  return {
    pair,
    timeframe,
    currentPrice,
    marketCondition,
    ema: { ema5: last(ema5), ema9: last(ema9), ema21: last(ema21), ema50: last(ema50) },
    rsi: { value: last(rsi14) },
    macd: { line: last(macdResult.macd), signal: last(macdResult.signal), histogram: last(macdResult.histogram) },
    atr: { value: last(atr14) },
    bollingerBands: { upper: last(bb.upper), middle: last(bb.middle), lower: last(bb.lower) },
    supertrend: { direction: last(stResult.direction) },
    stoch: { k: last(stoch.k), d: last(stoch.d) },
    momentum: { value: last(mom10) },
    williamsR: { value: last(wr) },
    cci: { value: last(cci20) },
    parabolicSAR: { value: last(psar) },
    schaffTrendCycle: { value: last(stc) },
    linearRegression: { upper: last(lrc.upper), middle: last(lrc.middle), lower: last(lrc.lower) },
  };
}

function buildMtfPrompt(
  pair: ForexPair,
  timeframeData: Array<{ timeframe: string; indicators: Record<string, unknown> }>,
): string {
  const pairDisplay = pair.replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2');
  const strategyList = Object.keys(STRATEGY_LABELS).join(', ');

  const timeframeSections = timeframeData.map(tf => {
    return `### ${tf.timeframe} Timeframe\n${JSON.stringify(tf.indicators, null, 2)}`;
  }).join('\n\n');

  return `You are an expert forex market analyst performing multi-timeframe analysis for ${pairDisplay}.

## PAIR: ${pairDisplay}
## MULTI-TIMEFRAME ANALYSIS

${timeframeSections}

## ANALYSIS REQUIREMENTS
Analyze ALL timeframes above and provide a COMBINED recommendation considering:
1. **Higher timeframe bias** (H4, D1) should carry more weight than lower timeframes
2. **Timeframe alignment**: Are multiple timeframes showing the same signal?
3. **Confidence strength**: Higher alignment = higher confidence
4. **Conflicts**: Note any conflicting signals between timeframes

## REQUIRED OUTPUT FORMAT
Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "timeframes": [
    {
      "timeframe": "<timeframe>",
      "marketCondition": "<trending|range_bound|high_volatility|low_volatility>",
      "confidence": <float 0.0-1.0>,
      "recommendation": "<BUY|SELL|HOLD|AVOID>",
      "summary": "<brief 1-2 sentence analysis for this timeframe>"
    }
  ],
  "combinedRecommendation": "<BUY|SELL|HOLD|AVOID>",
  "combinedConfidence": <float 0.0-1.0>,
  "reasoning": "<2-3 sentence combined analysis explaining why>",
  "bestStrategy": "<one of: ${strategyList}>",
  "riskLevel": "<low|medium|high>",
  "entryPrice": <number or null>,
  "stopLoss": <number or null>,
  "takeProfit": <number or null>
}

CRITICAL RULES:
- Return ONLY raw JSON, no markdown formatting
- Base analysis on the ACTUAL indicator values
- Higher timeframes (H4, D1) should have more influence on combined recommendation
- combinedConfidence should be higher when multiple timeframes align`;
}

// POST - Multi-timeframe analysis
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'analysis');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const body = await request.json();
    const { pair, timeframes: requestedTimeframes } = body as {
      pair?: ForexPair;
      timeframes?: string[];
    };

    if (!pair || !VALID_PAIRS.includes(pair)) {
      return NextResponse.json(
        { error: `Invalid pair. Must be one of: ${VALID_PAIRS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate and filter timeframes
    const timeframes = (requestedTimeframes || DEFAULT_TIMEFRAMES)
      .filter((tf: string) => ALL_VALID_TIMEFRAMES.includes(tf))
      .slice(0, 8); // Max 8 timeframes

    if (timeframes.length === 0) {
      return NextResponse.json(
        { error: 'No valid timeframes provided' },
        { status: 400 }
      );
    }

    // Compute indicators for each timeframe
    const timeframeData: Array<{ timeframe: string; indicators: Record<string, unknown> }> = [];
    for (const tf of timeframes) {
      const indicators = await computeTimeframeIndicators(pair, tf);
      timeframeData.push({ timeframe: tf, indicators });
    }

    // Resolve AI config
    const config = await db.tradingConfig.upsert({ where: { id: 'default' }, update: {}, create: {} });
    const { provider, model } = resolveAiConfig(config.aiProvider, config.aiModel);

    // Build prompt and call AI
    const prompt = buildMtfPrompt(pair, timeframeData);
    const aiResult = await aiComplete(provider, model, [
      { role: 'system', content: 'You are a forex multi-timeframe analysis AI. Always respond with valid JSON only.' },
      { role: 'user', content: prompt },
    ]);

    if (!aiResult.content) {
      return NextResponse.json({ error: 'Empty AI response' }, { status: 502 });
    }

    // Parse JSON from response
    let cleanJson = aiResult.content.trim();
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleanJson = jsonMatch[0];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      logApiError('MTF-Analysis', new Error(`Failed to parse AI response: ${aiResult.content.slice(0, 500)}`));
      return NextResponse.json({ error: 'Failed to parse AI analysis response' }, { status: 502 });
    }

    // Validate and map parsed data
    const combinedRecommendation = VALID_RECOMMENDATIONS.includes(parsed.combinedRecommendation as typeof VALID_RECOMMENDATIONS[number])
      ? (parsed.combinedRecommendation as 'BUY' | 'SELL' | 'HOLD' | 'AVOID')
      : 'HOLD';
    const combinedConfidence = typeof parsed.combinedConfidence === 'number'
      ? Math.min(1, Math.max(0, parsed.combinedConfidence))
      : 0.5;
    const bestStrategy = VALID_STRATEGIES.includes(parsed.bestStrategy as StrategyName)
      ? (parsed.bestStrategy as StrategyName)
      : 'EMA_CROSSOVER';
    const riskLevel = ['low', 'medium', 'high'].includes(parsed.riskLevel as string)
      ? (parsed.riskLevel as 'low' | 'medium' | 'high')
      : 'medium';

    // Process per-timeframe results
    const rawTimeframes = Array.isArray(parsed.timeframes) ? parsed.timeframes : [];
    const processedTimeframes = rawTimeframes.map((tf: Record<string, unknown>) => {
      const tfName = String(tf.timeframe || 'unknown');
      const matchedIndicators = timeframeData.find(t => t.timeframe === tfName);
      return {
        timeframe: tfName,
        indicators: matchedIndicators?.indicators || {},
        marketCondition: VALID_CONDITIONS.includes(tf.marketCondition as MarketCondition)
          ? tf.marketCondition
          : 'range_bound',
        confidence: typeof tf.confidence === 'number' ? Math.min(1, Math.max(0, tf.confidence)) : 0.5,
        recommendation: VALID_RECOMMENDATIONS.includes(tf.recommendation as typeof VALID_RECOMMENDATIONS[number])
          ? tf.recommendation
          : 'HOLD',
        summary: typeof tf.summary === 'string' ? tf.summary : '',
      };
    });

    // Build the response
    const result = {
      pair,
      timeframes: processedTimeframes,
      combinedRecommendation,
      combinedConfidence,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Multi-timeframe analysis completed',
      bestStrategy,
      riskLevel,
      entryPrice: typeof parsed.entryPrice === 'number' ? parsed.entryPrice : undefined,
      stopLoss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : undefined,
      takeProfit: typeof parsed.takeProfit === 'number' ? parsed.takeProfit : undefined,
    };

    // Store in DB
    try {
      await db.aiAnalysis.create({
        data: {
          pair,
          marketCondition: combinedRecommendation,
          confidence: combinedConfidence,
          recommendation: combinedRecommendation,
          reasoning: result.reasoning,
          strategyUsed: bestStrategy,
          indicatorsUsed: JSON.stringify(processedTimeframes),
          riskLevel,
          entryPrice: result.entryPrice,
          stopLoss: result.stopLoss,
          takeProfit: result.takeProfit,
          aiProvider: aiResult.provider,
          aiModel: aiResult.model,
          timeframes: JSON.stringify(timeframes),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
    } catch (dbErr) {
      safeLog({ level: 'warn', route: 'MTF-Analysis', message: 'DB save failed', error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
    }

    // Activity log
    try {
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'analysis',
          message: `MTF analysis completed for ${pair}: ${combinedRecommendation} (confidence: ${(combinedConfidence * 100).toFixed(1)}%) [${aiResult.provider}/${aiResult.model}]`,
          pair,
        },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      ...result,
      aiProvider: aiResult.provider,
      aiModel: aiResult.model,
      timestamp: Date.now(),
    });
  } catch (error) {
    logApiError('MTF-Analysis', error);
    return NextResponse.json({ error: 'Multi-timeframe analysis failed' }, { status: 500 });
  }
}
