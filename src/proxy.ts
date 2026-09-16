import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth-core'

/**
 * proxy.ts (konvensi Next.js 16 — penerus middleware.ts) — Gerbang keamanan API FINEX AI.
 *
 * 1. RATE LIMIT per IP (in-memory token window):
 *    - GET                : 240 req/menit
 *    - POST/PUT/PATCH/DEL :  60 req/menit
 *    → 429 + Retry-After.
 *
 * 2. AUTENTIKASI: seluruh /api/* (kecuali /api/auth/* dan /api/health)
 *    wajib membawa cookie session `finex_session` JWT yang valid →
 *    selain itu 401 JSON.
 *
 * Endpoint publik sengaja dikecualikan via matcher di bawah.
 */

interface Bucket {
  count: number
  resetAt: number
}

const globalForMw = globalThis as unknown as {
  __finexRateBuckets?: Map<string, Bucket>
}
const buckets: Map<string, Bucket> = globalForMw.__finexRateBuckets ?? new Map()
globalForMw.__finexRateBuckets = buckets

const READ_LIMIT = 240 // req/menit
const WRITE_LIMIT = 60 // req/menit
const WINDOW_MS = 60 * 1000

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

function rateLimit(ip: string, isWrite: boolean): { ok: boolean; retryAfter: number } {
  const now = Date.now()
  // Prune berkala agar Map tidak tumbuh tanpa batas
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k)
    }
  }
  const key = `${ip}:${isWrite ? 'w' : 'r'}`
  const cur = buckets.get(key)
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { ok: true, retryAfter: 0 }
  }
  cur.count += 1
  if (cur.count > (isWrite ? WRITE_LIMIT : READ_LIMIT)) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) }
  }
  return { ok: true, retryAfter: 0 }
}

export async function proxy(req: NextRequest) {
  const ip = clientIp(req)
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD'

  // --- Rate limit dulu (agar penyerang tanpa session pun dibatasi) ---
  const rl = rateLimit(ip, isWrite)
  if (!rl.ok) {
    return NextResponse.json(
      {
        success: false,
        error: 'RATE_LIMITED',
        message: 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.',
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  // --- Autentikasi session ---
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json(
      {
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Sesi tidak valid atau belum login.',
      },
      { status: 401 }
    )
  }

  // Teruskan identitas ke route handler (opsional, untuk audit)
  const res = NextResponse.next()
  res.headers.set('x-user', session.sub)
  return res
}

/**
 * Proteksi SELURUH /api/* KECUALI:
 *  - /api/auth/*  (login/logout/session)
 *  - /api/health  (monitoring publik)
 */
export const config = {
  matcher: ['/api/((?!auth|health).*)'],
}
