import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import type { ForexPair, AiAnalysisResult, MarketCondition, StrategyName, IndicatorValue } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';

const VALID_PAIRS: ForexPair[] = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'];
const VALID_CONDITIONS: MarketCondition[] = ['trending', 'range_bound', 'high_volatility', 'low_volatility'];
const VALID_RECOMMENDATIONS = ['BUY', 'SELL', 'HOLD', 'AVOID'] as const;
const VALID_STRATEGIES: StrategyName[] = [
  'MA_RIBBON', 'MOMENTUM_SCALPING', 'PIVOT_POINT', 'EMA_CROSSOVER',
  'RMI_TREND_SYNC', 'LINEAR_REGRESSION', 'EMA_RSI_FILTER',
];
const VALID_RISK_LEVELS = ['low', 'medium', 'high'] as const;

function buildAnalysisPrompt(
  pair: ForexPair,
  marketData: Record<string, unknown>,
  news: Array<{ title: string; description: string; impact: string; sentiment: string }>
): string {
  const pairDisplay = pair.replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2');
  const newsSummary = news.length > 0
    ? news.slice(0, 15).map((n, i) =>
        `${i + 1}. [${n.impact.toUpperCase()}] ${n.title} (${n.sentiment}) - ${(n.description || '').slice(0, 150)}`
      ).join('\n')
    : 'No recent news available.';

  return `You are an expert forex market analyst specializing in ${pairDisplay} trading. Analyze the following data and provide a comprehensive trading recommendation.

## PAIR: ${pairDisplay}

## CURRENT MARKET DATA
${JSON.stringify(marketData, null, 2)}

## RECENT NEWS & EVENTS
${newsSummary}

## ANALYSIS REQUIREMENTS
Analyze considering these factors:
1. **Central Bank Policy**: ECB, Fed, BOJ, BOE - interest rate decisions, forward guidance, QE/tapering
2. **Economic Data**: NFP, CPI, PPI, GDP, unemployment rate, retail sales, PMI
3. **Political/Geopolitical**: Elections, trade wars, sanctions, geopolitical tensions
4. **Fiscal Policy**: Government spending, tax policies, budget deficits
5. **Commodity Prices**: Especially for XAUUSD - gold prices, oil, risk sentiment
6. **Market Sentiment**: Risk-on/risk-off, VIX, safe-haven flows, carry trade
7. **Breaking News**: Any urgent developments

## REQUIRED OUTPUT FORMAT
Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "marketCondition": "<one of: trending, range_bound, high_volatility, low_volatility>",
  "recommendation": "<one of: BUY, SELL, HOLD, AVOID>",
  "confidence": <float 0.0 to 1.0>,
  "reasoning": "<detailed 3-5 sentence analysis>",
  "newsImpact": "<summary of how news affects this pair>",
  "bestStrategy": "<one of: MA_RIBBON, MOMENTUM_SCALPING, PIVOT_POINT, EMA_CROSSOVER, RMI_TREND_SYNC, LINEAR_REGRESSION, EMA_RSI_FILTER>",
  "riskLevel": "<one of: low, medium, high>",
  "entryPrice": <number or null>,
  "stopLoss": <number or null>,
  "takeProfit": <number or null>,
  "indicators": [
    {"name": "<indicator name>", "value": <number>, "signal": "<bullish|bearish|neutral>"}
  ]
}

CRITICAL RULES:
- Return ONLY raw JSON, no markdown formatting, no code fences
- confidence must be between 0.0 and 1.0
- Provide specific entry/SL/TP prices
- SL should ensure at least 1:1.5 risk:reward ratio
- Consider market condition when selecting best strategy
- If major news events are imminent, recommend HOLD or AVOID`;
}

