/**
 * FRxAI — API Rate Limiter (Sliding Window + Token Bucket hybrid)
 * ==================================================================
 * Protects all Next.js API routes from excessive requests.
 *
 * Design:
 *   - Sliding-window log per (bucketKey = ip + route class)
 *   - Route classes: READ (default), WRITE, AI, DRAFT with distinct budgets
 *   - 429 responses carry Retry-After + X-RateLimit-* headers
 *   - In-memory store (single Next.js server instance) with periodic pruning
 *   - Tight integration with app-config (hot-tunable limits) and metrics
 *
 * Usage (inside any route handler):
 *   const check = await checkRateLimit(request, 'WRITE')
 *   if (!check.allowed) return rateLimitResponse(check)
 *   // ... handler logic
 *   recordRateLimitMetrics(check)
 */

import { getConfig } from './app-config'

// ============================================
// TYPES
// ============================================

export type RateLimitTier = 'READ' | 'WRITE' | 'AI' | 'DRAFT' | 'EXEMPT'

export interface RateLimitDecision {
  allowed: boolean
  tier: RateLimitTier
  limit: number
  remaining: number
  resetAt: Date
  retryAfterSec: number
  key: string
  /** Total hits recorded in current window (for observability) */
  current: number
}

export interface RateLimitStats {
  activeKeys: number
  totalHits: number
  totalBlocked: number
  prunedKeys: number
  lastPruneAt: Date | null
}

// ============================================
// STORE
// ============================================

interface WindowEntry {
  hits: number[] // timestamps of accepted hits (sliding log)
  blocked: number // blocked attempts within the window
  createdAt: number // bucket creation time (guards prune races)
}

const store = new Map<string, WindowEntry>()
const stats: RateLimitStats = { activeKeys: 0, totalHits: 0, totalBlocked: 0, prunedKeys: 0, lastPruneAt: null }

const PRUNE_INTERVAL_MS = 60_000
let lastPrune = 0

function pruneIfNeeded(now: number, windowMs: number): void {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return
  lastPrune = now
  let pruned = 0
  for (const [key, entry] of store) {
    entry.hits = entry.hits.filter((t) => now - t < windowMs)
    // Only remove buckets that have existed for a full window AND are fully
    // idle — protects buckets created in the current request (prune runs
    // between bucket creation and the first hit push).
    if (entry.hits.length === 0 && entry.blocked === 0 && now - entry.createdAt >= windowMs) {
      store.delete(key)
      pruned++
    } else if (entry.hits.length === 0 && entry.blocked === 0 && now - entry.createdAt < windowMs) {
      // keep young empty buckets alive
    }
  }
  stats.prunedKeys += pruned
  stats.activeKeys = store.size
  stats.lastPruneAt = new Date(now)
}

// ============================================
// TIER BUDGETS (from layered config)
// ============================================

function tierBudget(tier: RateLimitTier, windowMs: number): { limit: number; windowMs: number } {
  switch (tier) {
    case 'WRITE':
      return { limit: getConfig<number>('rateLimit.writeMaxRequests'), windowMs }
    case 'AI':
      return { limit: getConfig<number>('rateLimit.aiMaxRequests'), windowMs }
    case 'DRAFT':
      return { limit: getConfig<number>('rateLimit.draftMaxRequests'), windowMs }
    case 'EXEMPT':
      return { limit: Number.MAX_SAFE_INTEGER, windowMs }
    case 'READ':
    default:
      return { limit: getConfig<number>('rateLimit.maxRequests'), windowMs }
  }
}

// ============================================
// CLIENT IP EXTRACTION
// ============================================

/**
 * Best-effort client IP extraction behind the gateway/proxy.
 * Falls back to 'anonymous' so limits still apply uniformly.
 */
export function extractClientIp(request: Request): string {
  const h = request.headers
  const candidates = [
    h.get('cf-connecting-ip'),
    h.get('x-real-ip'),
    h.get('x-forwarded-for')?.split(',')[0]?.trim(),
    h.get('x-client-ip'),
  ]
  for (const c of candidates) {
    if (c && c.length > 0 && c !== 'unknown') return c
  }
  return 'anonymous'
}

// ============================================
// CORE CHECK
// ============================================

/**
 * Check (and consume) one request slot for the given tier.
 * Tier is combined with the client IP as the bucket key.
 */
