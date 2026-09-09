import "server-only";
import type { ApiKeys, Pair } from "./types";
import { getConfig } from "./server-config";
import { log } from "./server-config";

export interface NewsItem {
  headline: string;
  source: string;
  summary: string;
  url?: string;
  publishedAt: string;
}

/**
 * Fetch forex/market news from Finnhub and Marketaux.
 * Returns top headlines relevant to the given pair.
 * Falls back gracefully (empty array) if APIs are unavailable or unconfigured.
 */
export async function fetchMarketNews(pair: Pair): Promise<NewsItem[]> {
  const keys = await getConfig<ApiKeys>("apiKeys", {
    groq: "", openai: "", together: "", tinyfish: "",
    finnhub: "", marketaux: "", activeProvider: "zai",
  });

  const [finnhubNews, marketauxNews] = await Promise.allSettled([
    keys.finnhub ? fetchFinnhubNews(keys.finnhub, pair) : Promise.resolve([]),
    keys.marketaux ? fetchMarketauxNews(keys.marketaux, pair) : Promise.resolve([]),
  ]);

  const items: NewsItem[] = [];
  if (finnhubNews.status === "fulfilled") items.push(...finnhubNews.value);
  if (marketauxNews.status === "fulfilled") items.push(...marketauxNews.value);

  if (items.length === 0 && (keys.finnhub || keys.marketaux)) {
    await log("WARN", "NEWS", `No news fetched for ${pair} (APIs configured but returned empty/error)`);
  }

  // Deduplicate by headline, take top 5
  const seen = new Set<string>();
  const unique = items.filter((n) => {
    const key = n.headline.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);

  return unique;
}

async function fetchFinnhubNews(apiKey: string, pair: Pair): Promise<NewsItem[]> {
  // Finnhub forex/general news endpoint
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/news?category=forex&from=${from}&to=${to}&token=${apiKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];

  const data = await res.json() as Array<{
    headline: string;
    source: string;
    summary: string;
    url: string;
    datetime: number;
  }>;

  const query = pairToQuery(pair);
  return data
    .filter((n) => matchesPair(n.headline + " " + n.summary, query))
    .slice(0, 3)
    .map((n) => ({
      headline: n.headline,
      source: n.source,
      summary: n.summary.slice(0, 200),
      url: n.url,
      publishedAt: new Date(n.datetime * 1000).toISOString(),
    }));
}

async function fetchMarketauxNews(apiKey: string, pair: Pair): Promise<NewsItem[]> {
  // Marketaux news API with entity/symbol filtering
  const symbols = pairToMarketauxSymbols(pair);
  const url = `https://api.marketaux.com/v1/news/all?symbols=${symbols}&filter_entities=true&language=en&limit=5&api_token=${apiKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];

  const data = await res.json() as {
    data?: Array<{
      title: string;
      source?: string;
      description?: string;
      url?: string;
      published_at?: string;
    }>;
  };

  return (data.data ?? []).slice(0, 3).map((n) => ({
    headline: n.title,
    source: n.source ?? "Marketaux",
    summary: (n.description ?? "").slice(0, 200),
    url: n.url,
    publishedAt: n.published_at ?? new Date().toISOString(),
  }));
}

function pairToQuery(pair: Pair): string[] {
  switch (pair) {
    case "EURUSD": return ["EUR", "USD", "Euro", "Dollar", "ECB", "Fed", "Eurozone"];
    case "USDJPY": return ["JPY", "Yen", "BoJ", "Treasury", "Japan"];
    case "GBPUSD": return ["GBP", "Pound", "BoE", "UK", "Britain"];
    case "XAUUSD": return ["Gold", "XAU", "precious metal", "safe haven"];
  }
}

function pairToMarketauxSymbols(pair: Pair): string {
  switch (pair) {
    case "EURUSD": return "EURUSD";
    case "USDJPY": return "USDJPY";
    case "GBPUSD": return "GBPUSD";
    case "XAUUSD": return "XAUUSD";
  }
}

function matchesPair(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/**
 * Format news items for inclusion in the LLM prompt.
 */
export function formatNewsForPrompt(news: NewsItem[]): string {
  if (news.length === 0) {
    return "Tidak ada berita real-time tersedia (Finnhub/Marketaux tidak dikonfigurasi atau kosong).";
  }
  return news.map((n, i) =>
    `${i + 1}. [${n.source}] ${n.headline}\n   ${n.summary}`,
  ).join("\n\n");
}