export async function POST(request: NextRequest) {
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  const rateCheck = checkRateLimit(clientIp(request), 'analysis');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  try {
    const body = await request.json();
    const { pair, marketData } = body as {
      pair: ForexPair;
      marketData: Record<string, unknown>;
      news?: Array<{ title: string; description: string; impact: string; sentiment: string }>;
    };

    // RD-002: Always fetch news server-side from DB — ignore client-sent news
    let news: Array<{ title: string; description: string; impact: string; sentiment: string }> | undefined;
    try {
      const recentNews = await db.newsItem.findMany({
        where: { pair: pair, publishedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: { title: true, description: true, impact: true, sentiment: true },
      });
      if (recentNews.length > 0) {
        news = recentNews.map(n => ({
          title: n.title,
          description: (n.description || '').slice(0, 150),
          impact: n.impact || 'low',
          sentiment: n.sentiment || 'neutral',
        }));
      }
    } catch {
      // Non-critical — continue without news
    }

    if (!pair || !VALID_PAIRS.includes(pair)) {
      return NextResponse.json(
        { error: `Invalid pair. Must be one of: ${VALID_PAIRS.join(', ')}` },
        { status: 400 }
      );
    }

    if (!marketData) {
      return NextResponse.json(
        { error: 'marketData is required' },
        { status: 400 }
      );
    }

    const prompt = buildAnalysisPrompt(pair, marketData, news || []);

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'You are a forex market analysis AI. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    });

    const responseText = completion.choices?.[0]?.message?.content || '';

    if (!responseText) {
      return NextResponse.json({ error: 'Empty AI response' }, { status: 502 });
    }

    // Parse JSON from response
    let cleanJson = responseText.trim();
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleanJson = jsonMatch[0];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      logApiError('Analysis', new Error(`Failed to parse AI response: ${responseText.slice(0, 500)}`));
      return NextResponse.json(
        { error: 'Failed to parse AI analysis response' },
        { status: 502 }
      );
    }

    const marketCondition = VALID_CONDITIONS.includes(parsed.marketCondition as MarketCondition)
      ? (parsed.marketCondition as MarketCondition) : 'range_bound';
    const recommendation = VALID_RECOMMENDATIONS.includes(parsed.recommendation as typeof VALID_RECOMMENDATIONS[number])
      ? (parsed.recommendation as AiAnalysisResult['recommendation']) : 'HOLD';
    const confidence = typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5;
    const bestStrategy = VALID_STRATEGIES.includes(parsed.bestStrategy as StrategyName)
      ? (parsed.bestStrategy as StrategyName) : 'EMA_CROSSOVER';
    const riskLevel = VALID_RISK_LEVELS.includes(parsed.riskLevel as typeof VALID_RISK_LEVELS[number])
      ? (parsed.riskLevel as AiAnalysisResult['riskLevel']) : 'medium';

    const analysisResult: AiAnalysisResult = {
      pair,
      marketCondition,
      confidence,
      recommendation,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Analysis completed',
      newsImpact: typeof parsed.newsImpact === 'string' ? parsed.newsImpact : 'News analyzed',
      riskLevel,
      entryPrice: typeof parsed.entryPrice === 'number' ? parsed.entryPrice : undefined,
      stopLoss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : undefined,
      takeProfit: typeof parsed.takeProfit === 'number' ? parsed.takeProfit : undefined,
      bestStrategy,
      indicators: Array.isArray(parsed.indicators) ? (parsed.indicators as IndicatorValue[]).slice(0, 20) : [],
    };

    // Store in database
    try {
      await db.aiAnalysis.create({
        data: {
          pair,
          marketCondition,
          confidence,
          recommendation: recommendation,
          reasoning: analysisResult.reasoning,
          strategyUsed: bestStrategy,
          indicatorsUsed: JSON.stringify(analysisResult.indicators),
          newsImpact: analysisResult.newsImpact,
          riskLevel,
          entryPrice: analysisResult.entryPrice,
          stopLoss: analysisResult.stopLoss,
          takeProfit: analysisResult.takeProfit,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
    } catch (dbErr) {
      safeLog({ level: 'warn', route: 'Analysis', message: 'DB save failed', error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
    }

    try {
      await db.activityLog.create({
        data: {
          level: 'info', category: 'analysis',
          message: `AI analysis completed for ${pair}: ${recommendation} (confidence: ${(confidence * 100).toFixed(1)}%)`,
          pair,
        },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({ success: true, analysis: analysisResult, timestamp: Date.now() });
  } catch (error) {
    logApiError('Analysis', error);
    try {
      await db.activityLog.create({
        data: {
          level: 'error', category: 'analysis',
          message: `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });
    } catch { /* ignore */ }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const analyses = await db.aiAnalysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return NextResponse.json({ analyses });
  } catch (error) {
    logApiError('Analysis', error);
    return NextResponse.json({ error: 'Failed to fetch analyses' }, { status: 500 });
  }
}
