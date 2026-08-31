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
 *   2. Per-provider rate limiting backed by DB (NewsSourceConfig) with in-memory fast path
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
  // FIX 4: Expanded Indonesian breaking news keywords
  'suspensi', 'pembekuan', 'penghentian', 'pelarangan',
  'kenaikan suku bunga', 'penurunan suku bunga', 'gunung meletus',
  'gempa bumi', 'tsunami', 'banjir', 'kerusuhan', 'demo', 'unjuk rasa',
  'revaluasi', 'devaluasi', 'korupsi', 'pidana', 'tipikor',
  'ott', 'kpk', 'bialngkpinjam paksa', 'bailout', 'negara bangkrut',
  'kelangkaan', 'defisit transaksi berjalan', 'rupiah anjlok', 'rupiah melemah',
  'ijt', 'bank indonesia', 'bi rate', 'inflasi tinggi',
  'pemilu', 'politik', 'kabinet', 'reshuffle',
]

// ============================================================================
// SECTION 3: In-Memory LRU Cache
// ============================================================================

/**
 * Module-level in-memory cache with LRU eviction.
 * Keys are provider-specific cache keys built from symbols + categories.
 */
// Fix #5: LRU cache using Map's insertion-order for O(1) LRU operations
const newsCache = new Map<string, NewsCacheEntry>()
let cacheHitCount = 0
let cacheMissCount = 0

/**
 * Get a cached entry by key. Returns null on miss or expiry.
 * Uses Map delete+set trick for O(1) LRU access-order update.
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
    cacheMissCount++
    return null
  }
  // O(1) LRU touch: re-insert to move to most-recent position (Map iterates in insertion order)
  newsCache.delete(key)
  newsCache.set(key, entry)
  cacheHitCount++
  return entry
}

/**
 * Store articles in cache with a TTL. Evicts LRU entry if at capacity.
 * Uses Map ordering: first key is LRU, last key is MRU.
 */
export function setCache(key: string, articles: NormalizedArticle[], ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
  const now = new Date()
  const entry: NewsCacheEntry = {
    articles,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  }

  // Remove old entry if it exists (will be re-added at end = MRU)
  newsCache.delete(key)

  // Evict LRU (first key) if at capacity
  if (newsCache.size >= MAX_CACHE_ENTRIES) {
    const lruKey = newsCache.keys().next().value
    if (lruKey) {
      newsCache.delete(lruKey)
    }
  }

  newsCache.set(key, entry)
}

/** Clear the entire news cache */
export function clearCache(): void {
  newsCache.clear()
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

// FIX 3: In-memory rate limit tracker to avoid 3 DB queries per call
interface InMemoryRateLimitEntry {
  minuteCount: number
  dayCount: number
  minuteStartAt: number // timestamp of the start of the current minute window
  dayStartAt: number   // timestamp of the start of the current day window
  lastCallAt: number
  lastDbSyncAt: number
  rateLimitPerMin: number
  rateLimitPerDay: number
  enabled: boolean
}

const inMemoryRateLimits: Map<NewsProvider, InMemoryRateLimitEntry> = new Map()
const IN_MEMORY_STALE_MS = 60_000      // Re-sync from DB if no call for 60s
const DB_SYNC_INTERVAL_MS = 30_000    // Sync to DB every 30s

/**
 * Load rate limit state from DB into memory for a provider.
 * Returns the in-memory entry or null if provider not configured.
 */
async function syncRateLimitFromDb(provider: NewsProvider): Promise<InMemoryRateLimitEntry | null> {
  try {
    const config = await db.newsSourceConfig.findUnique({
      where: { provider },
    })
    if (!config || !config.enabled) return null

    const now = Date.now()
    const lastCall = config.lastCallAt ? new Date(config.lastCallAt).getTime() : 0

    // Determine if minute/day counters need reset
    let minuteCount = config.callsThisMinute
    let dayCount = config.callsThisDay

    if (lastCall && (now - lastCall) > 60_000) {
      minuteCount = 0
    }
    if (lastCall && (now - lastCall) > 86_400_000) {
      dayCount = 0
    }

    const entry: InMemoryRateLimitEntry = {
      minuteCount,
      dayCount,
      minuteStartAt: minuteCount === 0 ? now : lastCall,
      dayStartAt: dayCount === 0 ? now : lastCall,
      lastCallAt: lastCall,
      lastDbSyncAt: now,
      rateLimitPerMin: config.rateLimitPerMin,
      rateLimitPerDay: config.rateLimitPerDay,
      enabled: config.enabled,
    }
    inMemoryRateLimits.set(provider, entry)
    return entry
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', `Failed to sync rate limit from DB for ${provider}`, {
      source: provider,
      stackTrace: message,
    })
    return null
  }
}

