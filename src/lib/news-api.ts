/**
 * FINEX Trading System - News API Module (Phase 6)
 * ====================================================
 * Comprehensive news fetching from Finnhub and MARKETAUX with
 * in-memory LRU caching, per-provider rate limiting, circuit breaker
 * pattern, title-hash deduplication, and breaking news detection.
 *
 * Providers:
 *   - Finnhub: company-news endpoint (per-symbol)
 *   - MARKETAUX: news/all endpoint (Indonesia-filtered)
 *
 * Features:
 *   1. LRU in-memory cache (max 100 entries, configurable TTL)
 *   2. Per-provider rate limiting backed by DB (NewsSourceConfig)
 *   3. Circuit breaker per provider (CLOSED → OPEN → HALF_OPEN)
 *   4. Title-hash deduplication across providers
 *   5. Breaking news keyword detection (last 15 min)
 *   6. Aggregate news statistics
 *   7. Automatic provider failover (primary → secondary)
 *   8. Seed/initialization of default provider configs
 */

import { db } from './db'
import logger from './trading-logger'

// ============================================================================
// SECTION 1: Types & Interfaces
// ============================================================================

/** Supported news providers */
export type NewsProvider = 'FINNHUB' | 'MARKETAUX'

/** Circuit breaker states */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

/** Raw Finnhub API article shape */
export interface FinnhubArticle {
  category: string
  datetime: number
  headline: string
  id: number
  image: string
  related: string
  source: string
  summary: string
  url: string
}

/** Raw MARKETAUX API response envelope */
export interface MarketauxResponse {
  data: MarketauxArticle[]
  error_code: number | null
  error_message: string | null
  status: string
  total_results: number | null
}

/** Raw MARKETAUX API article shape */
export interface MarketauxArticle {
  description: string
  entities: MarketauxEntity[]
  id: string
  image_url: string
  published_at: string
  relevance_score: number | null
  source: string
  title: string
  url: string
  uuid: string
}

/** MARKETAUX entity object inside an article */
export interface MarketauxEntity {
  highlight: string | null
  mentions: number
  name: string
  score: number
  sentiment: string
  stock_exchange: string | null
  subentity: boolean
  symbol: string
  type: string
}

/** Unified article shape after normalizing from either provider */
export interface NormalizedArticle {
  title: string
  content: string
  source: string
  url: string
  imageUrl: string | null
  symbols: string[]
  publishedAt: Date | null
  category: string | null
  provider: NewsProvider
}

/** Options for fetching news */
export interface NewsFetchOptions {
  symbols?: string[]
  categories?: string[]
  maxArticles?: number
  provider?: NewsProvider
  forceRefresh?: boolean
}

/** Result returned from news fetch operations */
export interface NewsFetchResult {
  articles: NormalizedArticle[]
  totalFetched: number
  newArticles: number
  deduped: number
  provider: string
  responseTimeMs: number
  cached: boolean
}

/** In-memory cache entry */
export interface NewsCacheEntry {
  articles: NormalizedArticle[]
  fetchedAt: Date
  expiresAt: Date
}

/** Rate limit check result */
export interface RateLimitCheck {
  allowed: boolean
  waitMs: number
  reason?: string
}

/** Deduplication result */
export interface DeduplicationResult {
  unique: NormalizedArticle[]
  duplicates: number
}

/** Cache statistics */
export interface CacheStats {
  size: number
  maxSize: number
  hitCount: number
  missCount: number
  hitRate: number
  keys: string[]
}

/** News statistics aggregate */
export interface NewsStats {
  totalArticles: number
  last24h: number
  bySource: Record<string, number>
  bySentiment: Record<string, number>
  byCategory: Record<string, number>
  avgFetchTimeMs: number
  cacheHitRate: number
  lastFetchAt: Date | null
}

/** Breaking news item with match details */
export interface BreakingNewsItem {
  article: NormalizedArticle
  matchedKeywords: string[]
}

// ============================================================================
// SECTION 2: Constants
// ============================================================================

const DEFAULT_SYMBOLS = ['BBCA', 'BBRI', 'BMRI', 'TLKM', 'ASII']
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CACHE_ENTRIES = 100
const CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 1000 // 60 seconds
const BREAKING_NEWS_WINDOW_MIN = 15
const BREAKING_KEYWORDS = [
  'crash', 'surge', 'rate decision', 'emergency', 'ban',
  'collapse', 'plunge', 'soar', 'rally', 'halt',
  'suspension', 'downgrade', 'default', 'bankruptcy',
  'scandal', 'fraud', 'investigation', 'sanction',
  'war', 'terror', 'pandemic', 'lockdown', 'crisis',
  'bank run', 'margin call', 'circuit breaker', 'trading halt',
  'rate hike', 'rate cut', 'bijak', 'darurat', 'skandal',
]

// ============================================================================
// SECTION 3: In-Memory LRU Cache
// ============================================================================

/**
 * Module-level in-memory cache with LRU eviction.
 * Keys are provider-specific cache keys built from symbols + categories.
 */
const newsCache = new Map<string, NewsCacheEntry>()
let cacheAccessOrder: string[] = [] // tracks LRU order
let cacheHitCount = 0
let cacheMissCount = 0

/**
 * Get a cached entry by key. Returns null on miss or expiry.
 * Updates LRU access order on hit.
 */
export function getCache(key: string): NewsCacheEntry | null {
  const entry = newsCache.get(key)
  if (!entry) {
    cacheMissCount++
    return null
  }
  // Check expiry
  if (new Date() > entry.expiresAt) {
    newsCache.delete(key)
    cacheAccessOrder = cacheAccessOrder.filter(k => k !== key)
    cacheMissCount++
    return null
  }
  // Move to most-recently-used (end of array)
  cacheAccessOrder = cacheAccessOrder.filter(k => k !== key)
  cacheAccessOrder.push(key)
  cacheHitCount++
  return entry
}

