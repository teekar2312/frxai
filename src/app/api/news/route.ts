import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, NewsArticle } from '@/lib/trading-types';
import { FOREX_PAIRS } from '@/lib/trading-types';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

const MARKETAUX_BASE = 'https://api.marketaux.com/v1/news/all';
const MAX_DESCRIPTION_LENGTH = 500;

// MTX-004: More specific entity filters for better forex relevance
const DEFAULT_FILTER_ENTITIES = 'forex, EUR/USD, USD/JPY, GBP/USD, XAU/USD, Federal Reserve, ECB, BOJ, BOE, FOMC, NFP, CPI, PMI, GDP';
const DEFAULT_COUNTRIES = 'us,gb,eu,jp';

// MTX-003: Pair-specific filters
const PAIR_FILTER_MAP: Record<ForexPair, string[]> = {
  EURUSD: ['EUR/USD', 'Euro', 'ECB', 'Eurozone'],
  USDJPY: ['USD/JPY', 'Yen', 'BOJ', 'Japan'],
  GBPUSD: ['GBP/USD', 'Pound', 'Sterling', 'BOE', 'Bank of England'],
  XAUUSD: ['XAU/USD', 'Gold', 'precious metal'],
};

function determineImpact(title: string, description: string): 'high' | 'medium' | 'low' {
  const text = `${title} ${description}`.toLowerCase();
  const highImpactWords = ['nfp', 'rate decision', 'central bank', 'gdp', 'inflation', 'recession', 'war', 'crisis', 'emergency', 'fomc', 'policy'];
  const mediumImpactWords = ['pmi', 'retail sales', 'unemployment', 'cpi', 'ppi', 'employment', 'trade balance', 'manufacturing', 'consumer confidence'];

  if (highImpactWords.some(w => text.includes(w))) return 'high';
  if (mediumImpactWords.some(w => text.includes(w))) return 'medium';
  return 'low';
}

// MTX-005: Improved sentiment with context awareness
function determineSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();
  // Bullish for risk assets
  const positive = ['surge', 'rally', 'gain', 'boost', 'strong', 'growth', 'recovery', 'optimism', 'beat', 'exceed', 'upward', 'hawkish'];
  const negative = ['drop', 'fall', 'crash', 'decline', 'weak', 'recession', 'fear', 'miss', 'below', 'downward', 'tension', 'conflict'];

  let posCount = 0;
  let negCount = 0;

  for (const w of positive) { if (lower.includes(w)) posCount++; }
  for (const w of negative) { if (lower.includes(w)) negCount++; }

  // MTX-005: Contextual overrides for common forex phrases
  if (lower.includes('rate cut') || lower.includes('cuts rate') || lower.includes('stimulus')) posCount += 2;
  if (lower.includes('rate hike') || lower.includes('tightening')) negCount += 1;
  if (lower.includes('dovish')) posCount += 1;
  if (lower.includes('hawkish')) negCount += 0; // hawkish is already in positive (good for USD)

  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

// MTX-006: Don't force EURUSD for generic forex news
function matchPairToNews(title: string, description: string): ForexPair | undefined {
  const text = `${title} ${description}`.toLowerCase();
  // Specific matches first
  if (text.includes('gold') || text.includes('xau') || text.includes('precious metal')) return 'XAUUSD';
  if (text.includes('eur/usd') || text.includes('euro') || text.includes('ecb')) return 'EURUSD';
  if (text.includes('usd/jpy') || text.includes('yen') || text.includes('boj') || text.includes('japan')) return 'USDJPY';
  if (text.includes('gbp/usd') || text.includes('pound') || text.includes('sterling') || text.includes('bank of england') || text.includes('boe')) return 'GBPUSD';
  // Generic forex/dollar news: return undefined (not forced to EURUSD)
  return undefined;
}

