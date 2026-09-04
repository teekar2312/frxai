/**
 * FRxAI — Global API Middleware (Edge-safe, self-contained)
 * ============================================================
 * 1. Rate limiting (sliding window per IP × tier) on all /api/* routes
 * 2. Request correlation ID (X-Request-Id) for tracing
 *
 * This middleware MUST stay Edge-runtime compatible: no Node APIs, no
 * Prisma, no imports from src/lib (server-only bundles). Budgets are read
 * from process.env (validated by env-validation at server boot — here we
 * parse defensively with safe fallbacks).
 *
 * Tier budgets (defaults, env-overridable):
 *   AI    — /api/ai/*, /api/analysis           (default 10/window)
 *   DRAFT — POST /api/backtest                 (default 5/window)
 *   WRITE — other POST/PUT/PATCH/DELETE        (default 20/window)
 *   READ  — everything else                    (default 100/window)
 *
 * Exempt (monitoring must always respond):
 *   /api/health, /api/metrics
 */

import { NextRequest, NextResponse } from 'next/server'

const EXEMPT_PATHS = new Set(['/api/health', '/api/metrics'])

// ---- Edge-safe env parsing (defensive) ----
function envInt(name: string, def: number): number {
  const raw = process.env[name]
  if (!raw) return def
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def
}
function envBool(name: string, def: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  return ['true', '1', 'yes', 'on'].includes(String(raw).toLowerCase())
}

const RATE_LIMIT_ENABLED = envBool('RATE_LIMIT_ENABLED', true)
const WINDOW_MS = envInt('RATE_LIMIT_WINDOW_MS', 60_000)
const READ_LIMIT = envInt('RATE_LIMIT_MAX_REQUESTS', 100)
const WRITE_LIMIT = envInt('RATE_LIMIT_WRITE_MAX_REQUESTS', 20)
const AI_LIMIT = envInt('RATE_LIMIT_AI_MAX_REQUESTS', 10)
const DRAFT_LIMIT = envInt('RATE_LIMIT_DRAFT_MAX_REQUESTS', 5)

type Tier = 'READ' | 'WRITE' | 'AI' | 'DRAFT'

const TIER_LIMITS: Record<Tier, number> = {
  READ: READ_LIMIT,
  WRITE: WRITE_LIMIT,
  AI: AI_LIMIT,
  DRAFT: DRAFT_LIMIT,
}

// ---- Sliding window store (module-scope, per middleware instance) ----
const windows = new Map<string, number[]>()
let blockedTotal = 0
let hitTotal = 0
let lastPrune = 0

function prune(now: number): void {
  if (now - lastPrune < 60_000) return
  lastPrune = now
  for (const [key, hits] of windows) {
    const alive = hits.filter((t) => now - t < WINDOW_MS)
    if (alive.length === 0) windows.delete(key)
    else windows.set(key, alive)
  }
}

function extractIp(req: NextRequest): string {
  const h = req.headers
  const fwd = h.get('x-forwarded-for')
  const first = fwd?.split(',')[0]?.trim()
  if (first && first !== 'unknown') return first
  return h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? h.get('x-client-ip') ?? 'anonymous'
}

function classifyTier(path: string, method: string): Tier {
  if (path.startsWith('/api/ai') || path.startsWith('/api/analysis')) return 'AI'
  if (path.startsWith('/api/backtest') && (method === 'POST' || method === 'PUT')) return 'DRAFT'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return 'WRITE'
  return 'READ'
}

// ---- Expose middleware rate-limit stats to /api/metrics via a header ----
// (The metrics route reads these headers on its own requests only for
//  self-observation; full metrics live in the Node-runtime lib.)
function statsHeaderValue(): string {
  return JSON.stringify({ activeKeys: windows.size, hitTotal, blockedTotal })
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const method = request.method
  const now = Date.now()
  prune(now)

  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()

  if (RATE_LIMIT_ENABLED && !EXEMPT_PATHS.has(pathname)) {
    const tier = classifyTier(pathname, method)
    const limit = TIER_LIMITS[tier]
    const key = `${extractIp(request)}:${tier}`

    let hits = windows.get(key) ?? []
    hits = hits.filter((t) => now - t < WINDOW_MS)
    const current = hits.length

    if (current >= limit) {
      blockedTotal++
      const oldest = hits.length > 0 ? hits[0] : now
      const resetAt = oldest + WINDOW_MS
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000))
      windows.set(key, hits)

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Rate limit exceeded (${tier}): max ${limit} requests per window. Retry after ${retryAfter}s.`,
            tier,
            limit,
            retryAfterSec: retryAfter,
            resetAt: new Date(resetAt).toISOString(),
          },
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
            'X-RateLimit-Tier': tier,
            'X-Request-Id': requestId,
          },
        }
      )
    }

    hits.push(now)
    windows.set(key, hits)
    hitTotal++

    const response = NextResponse.next()
    response.headers.set('X-Request-Id', requestId)
    response.headers.set('X-RateLimit-Limit', String(limit))
    response.headers.set('X-RateLimit-Remaining', String(Math.max(0, limit - hits.length)))
    response.headers.set('X-RateLimit-Reset', String(Math.floor((hits[0] + WINDOW_MS) / 1000)))
    response.headers.set('X-RateLimit-Tier', tier)
    response.headers.set('X-Rate-Limit-Stats', statsHeaderValue())
    return response
  }

  const response = NextResponse.next()
  response.headers.set('X-Request-Id', requestId)
  return response
}

export const config = {
  matcher: '/api/:path*',
}