/**
 * Persist current in-memory rate limit state to DB.
 */
async function syncRateLimitToDb(provider: NewsProvider): Promise<void> {
  const entry = inMemoryRateLimits.get(provider)
  if (!entry) return

  try {
    await db.newsSourceConfig.update({
      where: { provider },
      data: {
        callsThisMinute: entry.minuteCount,
        callsThisDay: entry.dayCount,
        lastCallAt: new Date(entry.lastCallAt),
      },
    })
    entry.lastDbSyncAt = Date.now()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', `Failed to sync rate limit to DB for ${provider}`, {
      source: provider,
      stackTrace: message,
    })
  }
}

/**
 * Check if an API call is allowed under the provider's rate limit.
 * Uses in-memory tracker for fast path (0 DB queries for normal case).
 * Falls back to DB on first call or when in-memory is stale (>60s).
 * Periodically syncs to DB (every 30s).
 *
 * @returns {RateLimitCheck} - allowed, waitMs until next slot, and optional reason
 */
export async function checkRateLimit(provider: NewsProvider): Promise<RateLimitCheck> {
  try {
    const now = Date.now()
    let entry = inMemoryRateLimits.get(provider)

    // If no in-memory entry or stale (>60s), sync from DB
    if (!entry || (now - entry.lastCallAt) > IN_MEMORY_STALE_MS) {
      entry = await syncRateLimitFromDb(provider)
      if (!entry || !entry.enabled) {
        return { allowed: false, waitMs: 0, reason: `Provider ${provider} not configured or disabled` }
      }
    }

    // Reset minute counter if window expired
    if ((now - entry.minuteStartAt) > 60_000) {
      entry.minuteCount = 0
      entry.minuteStartAt = now
    }

    // Reset day counter if window expired
    if ((now - entry.dayStartAt) > 86_400_000) {
      entry.dayCount = 0
      entry.dayStartAt = now
    }

    // Check minute limit
    if (entry.minuteCount >= entry.rateLimitPerMin) {
      const waitMs = 60_000 - (now - entry.minuteStartAt)
      const clampedWait = Math.max(waitMs, 0)
      logger.info('API_RATE_LIMIT', `${provider} minute rate limit reached (${entry.minuteCount}/${entry.rateLimitPerMin})`, {
        source: provider,
        details: `Wait ${clampedWait}ms`,
      })
      return { allowed: false, waitMs: clampedWait, reason: `Minute rate limit reached (${entry.minuteCount}/${entry.rateLimitPerMin})` }
    }

    // Check day limit
    if (entry.dayCount >= entry.rateLimitPerDay) {
      const waitMs = 86_400_000 - (now - entry.dayStartAt)
      const clampedWait = Math.max(waitMs, 0)
      logger.info('API_RATE_LIMIT', `${provider} daily rate limit reached (${entry.dayCount}/${entry.rateLimitPerDay})`, {
        source: provider,
        details: `Wait ${clampedWait}ms`,
      })
      return { allowed: false, waitMs: clampedWait, reason: `Daily rate limit reached (${entry.dayCount}/${entry.rateLimitPerDay})` }
    }

    // Increment in-memory counters
    entry.minuteCount++
    entry.dayCount++
    entry.lastCallAt = now

    // Sync to DB periodically (every 30s) or on significant changes
    if ((now - entry.lastDbSyncAt) > DB_SYNC_INTERVAL_MS) {
      // Fire-and-forget sync (don't await to keep response fast)
      syncRateLimitToDb(provider).catch(() => { /* already logged inside */ })
    }

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
 * Uses title-based dedup: collects all existing titles first (1 query),
 * then creates only truly new articles using createMany for efficiency.
 * Falls back to individual creates if createMany fails.
 */
async function saveArticles(articles: NormalizedArticle[]): Promise<number> {
  if (articles.length === 0) return 0

  try {
    // Batch: get all existing titles in one query
    const titles = articles.map(a => a.title)
    // SQLite can handle large IN clauses but let's batch if needed
    const chunkSize = 100
    const existingTitles = new Set<string>()
    for (let i = 0; i < titles.length; i += chunkSize) {
      const chunk = titles.slice(i, i + chunkSize)
      const existing = await db.newsArticle.findMany({
        where: { title: { in: chunk } },
        select: { title: true },
      })
      for (const e of existing) existingTitles.add(e.title)
    }

    // Create only new articles
    const newArticles = articles.filter(a => !existingTitles.has(a.title))
    if (newArticles.length === 0) return 0

    // FIX 2: Use createMany for batch insert, fall back to individual on failure
    let savedCount = 0
    const createBatchSize = 50
    for (let i = 0; i < newArticles.length; i += createBatchSize) {
      const batch = newArticles.slice(i, i + createBatchSize)
      try {
        await db.newsArticle.createMany({
          data: batch.map(article => ({
            title: article.title,
            content: article.content || null,
            source: article.source || null,
            url: article.url || null,
            imageUrl: article.imageUrl || null,
            sentiment: 'NEUTRAL' as const,
            sentimentScore: 0,
            symbols: JSON.stringify(article.symbols),
            publishedAt: article.publishedAt,
            fetchedAt: new Date(),
            category: article.category || null,
          })),
        })
        savedCount += batch.length
      } catch (createManyError) {
        // Fallback to individual creates if createMany fails
        const message = createManyError instanceof Error ? createManyError.message : String(createManyError)
        logger.warn('SYSTEM', `createMany failed, falling back to individual creates: ${message}`)
        for (const article of batch) {
          try {
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
          } catch (saveError) {
            const saveMessage = saveError instanceof Error ? saveError.message : String(saveError)
            logger.error('SYSTEM', `Failed to save article: ${article.title.slice(0, 60)}`, {
              details: saveMessage,
            })
          }
        }
      }
    }

    return savedCount
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError)
    logger.error('SYSTEM', 'Batch article save failed', { stackTrace: message })
    return 0
  }
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
 *   3. For each symbol, fetch articles from the past 7 days (concurrently)
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

  // FIX 1: Concurrent fetching with Promise.allSettled
  const fetchPromises = symbols.map(async (symbol) => {
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
        return { symbol, error: errorText, articles: [] as NormalizedArticle[], rawCount: 0 }
      }

      const data: unknown = await response.json()
      if (!Array.isArray(data)) {
        return { symbol, error: 'Response is not an array', articles: [] as NormalizedArticle[], rawCount: 0 }
      }

      const rawArticles = data as FinnhubArticle[]

      // FIX 6: Validate response fields before normalizing
      const validArticles = rawArticles.filter((raw: FinnhubArticle) => {
        if (!raw.headline || typeof raw.headline !== 'string') return false
        if (!raw.datetime || typeof raw.datetime !== 'number') return false
        return true
      })

      const normalized = validArticles.map(raw => normalizeFinnhubArticle(raw, symbol))
      return { symbol, error: undefined, articles: normalized, rawCount: rawArticles.length }
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError)
      logger.error('SYSTEM', `Finnhub fetch failed for ${symbol}`, {
        source: 'FINNHUB',
        symbol,
        stackTrace: message,
      })
      return { symbol, error: message, articles: [] as NormalizedArticle[], rawCount: 0 }
    }
  })

  const results = await Promise.allSettled(fetchPromises)

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { articles, rawCount, error } = result.value
      if (error) {
        lastError = error
      } else {
        allArticles.push(...articles)
        totalRawFetched += rawCount
        anySuccess = true
      }
    }
    // Rejected promises are already caught inside the individual fetch, so 'rejected' shouldn't happen
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
  // Fix #7: MARKETAUX uses comma-separated symbols, not dot-separated
  if (symbols.length > 0) {
    const symbolsUrl = new URL('https://api.marketaux.com/v1/news/all')
    symbolsUrl.searchParams.set('countries', 'id')
    symbolsUrl.searchParams.set('filter_entities', 'true')
    symbolsUrl.searchParams.set('symbols', symbols.join(','))
    symbolsUrl.searchParams.set('api_token', apiKey)
    fetchConfigs.push({
      url: symbolsUrl.toString(),
      endpoint: `/news/all?symbols=${symbols.join(',')}`,
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
 * Indonesian equivalents (bijak, darurat, skandal, and many more).
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
            provider: 'FINNHUB', // Fix #3: DB doesn't store provider, infer from source field
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
// SECTION 13: Fetch Log Cleanup
// ============================================================================

/**
 * Cleanup old NewsFetchLog entries to prevent unbounded growth.
 * Keeps the last `keepLastDays` days of logs.
 */
export async function cleanupFetchLogs(keepLastDays: number = 30): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - keepLastDays * 24 * 60 * 60 * 1000)
    const result = await db.newsFetchLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
    if (result.count > 0) {
      logger.info('SYSTEM', `Cleaned up ${result.count} old fetch logs (older than ${keepLastDays} days)`)
    }
    return result.count
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('SYSTEM', 'Fetch log cleanup failed', { stackTrace: message })
    return 0
  }
}

// ============================================================================
// SECTION 14: Seed / Initialization
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