// MTX-007: Fixed-dated simulated news
const SIMULATED_NEWS: NewsArticle[] = [
  {
    id: 'sim-1',
    title: 'Federal Reserve Signals Potential Rate Pause Amid Cooling Inflation Data',
    description: 'The Federal Reserve indicated it may hold interest rates steady at the next meeting as recent CPI data shows inflation continuing to cool toward the 2% target.',
    url: '', source: 'Reuters', publishedAt: '2025-01-15T08:00:00Z',
    category: 'central bank', impact: 'high', sentiment: 'positive', pair: 'EURUSD',
  },
  {
    id: 'sim-2',
    title: 'US Non-Farm Payrolls Beat Expectations: 256K Jobs Added',
    description: 'The US labor market remains robust with NFP figures exceeding consensus estimates. Unemployment rate held steady at 4.1%.',
    url: '', source: 'Bloomberg', publishedAt: '2025-01-14T13:30:00Z',
    category: 'economic data', impact: 'high', sentiment: 'negative', pair: 'EURUSD',
  },
  {
    id: 'sim-3',
    title: 'ECB Maintains Rates, Lagarde Hints at Possible Cut in Early 2025',
    description: 'The European Central Bank kept its key rate unchanged. President Lagarde suggested the door remains open for rate cuts.',
    url: '', source: 'Financial Times', publishedAt: '2025-01-14T12:45:00Z',
    category: 'central bank', impact: 'high', sentiment: 'neutral', pair: 'EURUSD',
  },
  {
    id: 'sim-4',
    title: 'Gold Rallies Amid Geopolitical Tensions and Dollar Weakness',
    description: 'XAU/USD surged past $2,650 as escalating Middle East tensions and a softer dollar drove safe-haven demand.',
    url: '', source: 'Kitco News', publishedAt: '2025-01-14T10:00:00Z',
    category: 'commodities', impact: 'high', sentiment: 'positive', pair: 'XAUUSD',
  },
  {
    id: 'sim-5',
    title: 'BOJ Governor Ueda Warns of Possible Rate Hike if Inflation Persists',
    description: 'BOJ Governor stated the central bank may raise interest rates further if wage-driven inflation continues to accelerate, sending USD/JPY lower.',
    url: '', source: 'Nikkei Asia', publishedAt: '2025-01-13T23:00:00Z',
    category: 'central bank', impact: 'high', sentiment: 'negative', pair: 'USDJPY',
  },
  {
    id: 'sim-6',
    title: 'UK GDP Growth Slows to 0.3% in Q3, Below BOE Expectations',
    description: 'The UK economy grew at a slower pace than anticipated in Q3, raising concerns about BOE monetary policy.',
    url: '', source: 'ONS', publishedAt: '2025-01-13T07:00:00Z',
    category: 'economic data', impact: 'medium', sentiment: 'negative', pair: 'GBPUSD',
  },
];