/**
 * Store articles in cache with a TTL. Evicts LRU entry if at capacity.
 */
export function setCache(key: string, articles: NormalizedArticle[], ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
  const now = new Date()
  const entry: NewsCacheEntry = {
    articles,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  }

  // If key already exists, remove old position in LRU order
  if (newsCache.has(key)) {
    cacheAccessOrder = cacheAccessOrder.filter(k => k !== key)
  } else if (newsCache.size >= MAX_CACHE_ENTRIES) {
    // Evict least recently used (first in array)
    const lruKey = cacheAccessOrder.shift()
    if (lruKey) {
      newsCache.delete(lruKey)
    }
  }

  newsCache.set(key, entry)
  cacheAccessOrder.push(key)
}

/** Clear the entire news cache */
export function clearCache(): void {
  newsCache.clear()
  cacheAccessOrder = []
  cacheHitCount = 0
  cacheMissCount = 0
  logger.info('SYSTEM', 'News cache cleared')
}

/** Get cache performance statistics */
export function getCacheStats(): CacheStats {
  const total = cacheHitCount + cacheMissCount
  return {
    size: newsCache.size,
    maxSize: MAX_CACHE_ENTRIES,
    hitCount: cacheHitCount,
    missCount: cacheMissCount,
    hitRate: total > 0 ? cacheHitCount / total : 0,
    keys: Array.from(newsCache.keys()),
  }
}

/**
 * Build a deterministic cache key from fetch options.
 */
function buildCacheKey(options: NewsFetchOptions, provider: NewsProvider): string {
  const symbols = (options.symbols ?? DEFAULT_SYMBOLS).sort().join(',')
  const categories = (options.categories ?? []).sort().join(',')
  return `news:${provider}:${symbols}:${categories}`
}

// ============================================================================
// SECTION 4: Rate Limiter
// ============================================================================

/**
 * Check if an API call is allowed under the provider's rate limit.
 * Resets per-minute counter if >60s since last call.
 * Resets per-day counter if >24h since last call.
 *
 * @returns {RateLimitCheck} - allowed, waitMs until next slot, and optional reason
 */
export async function checkRateLimit(provider: NewsProvider): Promise<RateLimitCheck> {
  try {
    const config = await db.newsSourceConfig.findUnique({
      where: { provider },
    })

    if (!config || !config.enabled) {
      return { allowed: false, waitMs: 0, reason: `Provider ${provider} not configured or disabled` }
    }

    const now = new Date()
    const lastCall = config.lastCallAt ? new Date(config.lastCallAt) : null

    // Reset minute counter if >60s since last call
    if (lastCall && (now.getTime() - lastCall.getTime()) > 60_000) {
      await db.newsSourceConfig.update({
        where: { provider },
        data: { callsThisMinute: 0 },
      })
    }

    // Reset day counter if >24h since last call
    if (lastCall && (now.getTime() - lastCall.getTime()) > 86_400_000) {
      await db.newsSourceConfig.update({
        where: { provider },
        data: { callsThisDay: 0 },
      })
    }

    // Re-fetch after potential resets
    const freshConfig = await db.newsSourceConfig.findUnique({
      where: { provider },
    })
    if (!freshConfig) {
      return { allowed: false, waitMs: 0, reason: `Provider ${provider} config disappeared` }
    }

    // Check minute limit
    if (freshConfig.callsThisMinute >= freshConfig.rateLimitPerMin) {
      const waitMs = 60_000 - (now.getTime() - (freshConfig.lastCallAt ? new Date(freshConfig.lastCallAt).getTime() : 0))
      const clampedWait = Math.max(waitMs, 0)
      logger.info('API_RATE_LIMIT', `${provider} minute rate limit reached (${freshConfig.callsThisMinute}/${freshConfig.rateLimitPerMin})`, {
        source: provider,
        details: `Wait ${clampedWait}ms`,
      })
      return { allowed: false, waitMs: clampedWait, reason: `Minute rate limit reached (${freshConfig.callsThisMinute}/${freshConfig.rateLimitPerMin})` }
    }

    // Check day limit
    if (freshConfig.callsThisDay >= freshConfig.rateLimitPerDay) {
      const waitMs = 86_400_000 - (now.getTime() - (freshConfig.lastCallAt ? new Date(freshConfig.lastCallAt).getTime() : 0))
      const clampedWait = Math.max(waitMs, 0)
      logger.info('API_RATE_LIMIT', `${provider} daily rate limit reached (${freshConfig.callsThisDay}/${freshConfig.rateLimitPerDay})`, {
        source: provider,
        details: `Wait ${clampedWait}ms`,
      })
      return { allowed: false, waitMs: clampedWait, reason: `Daily rate limit reached (${freshConfig.callsThisDay}/${freshConfig.rateLimitPerDay})` }
    }

    // Increment counters
    await db.newsSourceConfig.update({
      where: { provider },
      data: {
        callsThisMinute: { increment: 1 },
        callsThisDay: { increment: 1 },
        lastCallAt: now,
      },
    })

    return { allowed: true, waitMs: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', `Rate limit check failed for ${provider}`, {
      source: provider,
      stackTrace: message,
    })
    // Fail open - allow the call if we can't check
    return { allowed: true, waitMs: 0, reason: 'Rate limit check failed, allowing call' }
  }
}

// ============================================================================
// SECTION 5: Circuit Breaker
// ============================================================================

/**
 * Check the circuit breaker state for a provider.
 *
 * - CLOSED: normal operation, calls allowed
 * - OPEN: if cooldown has passed, transition to HALF_OPEN (probe call).
 *          Otherwise block the call.
 * - HALF_OPEN: allow one probe call to test recovery
 *
 * @returns {allowed} Whether the call should proceed
 */
