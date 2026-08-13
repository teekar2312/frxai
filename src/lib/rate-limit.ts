/**
 * H-1: Simple in-memory rate limiter using sliding window.
 * No external dependencies required.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    // Remove timestamps older than 1 minute
    entry.timestamps = entry.timestamps.filter(t => now - t < 60000);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 300_000);

export interface RateLimitConfig {
  /** Number of requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  // Trade execution: 10 req/min
  trade: { maxRequests: 10, windowMs: 60_000 },
  // AI analysis: 5 req/min
  analysis: { maxRequests: 5, windowMs: 60_000 },
  // FIX MKT-ANALYSIS-007: Separate rate limit bucket for indicators
  indicators: { maxRequests: 10, windowMs: 60_000 },
  // General API: 60 req/min
  general: { maxRequests: 60, windowMs: 60_000 },
  // FNH-001: Finnhub quotes: 12 req/min (conserves 60/min Finnhub free tier)
  finnhub: { maxRequests: 12, windowMs: 60_000 },
  // MTX-001: MARKETAUX news: 3 req/min (conserves 100/day free tier)
  news: { maxRequests: 3, windowMs: 60_000 },
};

/**
 * Check if a request should be rate limited.
 * @param key - Unique identifier (e.g., IP address or endpoint)
 * @param configName - Name of the rate limit config to use
 * @returns { allowed: boolean, retryAfterMs?: number }
 */
export function checkRateLimit(key: string, configName: string): { allowed: boolean; retryAfterMs?: number } {
  const config = DEFAULT_CONFIGS[configName] || DEFAULT_CONFIGS.general;
  const now = Date.now();
  const fullKey = `${configName}:${key}`;

  let entry = store.get(fullKey);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(fullKey, entry);
  }

  // Sliding window: remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < config.windowMs);

  if (entry.timestamps.length >= config.maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow ? (oldestInWindow + config.windowMs - now) : config.windowMs;
    return { allowed: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

/**
 * Create a rate-limited handler wrapper for API routes.
 * Usage at the top of a route handler:
 *   const rateCheck = checkRateLimit(clientIp(request), 'trade');
 *   if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
 */
export function rateLimitedResponse(retryAfterMs?: number) {
  return new Response(
    JSON.stringify({ error: 'Too many requests', retryAfterMs }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil((retryAfterMs || 1000) / 1000)),
      },
    }
  );
}

/** Extract client IP from request */
export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}
