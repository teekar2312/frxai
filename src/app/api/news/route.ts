import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ForexPair, NewsArticle } from '@/lib/trading-types';

const MARKETAUX_BASE = 'https://api.marketaux.com/v1/news/all';

const PAIR_FILTER_MAP: Record<ForexPair, string[]> = {
  EURUSD: ['EUR', 'USD', 'Euro', 'Dollar', 'ECB', 'Fed'],
  USDJPY: ['USD', 'JPY', 'Yen', 'Dollar', 'BOJ', 'Fed'],
  GBPUSD: ['GBP', 'USD', 'Pound', 'Sterling', 'Dollar', 'BOE', 'Bank of England'],
  XAUUSD: ['Gold', 'XAU', 'Dollar', 'USD', 'precious metal'],
};

function determineImpact(title: string, description: string): 'high' | 'medium' | 'low' {
  const text = `${title} ${description}`.toLowerCase();
  const highImpactWords = ['nfp', 'rate decision', 'central bank', 'gdp', 'inflation', 'recession', 'war', 'crisis', 'emergency', 'fomc', 'policy'];
  const mediumImpactWords = ['pmi', 'retail sales', 'unemployment', 'cpi', 'ppi', 'employment', 'trade balance', 'manufacturing', 'consumer confidence'];
  
  if (highImpactWords.some(w => text.includes(w))) return 'high';
  if (mediumImpactWords.some(w => text.includes(w))) return 'medium';
  return 'low';
}

function determineSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();
  const positive = ['surge', 'rally', 'gain', 'boost', 'strong', 'growth', 'recovery', 'optimism', 'beat', 'exceed', 'upward', 'hawkish', 'tightening'];
  const negative = ['drop', 'fall', 'crash', 'decline', 'weak', 'recession', 'fear', 'miss', 'below', 'downward', 'tension', 'conflict', 'dovish', 'cut rate', 'stimulus'];
  
  const posCount = positive.filter(w => lower.includes(w)).length;
  const negCount = negative.filter(w => lower.includes(w)).length;
  
  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

function matchPairToNews(title: string, description: string): ForexPair | undefined {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes('gold') || text.includes('xau') || text.includes('precious metal')) return 'XAUUSD';
  if (text.includes('eur') || text.includes('euro') || text.includes('ecb')) return 'EURUSD';
  if (text.includes('jpy') || text.includes('yen') || text.includes('boj') || text.includes('japan')) return 'USDJPY';
  if (text.includes('gbp') || text.includes('pound') || text.includes('sterling') || text.includes('bank of england') || text.includes('boe')) return 'GBPUSD';
  if (text.includes('forex') || text.includes('dollar') || text.includes('fed') || text.includes('fomc')) return 'EURUSD';
  return undefined;
}

