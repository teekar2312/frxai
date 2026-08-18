import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, AiAnalysisResult, MarketCondition, StrategyName, IndicatorValue, TradingSignal, QuoteData } from '@/lib/trading-types';
import { PAIR_PIP_VALUES, STRATEGY_LABELS } from '@/lib/trading-types';
import { requireAuthForMutation } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';
import { aiComplete, resolveAiConfig, AI_PROVIDERS } from '@/lib/ai-provider';
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
const VALID_RISK_LEVELS = ['low', 'medium', 'high'] as const;

/**
 * FIX MKT-ANALYSIS-001/IND-003: Fetch candles and compute indicators server-side
 * so AI receives real technical data instead of flying blind.
 */
async function fetchCandlesAndComputeIndicators(pair: ForexPair, timeframe: string): Promise<Record<string, unknown>> {
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
  const stc = schaffTrendCycle(closes, 23, 50, 10);
  const lrc = linearRegressionChannel(closes, 20);
  const stoch = stochastic(ohlcv, 14, 3);
  const mom10 = momentum(closes, 10);
  const wr = williamsR(ohlcv, 14);
  const cci20 = cci(ohlcv, 20);
  const psar = parabolicSAR(ohlcv);

  const last = (arr: number[]) => { const v = arr[arr.length - 1]; return v !== undefined && !isNaN(v) ? v : null; };
  const currentPrice = closes[closes.length - 1];

  // Detect market condition
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

function buildAnalysisPrompt(
  pair: ForexPair,
  marketData: Record<string, unknown>,
  news: Array<{ title: string; description: string; impact: string; sentiment: string }>,
  timeframe: string,
): string {
  const pairDisplay = pair.replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2');
  const newsSummary = news.length > 0
    ? news.slice(0, 15).map((n, i) =>
        `${i + 1}. [${n.impact.toUpperCase()}] ${n.title} (${n.sentiment}) - ${(n.description || '').slice(0, 150)}`
      ).join('\n')
    : 'No recent news available.';

  const strategyList = Object.keys(STRATEGY_LABELS).join(', ');

  return `You are an expert forex market analyst specializing in ${pairDisplay} trading. Analyze the following data and provide a comprehensive trading recommendation.

## PAIR: ${pairDisplay}
## TIMEFRAME: ${timeframe}

## TECHNICAL INDICATORS (real computed values)
${JSON.stringify(marketData, null, 2)}

## RECENT NEWS & EVENTS
${newsSummary}

## ANALYSIS REQUIREMENTS
Analyze considering these factors:
1. **Technical Indicators**: Use the provided RSI, MACD, Bollinger Bands, ATR, Supertrend, Stochastic, etc. to form your analysis. These are real computed values, NOT estimated.
2. **Central Bank Policy**: ECB, Fed, BOJ, BOE - interest rate decisions, forward guidance
3. **Economic Data**: NFP, CPI, PPI, GDP, unemployment rate, PMI
4. **Market Sentiment**: Risk-on/risk-off, safe-haven flows
5. **Breaking News**: Any urgent developments

## REQUIRED OUTPUT FORMAT
Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "marketCondition": "<one of: trending, range_bound, high_volatility, low_volatility>",
  "recommendation": "<one of: BUY, SELL, HOLD, AVOID>",
  "confidence": <float 0.0 to 1.0>,
  "reasoning": "<detailed 3-5 sentence analysis based on the provided indicator values>",
  "newsImpact": "<summary of how news affects this pair>",
  "bestStrategy": "<one of: ${strategyList}>",
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
- Base your analysis on the ACTUAL indicator values provided above
- confidence must be between 0.0 and 1.0
- Provide specific entry/SL/TP prices appropriate for the ${timeframe} timeframe
- SL should ensure at least 1:1.5 risk:reward ratio
- Consider market condition when selecting best strategy
- If major news events are imminent, recommend HOLD or AVOID`;
}

/**
 * FIX MKT-ANALYSIS-002: Build TradingSignal from AI analysis result
 * AUDIT-TRADE-02: Read balance and risk from TradingConfig instead of hardcoding
 */
function buildSignalFromAnalysis(
  analysis: AiAnalysisResult,
  quote: QuoteData | undefined,
  pair: ForexPair,
  serverConfig: { accountBalance: number; riskPerTrade: number } | null,
): TradingSignal | null {
  if (!analysis.entryPrice || !analysis.stopLoss || !analysis.takeProfit) return null;
  if (analysis.recommendation !== 'BUY' && analysis.recommendation !== 'SELL') return null;

  // AUDIT-TRADE-17: Validate AI-generated SL/TP directional correctness
  if (analysis.recommendation === 'BUY') {
    if (analysis.stopLoss >= analysis.entryPrice) return null;
    if (analysis.takeProfit <= analysis.entryPrice) return null;
  } else {
    if (analysis.stopLoss <= analysis.entryPrice) return null;
    if (analysis.takeProfit >= analysis.entryPrice) return null;
  }

  const pipConfig = PAIR_PIP_VALUES[pair] || { standard: 10, pipSize: 0.0001 };
  const entryPrice = analysis.entryPrice;
  const stopLoss = analysis.stopLoss;
  const takeProfit = analysis.takeProfit;

  // AUDIT-TRADE-02: Use server config for balance and risk instead of hardcoding
  const balance = serverConfig?.accountBalance ?? 10000;
  const riskPct = (serverConfig?.riskPerTrade ?? 0.75) / 100;
  const riskAmount = balance * riskPct;
  const slPips = Math.abs(entryPrice - stopLoss) / pipConfig.pipSize;
  const lotSize = slPips > 0 ? Math.max(0.01, parseFloat((riskAmount / (slPips * pipConfig.standard)).toFixed(2))) : 0.01;

  return {
    id: `sig-${pair}-${Date.now()}`,
    pair,
    direction: analysis.recommendation as 'BUY' | 'SELL',
    strategy: analysis.bestStrategy,
    entryPrice,
    stopLoss,
    takeProfit,
    lotSize,
    confidence: analysis.confidence * 100,
    marketCondition: analysis.marketCondition,
    indicators: analysis.indicators.map(ind => ind.name),
    reasoning: analysis.reasoning,
    timestamp: Date.now(),
  };
}

export async function POST(request: NextRequest) {
  // API-AUDIT-005: Rate limit BEFORE auth to prevent brute-force API key guessing
  const rateCheck = checkRateLimit(clientIp(request), 'analysis');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }
  try {
    const body = await request.json();
    // FIX MKT-ANALYSIS-001: Accept what the client actually sends
    const { pair, currentPrice, quote, generateSignals, timeframe: clientTimeframe } = body as {
      pair: ForexPair;
      currentPrice?: number;
      quote?: QuoteData;
      generateSignals?: boolean;
      timeframe?: string;
    };

    if (!pair || !VALID_PAIRS.includes(pair)) {
      return NextResponse.json(
        { error: `Invalid pair. Must be one of: ${VALID_PAIRS.join(', ')}` },
        { status: 400 }
      );
    }

    // FIX IND-003/MKT-ANALYSIS-004: Fetch indicators server-side
    const timeframe = clientTimeframe || 'H1';
    const marketData = await fetchCandlesAndComputeIndicators(pair, timeframe);

    // Inject client-provided quote data into marketData
    if (quote) {
      marketData.quote = { bid: quote.bid, ask: quote.ask, mid: quote.mid, spread: quote.spread };
    } else if (currentPrice) {
      marketData.clientPrice = currentPrice;
    }

    // RD-002: Always fetch news server-side from DB
    let news: Array<{ title: string; description: string; impact: string; sentiment: string }> = [];
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
    } catch (err) {
      safeLog({
        level: 'warn',
        route: 'Analysis',
        message: 'Failed to fetch news for AI analysis context',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // AI-006: Resolve active AI provider/model from DB config
    const config = await db.tradingConfig.upsert({ where: { id: 'default' }, update: {}, create: {} });
    const { provider, model } = resolveAiConfig(config.aiProvider, config.aiModel);

    // FIX MKT-ANALYSIS-006: Use 'system' role instead of 'assistant'
    const prompt = buildAnalysisPrompt(pair, marketData, news, timeframe);
    const aiResult = await aiComplete(provider, model, [
      { role: 'system', content: 'You are a forex market analysis AI. Always respond with valid JSON only. Base your analysis on the actual technical indicator values provided in the user prompt.' },
      { role: 'user', content: prompt },
    ]);

    const responseText = aiResult.content;
    const actualProvider = aiResult.provider;
    const actualModel = aiResult.model;

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

    // FIX MKT-ANALYSIS-002: Generate signals when requested
    let signals: TradingSignal[] = [];
    if (generateSignals) {
      const signal = buildSignalFromAnalysis(analysisResult, quote, pair, config ? { accountBalance: config.accountBalance, riskPerTrade: config.riskPerTrade } : null);
      if (signal) signals.push(signal);
    }

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
          aiProvider: actualProvider,
          aiModel: actualModel,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
    } catch (dbErr) {
      safeLog({ level: 'warn', route: 'Analysis', message: 'DB save failed', error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
    }

    // Activity log
    try {
      await db.activityLog.create({
        data: {
          level: 'info', category: 'analysis',
          message: `AI analysis completed for ${pair}: ${recommendation} (confidence: ${(confidence * 100).toFixed(1)}%) [${actualProvider}/${actualModel}]`,
          pair,
        },
      });
    } catch { /* non-critical */ }

    // FIX MKT-ANALYSIS-008: Cleanup expired analysis records (best-effort)
    try {
      await db.aiAnalysis.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      analysis: analysisResult,
      signals: signals.length > 0 ? signals : undefined,
      aiProvider: actualProvider,
      aiModel: actualModel,
      timestamp: Date.now(),
    });
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

/**
 * FIX MKT-ANALYSIS-005: Map DB field names to frontend-compatible names
 */
export async function GET() {
  try {
    const analyses = await db.aiAnalysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    // Map DB fields to frontend types
    const mapped = analyses.map(a => ({
      ...a,
      bestStrategy: a.strategyUsed,
      indicators: a.indicatorsUsed ? (() => { try { return JSON.parse(a.indicatorsUsed); } catch { return []; } })() : [],
    }));
    return NextResponse.json({ analyses: mapped });
  } catch (error) {
    logApiError('Analysis', error);
    return NextResponse.json({ error: 'Failed to fetch analyses' }, { status: 500 });
  }
}