export async function checkCircuitBreaker(provider: NewsProvider): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const config = await db.newsSourceConfig.findUnique({
      where: { provider },
    })

    if (!config) {
      return { allowed: false, reason: `Provider ${provider} not configured` }
    }

    const state = config.circuitState as CircuitState
    const now = new Date()

    if (state === 'CLOSED') {
      return { allowed: true }
    }

    if (state === 'OPEN') {
      const openUntil = config.circuitOpenUntil ? new Date(config.circuitOpenUntil) : null
      if (openUntil && now > openUntil) {
        // Cooldown passed, transition to HALF_OPEN for a probe call
        await db.newsSourceConfig.update({
          where: { provider },
          data: { circuitState: 'HALF_OPEN' },
        })
        logger.info('SYSTEM', `Circuit breaker ${provider}: OPEN → HALF_OPEN (cooldown elapsed)`, {
          source: provider,
        })
        return { allowed: true }
      }
      // Still in cooldown
      const waitMs = openUntil ? openUntil.getTime() - now.getTime() : 0
      return {
        allowed: false,
        reason: `Circuit breaker OPEN for ${provider}, ${Math.ceil(waitMs / 1000)}s remaining`,
      }
    }

    if (state === 'HALF_OPEN') {
      // Allow one probe call
      return { allowed: true }
    }

    return { allowed: false, reason: `Unknown circuit state: ${state}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', `Circuit breaker check failed for ${provider}`, {
      source: provider,
      stackTrace: message,
    })
    return { allowed: true, reason: 'Circuit breaker check failed, allowing call' }
  }
}

/**
 * Update the circuit breaker state after an API call result.
 *
 * Transition rules:
 * - HALF_OPEN + success → CLOSED (reset consecutive errors)
 * - HALF_OPEN + failure → OPEN (back to open with 60s cooldown)
 * - CLOSED + failure → increment consecutiveErrors, if >= 3 → OPEN (60s cooldown)
 * - CLOSED + success → reset consecutiveErrors to 0
 */
export async function updateCircuitBreaker(provider: NewsProvider, success: boolean): Promise<void> {
  try {
    const config = await db.newsSourceConfig.findUnique({
      where: { provider },
    })

    if (!config) return

    const currentState = config.circuitState as CircuitState

    if (currentState === 'HALF_OPEN') {
      if (success) {
        await db.newsSourceConfig.update({
          where: { provider },
          data: {
            circuitState: 'CLOSED',
            consecutiveErrors: 0,
            circuitOpenUntil: null,
            lastError: null,
          },
        })
        logger.info('SYSTEM', `Circuit breaker ${provider}: HALF_OPEN → CLOSED (probe succeeded)`, {
          source: provider,
        })
      } else {
        const openUntil = new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS)
        await db.newsSourceConfig.update({
          where: { provider },
          data: {
            circuitState: 'OPEN',
            circuitOpenUntil: openUntil,
          },
        })
        logger.warn('SYSTEM', `Circuit breaker ${provider}: HALF_OPEN → OPEN (probe failed, cooldown 60s)`, {
          source: provider,
        })
      }
    } else if (currentState === 'CLOSED') {
      if (success) {
        if (config.consecutiveErrors > 0) {
          await db.newsSourceConfig.update({
            where: { provider },
            data: { consecutiveErrors: 0, lastError: null },
          })
        }
      } else {
        const newErrors = config.consecutiveErrors + 1
        if (newErrors >= 3) {
          const openUntil = new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS)
          await db.newsSourceConfig.update({
            where: { provider },
            data: {
              circuitState: 'OPEN',
              consecutiveErrors: newErrors,
              circuitOpenUntil: openUntil,
            },
          })
          logger.warn('SYSTEM', `Circuit breaker ${provider}: CLOSED → OPEN (${newErrors} consecutive errors, cooldown 60s)`, {
            source: provider,
          })
        } else {
          await db.newsSourceConfig.update({
            where: { provider },
            data: { consecutiveErrors: newErrors },
          })
          logger.info('SYSTEM', `Circuit breaker ${provider}: ${newErrors}/3 consecutive errors`, {
            source: provider,
          })
        }
      }
    }
    // OPEN state: no updates needed, transitions happen only in checkCircuitBreaker
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', `Circuit breaker update failed for ${provider}`, {
      source: provider,
      stackTrace: message,
    })
  }
}

// ============================================================================
// SECTION 6: Utility Functions
// ============================================================================

/**
 * Compute a simple deterministic hash of a string for deduplication.
 * Uses a basic djb2-like algorithm.
 */
export function computeSimpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff
  }
  return (hash >>> 0).toString(36)
}

/**
 * Deduplicate articles by title hash.
 * Articles with identical normalized titles (lowercased, trimmed) are considered duplicates.
 * First occurrence is kept.
 *
 * @returns Object with unique articles and count of duplicates removed
 */
export function deduplicateArticles(articles: NormalizedArticle[]): DeduplicationResult {
  const seen = new Map<string, NormalizedArticle>()
  let duplicates = 0

  for (const article of articles) {
    const hash = computeSimpleHash(article.title.toLowerCase().trim())
    if (seen.has(hash)) {
      duplicates++
    } else {
      seen.set(hash, article)
    }
  }

  return {
    unique: Array.from(seen.values()),
    duplicates,
  }
}

/**
 * Record an API call result in NewsFetchLog and update NewsSourceConfig error state.
 */
export async function recordApiCall(
  provider: NewsProvider,
  endpoint: string,
  statusCode: number | null,
  responseTimeMs: number,
  articlesFetched: number,
  articlesNew: number,
  articlesDedup: number,
  error?: string,
): Promise<void> {
  try {
    await db.newsFetchLog.create({
      data: {
        provider,
        endpoint,
        statusCode,
        responseTimeMs,
        articlesFetched,
        articlesNew,
        articlesDedup,
        error: error ?? null,
      },
    })

    // Update error state on the config
    if (error) {
      await db.newsSourceConfig.update({
        where: { provider },
        data: { lastError: error.slice(0, 500) },
      })
    }
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError)
    logger.error('SYSTEM', `Failed to record API call log for ${provider}`, {
      source: provider,
      stackTrace: message,
    })
  }
}

/**
 * Save a batch of new articles to the NewsArticle table.
 * Uses title-based upsert: if an article with the same title already exists,
 * it is skipped (no update).
 */
async function saveArticles(articles: NormalizedArticle[]): Promise<number> {
  if (articles.length === 0) return 0

  let savedCount = 0

  for (const article of articles) {
    try {
      // Check if article already exists by title
      const existing = await db.newsArticle.findFirst({
        where: { title: article.title },
      })

      if (!existing) {
        await db.newsArticle.create({
          data: {
            title: article.title,
            content: article.content || null,
            source: article.source || null,
            url: article.url || null,
            imageUrl: article.imageUrl || null,
            sentiment: 'NEUTRAL',
            sentimentScore: 0,
            symbols: JSON.stringify(article.symbols),
            publishedAt: article.publishedAt,
            fetchedAt: new Date(),
            category: article.category || null,
          },
        })
        savedCount++
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      logger.error('SYSTEM', `Failed to save article: ${article.title.slice(0, 60)}`, {
        details: message,
      })
    }
  }

  return savedCount
}

/**
 * Determine the best available provider from DB configs.
 * Returns providers sorted by priority (highest first) that are enabled.
 */
async function getAvailableProviders(): Promise<NewsProvider[]> {
  try {
    const configs = await db.newsSourceConfig.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
    })
    return configs.map(c => c.provider as NewsProvider)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', 'Failed to fetch available providers', {
      stackTrace: message,
    })
    return []
  }
}

/**
 * Get the API key for a provider from the DB config.
 */
async function getProviderApiKey(provider: NewsProvider): Promise<string | null> {
  try {
    const config = await db.newsSourceConfig.findUnique({
      where: { provider },
      select: { apiKey: true },
    })
    return config?.apiKey ?? null
  } catch {
    return null
  }
}

// ============================================================================
// SECTION 7: Article Normalization
// ============================================================================

/**
 * Normalize a raw Finnhub article into the unified NormalizedArticle shape.
 *
 * Finnhub fields mapping:
 *   headline → title
 *   summary → content
 *   source → source
 *   url → url
 *   image → imageUrl
 *   datetime (epoch seconds) → publishedAt
 *   category → category
 */
export function normalizeFinnhubArticle(raw: FinnhubArticle, symbol: string): NormalizedArticle {
  return {
    title: raw.headline || 'Untitled',
    content: raw.summary || '',
    source: raw.source || 'Finnhub',
    url: raw.url || '',
    imageUrl: raw.image || null,
    symbols: [symbol],
    publishedAt: raw.datetime ? new Date(raw.datetime * 1000) : null,
    category: raw.category || null,
    provider: 'FINNHUB',
  }
}

/**
 * Normalize a raw MARKETAUX article into the unified NormalizedArticle shape.
 *
 * MARKETAUX fields mapping:
 *   title → title
 *   description → content
 *   source → source
 *   url → url
 *   image_url → imageUrl
 *   published_at (ISO string) → publishedAt
 *   entities → symbols (extract entity symbols)
 */
export function normalizeMarketauxArticle(raw: MarketauxArticle): NormalizedArticle {
  const symbols = (raw.entities ?? [])
    .filter((e: MarketauxEntity) => e.type === 'equity' && e.symbol)
    .map((e: MarketauxEntity) => e.symbol)

  return {
    title: raw.title || 'Untitled',
    content: raw.description || '',
    source: raw.source || 'Marketaux',
    url: raw.url || '',
    imageUrl: raw.image_url || null,
    symbols,
    publishedAt: raw.published_at ? new Date(raw.published_at) : null,
    category: null,
    provider: 'MARKETAUX',
  }
}

// ============================================================================
// SECTION 8: Finnhub Integration
// ============================================================================

/**
 * Fetch market news from Finnhub for specified symbols.
 * Uses the company-news endpoint: /api/v1/company-news
 *
 * Process:
 *   1. Check rate limit
 *   2. Check circuit breaker
 *   3. For each symbol, fetch articles from the past 7 days
 *   4. Normalize and deduplicate
 *   5. Record API call metrics
 *
 * @param options - Fetch options including symbols and limits
 * @returns NewsFetchResult with articles and metrics
 */
export async function fetchFromFinnhub(options: NewsFetchOptions): Promise<NewsFetchResult> {
  const startTime = Date.now()
  const symbols = options.symbols ?? DEFAULT_SYMBOLS
  const maxArticles = options.maxArticles ?? 50

  // Check rate limit
  const rateCheck = await checkRateLimit('FINNHUB')
  if (!rateCheck.allowed) {
    logger.info('API_RATE_LIMIT', 'Finnhub rate limited, skipping fetch', {
      source: 'FINNHUB',
      details: rateCheck.reason,
    })
    return {
      articles: [],
      totalFetched: 0,
      newArticles: 0,
      deduped: 0,
      provider: 'FINNHUB',
      responseTimeMs: Date.now() - startTime,
      cached: false,
    }
  }

  // Check circuit breaker
  const circuitCheck = await checkCircuitBreaker('FINNHUB')
  if (!circuitCheck.allowed) {
    logger.warn('SYSTEM', 'Finnhub circuit breaker open, skipping fetch', {
      source: 'FINNHUB',
      details: circuitCheck.reason,
    })
    return {
      articles: [],
      totalFetched: 0,
      newArticles: 0,
      deduped: 0,
      provider: 'FINNHUB',
      responseTimeMs: Date.now() - startTime,
      cached: false,
    }
  }

  const apiKey = await getProviderApiKey('FINNHUB')
  if (!apiKey) {
    logger.error('SYSTEM', 'Finnhub API key not configured')
    await recordApiCall('FINNHUB', '/company-news', null, Date.now() - startTime, 0, 0, 0, 'API key not configured')
    await updateCircuitBreaker('FINNHUB', false)
    return {
      articles: [],
      totalFetched: 0,
      newArticles: 0,
      deduped: 0,
      provider: 'FINNHUB',
      responseTimeMs: Date.now() - startTime,
      cached: false,
    }
  }

  const toDate = new Date()
  const fromDate = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000)
  const allArticles: NormalizedArticle[] = []
  let totalRawFetched = 0
  let lastError: string | undefined
  let anySuccess = false

  for (const symbol of symbols) {
    try {
      const url = new URL('https://finnhub.io/api/v1/company-news')
      url.searchParams.set('symbol', symbol)
      url.searchParams.set('from', fromDate.toISOString().split('T')[0])
      url.searchParams.set('to', toDate.toISOString().split('T')[0])
      url.searchParams.set('token', apiKey)

      const response = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        const errorText = `HTTP ${response.status}: ${response.statusText}`
        logger.warn('API_RATE_LIMIT', `Finnhub API error for ${symbol}: ${errorText}`, {
          source: 'FINNHUB',
          symbol,
          details: errorText,
        })
        lastError = errorText
        continue
      }

      const data: unknown = await response.json()
      if (!Array.isArray(data)) {
        lastError = 'Response is not an array'
        continue
      }

      const rawArticles = data as FinnhubArticle[]
      totalRawFetched += rawArticles.length

      for (const raw of rawArticles) {
        allArticles.push(normalizeFinnhubArticle(raw, symbol))
      }

      anySuccess = true
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError)
      logger.error('SYSTEM', `Finnhub fetch failed for ${symbol}`, {
        source: 'FINNHUB',
        symbol,
        stackTrace: message,
      })
      lastError = message
    }
  }

  const responseTimeMs = Date.now() - startTime

  // Deduplicate
  const { unique, duplicates } = deduplicateArticles(allArticles)
  const limited = unique.slice(0, maxArticles)

  // Save new articles to DB
  let newArticles = 0
  if (limited.length > 0) {
    try {
      newArticles = await saveArticles(limited)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      logger.error('SYSTEM', 'Failed to save Finnhub articles to DB', { stackTrace: message })
    }
  }

  // Update circuit breaker
  await updateCircuitBreaker('FINNHUB', anySuccess)

  // Record API call
  await recordApiCall(
    'FINNHUB',
    '/company-news',
    anySuccess ? 200 : null,
    responseTimeMs,
    totalRawFetched,
    newArticles,
    duplicates,
    lastError,
  )

  logger.info('API_RATE_LIMIT', `Finnhub fetch complete: ${limited.length} articles (${newArticles} new, ${duplicates} deduped) in ${responseTimeMs}ms`, {
    source: 'FINNHUB',
    details: `Symbols: ${symbols.join(', ')}`,
    metadata: { totalRawFetched, newArticles, duplicates, responseTimeMs },
  })

  return {
    articles: limited,
    totalFetched: totalRawFetched,
    newArticles,
    deduped: duplicates,
    provider: 'FINNHUB',
    responseTimeMs,
    cached: false,
  }
}

// ============================================================================
// SECTION 9: MARKETAUX Integration
// ============================================================================

/**
 * Fetch market news from MARKETAUX with Indonesia filtering.
 * Uses the /v1/news/all endpoint.
 *
 * Supports two modes:
 *   1. General Indonesia news: countries=id, filter_entities=true
 *   2. Symbol-specific: add symbols param (e.g. ?symbols=BBCA,BBRI)
 *
 * Process:
 *   1. Check rate limit
 *   2. Check circuit breaker
 *   3. Fetch articles with Indonesia filter
 *   4. If symbols specified, also make symbol-specific calls
 *   5. Normalize and deduplicate
 *   6. Record API call metrics
 *
 * @param options - Fetch options including symbols and limits
 * @returns NewsFetchResult with articles and metrics
 */
export async function fetchFromMarketaux(options: NewsFetchOptions): Promise<NewsFetchResult> {
  const startTime = Date.now()
  const symbols = options.symbols ?? []
  const maxArticles = options.maxArticles ?? 50

  // Check rate limit
  const rateCheck = await checkRateLimit('MARKETAUX')
  if (!rateCheck.allowed) {
    logger.info('API_RATE_LIMIT', 'MARKETAUX rate limited, skipping fetch', {
      source: 'MARKETAUX',
      details: rateCheck.reason,
    })
    return {
      articles: [],
      totalFetched: 0,
      newArticles: 0,
      deduped: 0,
      provider: 'MARKETAUX',
      responseTimeMs: Date.now() - startTime,
      cached: false,
    }
  }

  // Check circuit breaker
  const circuitCheck = await checkCircuitBreaker('MARKETAUX')
  if (!circuitCheck.allowed) {
    logger.warn('SYSTEM', 'MARKETAUX circuit breaker open, skipping fetch', {
      source: 'MARKETAUX',
      details: circuitCheck.reason,
    })
    return {
      articles: [],
      totalFetched: 0,
      newArticles: 0,
      deduped: 0,
      provider: 'MARKETAUX',
      responseTimeMs: Date.now() - startTime,
      cached: false,
    }
  }

  const apiKey = await getProviderApiKey('MARKETAUX')
  if (!apiKey) {
    logger.error('SYSTEM', 'MARKETAUX API key not configured')
    await recordApiCall('MARKETAUX', '/news/all', null, Date.now() - startTime, 0, 0, 0, 'API key not configured')
    await updateCircuitBreaker('MARKETAUX', false)
    return {
      articles: [],
      totalFetched: 0,
      newArticles: 0,
      deduped: 0,
      provider: 'MARKETAUX',
      responseTimeMs: Date.now() - startTime,
      cached: false,
    }
  }

  const allArticles: NormalizedArticle[] = []
  let totalRawFetched = 0
  let lastError: string | undefined
  let anySuccess = false
  const endpointsCalled: string[] = []

  // Build list of URL configs to fetch
  type FetchConfig = { url: string; endpoint: string; label: string }
  const fetchConfigs: FetchConfig[] = []

  // 1. General Indonesia news fetch
  const generalUrl = new URL('https://api.marketaux.com/v1/news/all')
  generalUrl.searchParams.set('countries', 'id')
  generalUrl.searchParams.set('filter_entities', 'true')
  generalUrl.searchParams.set('api_token', apiKey)
  fetchConfigs.push({
    url: generalUrl.toString(),
    endpoint: '/news/all?countries=id',
    label: 'Indonesia general',
  })

  // 2. Symbol-specific fetches (if symbols provided)
  if (symbols.length > 0) {
    const symbolsUrl = new URL('https://api.marketaux.com/v1/news/all')
    symbolsUrl.searchParams.set('countries', 'id')
    symbolsUrl.searchParams.set('filter_entities', 'true')
    symbolsUrl.searchParams.set('symbols', symbols.join('.'))
    symbolsUrl.searchParams.set('api_token', apiKey)
    fetchConfigs.push({
      url: symbolsUrl.toString(),
      endpoint: `/news/all?symbols=${symbols.join('.')}`,
      label: `Symbol-specific: ${symbols.join(',')}`,
    })
  }

  for (const fetchConfig of fetchConfigs) {
    try {
      const response = await fetch(fetchConfig.url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        const errorText = `HTTP ${response.status}: ${response.statusText}`
        logger.warn('API_RATE_LIMIT', `MARKETAUX API error (${fetchConfig.label}): ${errorText}`, {
          source: 'MARKETAUX',
          details: errorText,
        })
        lastError = errorText
        continue
      }

      const data: unknown = await response.json()

      // Validate response shape
      if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray((data as Record<string, unknown>).data)) {
        lastError = 'Invalid MARKETAUX response shape'
        logger.warn('SYSTEM', `MARKETAUX invalid response shape (${fetchConfig.label})`)
        continue
      }

      const marketauxResponse = data as MarketauxResponse
      const rawArticles = marketauxResponse.data
      totalRawFetched += rawArticles.length
      endpointsCalled.push(fetchConfig.endpoint)

      for (const raw of rawArticles) {
        allArticles.push(normalizeMarketauxArticle(raw))
      }

      anySuccess = true
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError)
      logger.error('SYSTEM', `MARKETAUX fetch failed (${fetchConfig.label})`, {
        source: 'MARKETAUX',
        stackTrace: message,
      })
      lastError = message
    }
  }

  const responseTimeMs = Date.now() - startTime

  // Deduplicate
  const { unique, duplicates } = deduplicateArticles(allArticles)
  const limited = unique.slice(0, maxArticles)

  // Save new articles to DB
  let newArticles = 0
  if (limited.length > 0) {
    try {
      newArticles = await saveArticles(limited)
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      logger.error('SYSTEM', 'Failed to save MARKETAUX articles to DB', { stackTrace: message })
    }
  }

  // Update circuit breaker
  await updateCircuitBreaker('MARKETAUX', anySuccess)

  // Record API call
  await recordApiCall(
    'MARKETAUX',
    endpointsCalled.join('; ') || '/news/all',
    anySuccess ? 200 : null,
    responseTimeMs,
    totalRawFetched,
    newArticles,
    duplicates,
    lastError,
  )

  logger.info('API_RATE_LIMIT', `MARKETAUX fetch complete: ${limited.length} articles (${newArticles} new, ${duplicates} deduped) in ${responseTimeMs}ms`, {
    source: 'MARKETAUX',
    details: `Endpoints: ${endpointsCalled.join(', ')}`,
    metadata: { totalRawFetched, newArticles, duplicates, responseTimeMs },
  })

  return {
    articles: limited,
    totalFetched: totalRawFetched,
    newArticles,
    deduped: duplicates,
    provider: 'MARKETAUX',
    responseTimeMs,
    cached: false,
  }
}

// ============================================================================
// SECTION 10: Main Fetch Function
// ============================================================================

/**
 * Main entry point for fetching market news.
 *
 * Orchestration flow:
 *   1. Check cache (unless forceRefresh)
 *   2. Determine provider (explicit or highest-priority enabled from DB)
 *   3. Attempt fetch from primary provider
 *   4. If primary fails (circuit open / rate limited / error), fallback to secondary
 *   5. Normalize, deduplicate, save new articles to DB
 *   6. Update cache
 *   7. Log fetch results
 *   8. Return NewsFetchResult
 *
 * @param options - Optional fetch configuration
 * @returns NewsFetchResult with articles and metrics
 */
export async function fetchNews(options?: NewsFetchOptions): Promise<NewsFetchResult> {
  const opts: NewsFetchOptions = {
    symbols: DEFAULT_SYMBOLS,
    maxArticles: 50,
    ...options,
  }

  // Step 1: Check cache (unless forceRefresh)
  if (!opts.forceRefresh && opts.provider) {
    const cacheKey = buildCacheKey(opts, opts.provider)
    const cached = getCache(cacheKey)
    if (cached) {
      logger.info('SYSTEM', `News cache hit for ${opts.provider}`, {
        source: opts.provider,
        details: `${cached.articles.length} articles from cache`,
      })
      return {
        articles: cached.articles,
        totalFetched: cached.articles.length,
        newArticles: 0,
        deduped: 0,
        provider: opts.provider,
        responseTimeMs: 0,
        cached: true,
      }
    }
  }

  // Also check cache for all providers if no explicit provider
  if (!opts.forceRefresh && !opts.provider) {
    const providers: NewsProvider[] = ['FINNHUB', 'MARKETAUX']
    for (const provider of providers) {
      const cacheKey = buildCacheKey(opts, provider)
      const cached = getCache(cacheKey)
      if (cached) {
        logger.info('SYSTEM', `News cache hit for ${provider} (auto-detect)`, {
          source: provider,
          details: `${cached.articles.length} articles from cache`,
        })
        return {
          articles: cached.articles,
          totalFetched: cached.articles.length,
          newArticles: 0,
          deduped: 0,
          provider,
          responseTimeMs: 0,
          cached: true,
        }
      }
    }
  }

  // Step 2: Determine provider order
  let providers: NewsProvider[]
  if (opts.provider) {
    providers = [opts.provider]
  } else {
    const available = await getAvailableProviders()
    providers = available.length > 0 ? available : ['FINNHUB', 'MARKETAUX']
  }

  // Add fallback providers not in the primary list
  const allProviders: NewsProvider[] = ['FINNHUB', 'MARKETAUX']
  for (const p of allProviders) {
    if (!providers.includes(p)) {
      providers.push(p)
    }
  }

  // Step 3-4: Try providers with fallback
  for (const provider of providers) {
    try {
      let result: NewsFetchResult

      if (provider === 'FINNHUB') {
        result = await fetchFromFinnhub(opts)
      } else {
        result = await fetchFromMarketaux(opts)
      }

      // If we got articles, use this result
      if (result.articles.length > 0) {
        // Step 6: Update cache
        const cacheKey = buildCacheKey(opts, provider)
        setCache(cacheKey, result.articles)

        logger.info('SYSTEM', `News fetch succeeded via ${provider}: ${result.articles.length} articles`, {
          source: provider,
          details: `${result.newArticles} new, ${result.deduped} deduped, ${result.responseTimeMs}ms`,
          metadata: {
            totalFetched: result.totalFetched,
            newArticles: result.newArticles,
            deduped: result.deduped,
            responseTimeMs: result.responseTimeMs,
          },
        })

        return result
      }

      // No articles from this provider, try next
      logger.info('SYSTEM', `No articles from ${provider}, trying fallback`, { source: provider })
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : String(providerError)
      logger.error('SYSTEM', `News fetch failed for ${provider}, trying fallback`, {
        source: provider,
        stackTrace: message,
      })
    }
  }

  // All providers failed or returned no articles
  logger.warn('SYSTEM', 'All news providers failed or returned no articles')
  return {
    articles: [],
    totalFetched: 0,
    newArticles: 0,
    deduped: 0,
    provider: 'NONE',
    responseTimeMs: 0,
    cached: false,
  }
}

// ============================================================================
// SECTION 11: Breaking News Detection
// ============================================================================

/**
 * Detect breaking news from recent articles (last 15 minutes).
 * Scans article titles for high-impact keywords indicating
 * market-moving events.
 *
 * Keywords include: crash, surge, rate decision, emergency, ban,
 * collapse, plunge, soar, rally, halt, suspension, downgrade,
 * default, bankruptcy, scandal, fraud, investigation, sanction,
 * war, terror, pandemic, lockdown, crisis, bank run, margin call,
 * circuit breaker, trading halt, rate hike, rate cut, plus
 * Indonesian equivalents (bijak, darurat, skandal).
 *
 * @returns Array of BreakingNewsItem with matched article and keywords
 */
export async function detectBreakingNews(): Promise<BreakingNewsItem[]> {
  try {
    const windowStart = new Date(Date.now() - BREAKING_NEWS_WINDOW_MIN * 60 * 1000)

    const recentArticles = await db.newsArticle.findMany({
      where: {
        publishedAt: { gte: windowStart },
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    })

    if (recentArticles.length === 0) {
      return []
    }

    const breakingItems: BreakingNewsItem[] = []

    for (const article of recentArticles) {
      const titleLower = article.title.toLowerCase()
      const contentLower = (article.content ?? '').toLowerCase()
      const searchText = `${titleLower} ${contentLower}`

      const matchedKeywords: string[] = []
      for (const keyword of BREAKING_KEYWORDS) {
        if (searchText.includes(keyword.toLowerCase())) {
          matchedKeywords.push(keyword)
        }
      }

      if (matchedKeywords.length > 0) {
        let symbols: string[] = []
        try {
          const parsed = JSON.parse(article.symbols)
          if (Array.isArray(parsed)) {
            symbols = parsed as string[]
          }
        } catch {
          // symbols field is not valid JSON, ignore
        }

        breakingItems.push({
          article: {
            title: article.title,
            content: article.content ?? '',
            source: article.source ?? 'unknown',
            url: article.url ?? '',
            imageUrl: article.imageUrl,
            symbols,
            publishedAt: article.publishedAt,
            category: article.category,
            provider: 'FINNHUB', // DB doesn't store provider, default
          },
          matchedKeywords,
        })
      }
    }

    if (breakingItems.length > 0) {
      for (const item of breakingItems) {
        logger.warn('NOTIFICATION', `BREAKING NEWS: ${item.article.title}`, {
          source: item.article.source,
          symbol: item.article.symbols[0] || undefined,
          details: `Keywords: ${item.matchedKeywords.join(', ')} | URL: ${item.article.url}`,
          metadata: {
            matchedKeywords: item.matchedKeywords,
            symbols: item.article.symbols,
            publishedAt: item.article.publishedAt,
          },
        })
      }
    }

    return breakingItems
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', 'Breaking news detection failed', {
      stackTrace: message,
    })
    return []
  }
}

// ============================================================================
// SECTION 12: News Statistics
// ============================================================================

/**
 * Get aggregate news statistics including totals, breakdowns by source,
 * sentiment, and category, plus cache performance metrics.
 *
 * @returns NewsStats with all aggregate data
 */
export async function getNewsStats(): Promise<NewsStats> {
  try {
    // Total articles
    const totalArticles = await db.newsArticle.count()

    // Articles from last 24 hours
    const last24hDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const last24h = await db.newsArticle.count({
      where: { fetchedAt: { gte: last24hDate } },
    })

    // Breakdown by source
    const bySourceRaw = await db.newsArticle.groupBy({
      by: ['source'],
      _count: { id: true },
    })
    const bySource: Record<string, number> = {}
    for (const row of bySourceRaw) {
      if (row.source) {
        bySource[row.source] = row._count.id
      }
    }

    // Breakdown by sentiment
    const bySentimentRaw = await db.newsArticle.groupBy({
      by: ['sentiment'],
      _count: { id: true },
    })
    const bySentiment: Record<string, number> = {}
    for (const row of bySentimentRaw) {
      bySentiment[row.sentiment] = row._count.id
    }

    // Breakdown by category
    const byCategoryRaw = await db.newsArticle.groupBy({
      by: ['category'],
      _count: { id: true },
      where: { category: { not: null } },
    })
    const byCategory: Record<string, number> = {}
    for (const row of byCategoryRaw) {
      if (row.category) {
        byCategory[row.category] = row._count.id
      }
    }

    // Average fetch time from recent logs
    const recentLogs = await db.newsFetchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    let avgFetchTimeMs = 0
    if (recentLogs.length > 0) {
      const totalTime = recentLogs.reduce((sum, log) => sum + log.responseTimeMs, 0)
      avgFetchTimeMs = Math.round(totalTime / recentLogs.length)
    }

    // Last fetch time
    const lastFetchAt = recentLogs.length > 0 ? recentLogs[0].createdAt : null

    // Cache stats
    const cacheStats = getCacheStats()

    return {
      totalArticles,
      last24h,
      bySource,
      bySentiment,
      byCategory,
      avgFetchTimeMs,
      cacheHitRate: cacheStats.hitRate,
      lastFetchAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', 'Failed to get news stats', {
      stackTrace: message,
    })
    return {
      totalArticles: 0,
      last24h: 0,
      bySource: {},
      bySentiment: {},
      byCategory: {},
      avgFetchTimeMs: 0,
      cacheHitRate: 0,
      lastFetchAt: null,
    }
  }
}

// ============================================================================
// SECTION 13: Seed / Initialization
// ============================================================================

/**
 * Seed default news source configurations into the database.
 * Uses upsert to avoid creating duplicates.
 *
 * Default configs:
 *   - FINNHUB: priority 10, 60 req/min, 1000 req/day
 *   - MARKETAUX: priority 5, 10 req/min, 500 req/day
 *
 * API keys are read from environment variables:
 *   - FINNHUB_API_KEY (default: 'demo')
 *   - MARKETAUX_API_KEY (default: 'demo')
 */
export async function seedNewsSourceConfigs(): Promise<void> {
  try {
    const finnhubApiKey = process.env.FINNHUB_API_KEY || 'demo'
    const marketauxApiKey = process.env.MARKETAUX_API_KEY || 'demo'

    // Upsert FINNHUB config
    await db.newsSourceConfig.upsert({
      where: { provider: 'FINNHUB' },
      update: {
        apiKey: finnhubApiKey,
        baseUrl: 'https://finnhub.io/api/v1',
        priority: 10,
        rateLimitPerMin: 60,
        rateLimitPerDay: 1000,
      },
      create: {
        provider: 'FINNHUB',
        apiKey: finnhubApiKey,
        baseUrl: 'https://finnhub.io/api/v1',
        enabled: true,
        priority: 10,
        rateLimitPerMin: 60,
        rateLimitPerDay: 1000,
        circuitState: 'CLOSED',
        consecutiveErrors: 0,
        callsThisMinute: 0,
        callsThisDay: 0,
      },
    })

    // Upsert MARKETAUX config
    await db.newsSourceConfig.upsert({
      where: { provider: 'MARKETAUX' },
      update: {
        apiKey: marketauxApiKey,
        baseUrl: 'https://api.marketaux.com/v1',
        priority: 5,
        rateLimitPerMin: 10,
        rateLimitPerDay: 500,
      },
      create: {
        provider: 'MARKETAUX',
        apiKey: marketauxApiKey,
        baseUrl: 'https://api.marketaux.com/v1',
        enabled: true,
        priority: 5,
        rateLimitPerMin: 10,
        rateLimitPerDay: 500,
        circuitState: 'CLOSED',
        consecutiveErrors: 0,
        callsThisMinute: 0,
        callsThisDay: 0,
      },
    })

    logger.info('SYSTEM', 'News source configs seeded/updated', {
      details: 'FINNHUB (priority 10, 60/min) and MARKETAUX (priority 5, 10/min)',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', 'Failed to seed news source configs', {
      stackTrace: message,
    })
  }
}