const SIMULATED_NEWS: NewsArticle[] = [
  {
    id: 'sim-1',
    title: 'Federal Reserve Signals Potential Rate Pause Amid Cooling Inflation Data',
    description: 'The Federal Reserve indicated it may hold interest rates steady at the next meeting as recent CPI data shows inflation continuing to cool toward the 2% target. Markets responded positively to the dovish tone.',
    url: '#', source: 'Reuters', publishedAt: new Date(Date.now() - 3600000).toISOString(),
    category: 'central bank', impact: 'high', sentiment: 'positive', pair: 'EURUSD',
  },
  {
    id: 'sim-2',
    title: 'US Non-Farm Payrolls Beat Expectations: 256K Jobs Added in November',
    description: 'The US labor market remains robust with NFP figures exceeding consensus estimates of 200K. Unemployment rate held steady at 4.1%. Wage growth accelerated to 4.0% YoY.',
    url: '#', source: 'Bloomberg', publishedAt: new Date(Date.now() - 7200000).toISOString(),
    category: 'economic data', impact: 'high', sentiment: 'negative', pair: 'EURUSD',
  },
  {
    id: 'sim-3',
    title: 'ECB Maintains Rates, Lagarde Hints at Possible Cut in Early 2025',
    description: 'The European Central Bank kept its key rate unchanged at 3.5%. President Lagarde suggested the door remains open for rate cuts if inflation continues to decline on a sustainable path.',
    url: '#', source: 'Financial Times', publishedAt: new Date(Date.now() - 10800000).toISOString(),
    category: 'central bank', impact: 'high', sentiment: 'neutral', pair: 'EURUSD',
  },
  {
    id: 'sim-4',
    title: 'Gold Rallies to New Highs Amid Geopolitical Tensions and Dollar Weakness',
    description: 'XAU/USD surged past $2,650 as escalating Middle East tensions and a softer dollar drove safe-haven demand. Analysts see further upside if geopolitical risks persist.',
    url: '#', source: 'Kitco News', publishedAt: new Date(Date.now() - 14400000).toISOString(),
    category: 'commodities', impact: 'high', sentiment: 'positive', pair: 'XAUUSD',
  },
  {
    id: 'sim-5',
    title: 'Bank of Japan Governor Ueda Warns of Possible Rate Hike if Inflation Persists',
    description: 'BOJ Governor Kazuo Ueda stated that the central bank may raise interest rates further if wage-driven inflation continues to accelerate, sending USD/JPY lower.',
    url: '#', source: 'Nikkei Asia', publishedAt: new Date(Date.now() - 18000000).toISOString(),
    category: 'central bank', impact: 'high', sentiment: 'negative', pair: 'USDJPY',
  },
  {
    id: 'sim-6',
    title: 'UK GDP Growth Slows to 0.3% in Q3, Below BOE Expectations',
    description: 'The UK economy grew at a slower pace than anticipated in Q3, raising concerns about the Bank of England\'s ability to maintain restrictive monetary policy. GBP/USD declined on the data.',
    url: '#', source: 'ONS', publishedAt: new Date(Date.now() - 21600000).toISOString(),
    category: 'economic data', impact: 'medium', sentiment: 'negative', pair: 'GBPUSD',
  },
  {
    id: 'sim-7',
    title: 'US ISM Manufacturing PMI Contracts for Sixth Consecutive Month',
    description: 'The ISM Manufacturing PMI fell to 48.2 in November, remaining below the 50 expansion threshold. New orders and production components both declined.',
    url: '#', source: 'ISM', publishedAt: new Date(Date.now() - 25200000).toISOString(),
    category: 'economic data', impact: 'medium', sentiment: 'negative', pair: 'EURUSD',
  },
  {
    id: 'sim-8',
    title: 'US Retail Sales Surge 0.7% in October, Exceeding Expectations',
    description: 'Consumer spending remained strong with retail sales growing 0.7% MoM, well above the 0.3% consensus. The data suggests the US consumer continues to support economic growth.',
    url: '#', source: 'Census Bureau', publishedAt: new Date(Date.now() - 28800000).toISOString(),
    category: 'economic data', impact: 'medium', sentiment: 'positive', pair: 'EURUSD',
  },
  {
    id: 'sim-9',
    title: 'Breaking: Major Earthquake Hits Japan, BOJ Monitors Market Impact',
    description: 'A 7.1 magnitude earthquake struck off the coast of Japan, prompting tsunami warnings. The BOJ is closely monitoring financial market stability. Safe-haven flows likely to support JPY.',
    url: '#', source: 'NHK', publishedAt: new Date(Date.now() - 32400000).toISOString(),
    category: 'breaking news', impact: 'high', sentiment: 'negative', pair: 'USDJPY',
  },
  {
    id: 'sim-10',
    title: 'China Economic Stimulus Package Boosts Global Risk Sentiment',
    description: 'China announced a comprehensive fiscal stimulus package worth ¥10 trillion, focusing on infrastructure and consumption. Global markets rallied on the news, supporting risk-sensitive currencies.',
    url: '#', source: 'South China Morning Post', publishedAt: new Date(Date.now() - 36000000).toISOString(),
    category: 'fiscal policy', impact: 'medium', sentiment: 'positive', pair: 'GBPUSD',
  },
];

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.MARKETAUX_API_KEY;
    const { searchParams } = new URL(request.url);
    const pairFilter = searchParams.get('pair') as ForexPair | null;

    // Return simulated news if no API key
    if (!apiKey) {
      let news = [...SIMULATED_NEWS];
      if (pairFilter) {
        news = news.filter(n => n.pair === pairFilter || !n.pair);
      }
      return NextResponse.json({ total: news.length, page: 1, limit: 20, news, simulated: true });
    }

    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);

    let filterEntities = 'EUR,USD,GBP,JPY,Gold,forex,central bank,NFP,inflation,GDP,PMI';
    let countries = 'id,us,gb,eu,jp';

    if (pairFilter && PAIR_FILTER_MAP[pairFilter]) {
      filterEntities = PAIR_FILTER_MAP[pairFilter].join(',');
    }

    const url = new URL(MARKETAUX_BASE);
    url.searchParams.set('countries', countries);
    url.searchParams.set('filter_entities', filterEntities);
    url.searchParams.set('api_token', apiKey);
    url.searchParams.set('limit', limit.toString());
    url.searchParams.set('page', page.toString());

    try {
      const res = await fetch(url.toString(), { next: { revalidate: 300 } });
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
        const entities = ((article.entities as Record<string, unknown>[]) || []).map(e => (e.name as string) || '');
        const pair = matchPairToNews(title, description);

        return {
          id: (article.uuid as string) || `news-${Date.now()}-${index}`,
          title,
          description: description.slice(0, 500),
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

      try {
        for (const article of rawNews.slice(0, 10)) {
          const uuid = article.uuid as string;
          const exists = await db.newsItem.findUnique({ where: { id: uuid } });
          if (!exists) {
            const title = (article.title as string) || '';
            const description = (article.description as string) || '';
            const pair = matchPairToNews(title, description);
            await db.newsItem.create({
              data: {
                id: uuid, source: (article.source as string) || 'Unknown',
                title, description: description.slice(0, 1000),
                url: (article.url as string) || '', imageUrl: (article.image_url as string) || '',
                publishedAt: article.published_at ? new Date(article.published_at as string) : null,
                category: 'forex', pair: pair || null,
                impact: determineImpact(title, description),
                sentiment: determineSentiment(`${title} ${description}`),
              },
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
    console.error('[News API] Error:', error);
    let news = [...SIMULATED_NEWS];
    return NextResponse.json({ total: news.length, page: 1, limit: 20, news, simulated: true, error: 'fallback' });
  }
}