export async function GET(request: NextRequest) {
  // MTX-001: Rate limiting — max 3 req/min to conserve MARKETAUX daily quota
  const rateCheck = checkRateLimit(clientIp(request), 'news');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const apiKey = process.env.MARKETAUX_API_KEY;
    const { searchParams } = new URL(request.url);
    const pairFilter = searchParams.get('pair') as ForexPair | null;

    if (pairFilter && !FOREX_PAIRS.includes(pairFilter as ForexPair)) {
      return NextResponse.json({ error: `Invalid pair. Must be one of: ${FOREX_PAIRS.join(', ')}` }, { status: 400 });
    }

    // Return simulated news if no API key
    if (!apiKey) {
      let news = [...SIMULATED_NEWS];
      if (pairFilter) news = news.filter(n => n.pair === pairFilter || !n.pair);
      return NextResponse.json({ total: news.length, page: 1, limit: 20, news, simulated: true });
    }

    // MTX-002: Read from DB cache first (valid for 5 min)
    const cacheExpiry = new Date(Date.now() - 5 * 60 * 1000);
    const cachedCount = await db.newsItem.count({ where: { publishedAt: { gte: cacheExpiry } } });

    if (cachedCount >= 10) {
      const cachedNews = await db.newsItem.findMany({
        where: { publishedAt: { gte: cacheExpiry } },
        orderBy: { publishedAt: 'desc' },
        take: 50,
      });
      const news: NewsArticle[] = cachedNews.map(item => ({
        id: item.id, title: item.title, description: item.description,
        url: item.url || '', source: item.source, publishedAt: item.publishedAt?.toISOString() || '',
        category: item.category || 'forex', impact: (item.impact as 'high' | 'medium' | 'low') || 'low',
        sentiment: (item.sentiment as 'positive' | 'negative' | 'neutral') || 'neutral',
        pair: (item.pair as ForexPair) || undefined,
      }));
      const filtered = pairFilter ? news.filter(n => n.pair === pairFilter || !n.pair) : news;
      return NextResponse.json({ total: filtered.length, page: 1, limit: 20, news: filtered, cached: true });
    }

    // MTX-009: Validate page
    const page = Math.min(Math.max(1, parseInt(searchParams.get('page') || '1', 10)), 100);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);

    let filterEntities = DEFAULT_FILTER_ENTITIES;
    if (pairFilter && PAIR_FILTER_MAP[pairFilter]) {
      filterEntities = PAIR_FILTER_MAP[pairFilter].join(',');
    }

    const url = new URL(MARKETAUX_BASE);
    url.searchParams.set('countries', DEFAULT_COUNTRIES);
    url.searchParams.set('filter_entities', filterEntities);
    url.searchParams.set('api_token', apiKey);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('page', page.toString());

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        let news = [...SIMULATED_NEWS];
        if (pairFilter) news = news.filter(n => n.pair === pairFilter || !n.pair);
        return NextResponse.json({ total: news.length, page: 1, limit: 20, news, simulated: true, fallback: true });
      }

      const data = await res.json();
      const rawNews = data.data || [];

      const news: NewsArticle[] = rawNews.map((article: Record<string, unknown>, index: number) => {
        const title = (article.title as string) || '';
        const description = (article.description as string) || '';
        const pair = matchPairToNews(title, description);

        return {
          id: (article.uuid as string) || `news-${Date.now()}-${index}`,
          title,
          description: description.slice(0, MAX_DESCRIPTION_LENGTH), // MTX-008: consistent truncation
          url: (article.url as string) || '',
          source: (article.source as string) || 'Unknown',
          publishedAt: (article.published_at as string) || new Date().toISOString(),
          category: (article.snippet as string) ? 'forex' : 'general',
          impact: determineImpact(title, description),
          sentiment: determineSentiment(`${title} ${description}`),
          pair,
        };
      });

      const filteredNews = pairFilter ? news.filter(n => n.pair === pairFilter || !n.pair) : news;

      // MTX-002/MTX-010: Batch DB write (skip duplicates)
      try {
        const uuids = rawNews.slice(0, 10).map(a => a.uuid as string).filter(Boolean);
        if (uuids.length > 0) {
          const existing = await db.newsItem.findMany({ where: { id: { in: uuids } }, select: { id: true } });
          const existingIds = new Set(existing.map(e => e.id));
          const toCreate = rawNews.slice(0, 10).filter(a => a.uuid && !existingIds.has(a.uuid as string));

          if (toCreate.length > 0) {
            await db.newsItem.createMany({
              data: toCreate.map(article => {
                const title = (article.title as string) || '';
                const description = (article.description as string) || '';
                const pair = matchPairToNews(title, description);
                return {
                  id: article.uuid as string,
                  source: (article.source as string) || 'Unknown',
                  title,
                  description: description.slice(0, 1000),
                  url: ((article.url as string) || '').slice(0, 2048),
                  imageUrl: (article.image_url as string) || '',
                  publishedAt: article.published_at ? new Date(article.published_at as string) : null,
                  category: 'forex',
                  pair: pair || null,
                  impact: determineImpact(title, description),
                  sentiment: determineSentiment(`${title} ${description}`),
                };
              }),
              skipDuplicates: true,
            });
          }
        }
      } catch {
        // DB cache write failure is non-critical
      }

      return NextResponse.json({ total: data.total_hits || filteredNews.length, page, limit, news: filteredNews });
    } catch {
      let news = [...SIMULATED_NEWS];
      if (pairFilter) news = news.filter(n => n.pair === pairFilter || !n.pair);
      return NextResponse.json({ total: news.length, page: 1, limit: 20, news, simulated: true, fallback: true });
    }
  } catch (error) {
    logApiError('News', error);
    return NextResponse.json({ total: SIMULATED_NEWS.length, page: 1, limit: 20, news: SIMULATED_NEWS, simulated: true, error: 'fallback' });
  }
}