export function checkRateLimit(request: Request, tier: RateLimitTier = 'READ'): RateLimitDecision {
  const enabled = getConfig<boolean>('rateLimit.enabled')
  const windowMs = getConfig<number>('rateLimit.windowMs')
  const { limit } = tierBudget(tier, windowMs)
  const now = Date.now()

  if (!enabled) {
    return {
      allowed: true,
      tier,
      limit,
      remaining: limit,
      resetAt: new Date(now + windowMs),
      retryAfterSec: 0,
      key: 'disabled',
      current: 0,
    }
  }

  const ip = extractClientIp(request)
  const key = `${ip}:${tier}`
  let entry = store.get(key)
  if (!entry) {
    entry = { hits: [], blocked: 0, createdAt: now }
    store.set(key, entry)
  }

  // Slide the window
  entry.hits = entry.hits.filter((t) => now - t < windowMs)
  pruneIfNeeded(now, windowMs)

  const current = entry.hits.length
  const allowed = current < limit
  if (allowed) {
    entry.hits.push(now)
    stats.totalHits++
  } else {
    entry.blocked++
    stats.totalBlocked++
  }
  stats.activeKeys = store.size

  const oldest = entry.hits.length > 0 ? entry.hits[0] : now
  const resetAt = new Date(oldest + windowMs)
  const retryAfterSec = Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000))

  return { allowed, tier, limit, remaining: Math.max(0, limit - current - (allowed ? 1 : 0)), resetAt, retryAfterSec, key, current }
}

// ============================================
// RESPONSE HELPERS
// ============================================

export interface RateLimitedResponseInit {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

/** Build a standards-compliant 429 response body/headers from a decision. */
export function buildRateLimitResponse(decision: RateLimitDecision): RateLimitedResponseInit {
  return {
    status: 429,
    statusText: 'Too Many Requests',
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(decision.retryAfterSec),
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.floor(decision.resetAt.getTime() / 1000)),
      'X-RateLimit-Tier': decision.tier,
    },
    body: JSON.stringify({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded (${decision.tier}): max ${decision.limit} requests per window. Retry after ${decision.retryAfterSec}s.`,
        tier: decision.tier,
        limit: decision.limit,
        retryAfterSec: decision.retryAfterSec,
        resetAt: decision.resetAt.toISOString(),
      },
    }),
  }
}

/** NextResponse convenience — 429 with proper headers. */
export function rateLimitResponse(decision: RateLimitDecision): Response {
  const init = buildRateLimitResponse(decision)
  return new Response(init.body, { status: init.status, statusText: init.statusText, headers: init.headers })
}

/** Success-path helper attaching X-RateLimit headers to any response. */
export function withRateLimitHeaders(response: Response, decision: RateLimitDecision): Response {
  const headers = new Headers(response.headers)
  headers.set('X-RateLimit-Limit', String(decision.limit))
  headers.set('X-RateLimit-Remaining', String(decision.remaining))
  headers.set('X-RateLimit-Reset', String(Math.floor(decision.resetAt.getTime() / 1000)))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

// ============================================
// METRICS BRIDGE (lazy — avoids circular import)
// ============================================

type MetricsRecorder = (name: string, labels: Record<string, string>, value?: number) => void
let metricsRecorder: MetricsRecorder | null = null

/** metrics.ts registers itself here at boot (avoids circular import). */
export function registerRateLimitMetricsRecorder(recorder: MetricsRecorder | null): void {
  metricsRecorder = recorder
}

/** Record a rate-limit decision into the metrics system. */
export function recordRateLimitMetrics(decision: RateLimitDecision): void {
  if (!metricsRecorder) return
  try {
    metricsRecorder('api_rate_limit_checks_total', { tier: decision.tier, allowed: decision.allowed ? 'true' : 'false' })
    if (!decision.allowed) {
      metricsRecorder('api_rate_limit_blocked_total', { tier: decision.tier })
    }
  } catch { /* metrics must never break the request path */ }
}

// ============================================
// STATS & MAINTENANCE
// ============================================

export function getRateLimitStats(): RateLimitStats & { windowMs: number; enabled: boolean; budgets: Record<RateLimitTier, number> } {
  const windowMs = getConfig<number>('rateLimit.windowMs')
  return {
    ...stats,
    windowMs,
    enabled: getConfig<boolean>('rateLimit.enabled'),
    budgets: {
      READ: getConfig<number>('rateLimit.maxRequests'),
      WRITE: getConfig<number>('rateLimit.writeMaxRequests'),
      AI: getConfig<number>('rateLimit.aiMaxRequests'),
      DRAFT: getConfig<number>('rateLimit.draftMaxRequests'),
      EXEMPT: Number.MAX_SAFE_INTEGER,
    },
  }
}

/** Test/maintenance hook — clears the in-memory store. */
export function resetRateLimitStore(): void {
  store.clear()
  stats.activeKeys = 0
  stats.totalHits = 0
  stats.totalBlocked = 0
  stats.prunedKeys = 0
  stats.lastPruneAt = null
}

/**
 * Guard wrapper — the one-liner to use inside route handlers:
 *
 *   const guard = rateLimitGuard('WRITE')
 *   const limited = await guard(request)
 *   if (limited) return limited          // 429 Response ready to return
 *   // ... proceed
 */
export function rateLimitGuard(tier: RateLimitTier = 'READ') {
  return (request: Request): Response | null => {
    const decision = checkRateLimit(request, tier)
    recordRateLimitMetrics(decision)
    if (decision.allowed) return null
    return rateLimitResponse(decision)
  }
}
