import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { safeLog } from '@/lib/safe-log';

// Public paths that don't require authentication
const PUBLIC_PATHS = ['/api/auth', '/api/health', '/login', '/register', '/manifest.json', '/forgot-password', '/reset-password', '/legal'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname.startsWith(p));
}

// ============================================================
// Global Rate Limiter (in-memory, Edge-compatible)
// ============================================================
interface GlobalRateEntry {
  count: number;
  resetAt: number;
}

const globalRateMap = new Map<string, GlobalRateEntry>();

// Cleanup every 5 minutes
if (typeof globalThis !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of globalRateMap) {
      if (now > entry.resetAt) globalRateMap.delete(key);
    }
  }, 300_000);
}

interface GlobalLimitConfig {
  windowMs: number;
  maxRequests: number;
}

function getGlobalLimitConfig(pathname: string): GlobalLimitConfig {
  // Stricter limits for sensitive endpoints
  if (pathname.startsWith('/api/auth/')) return { windowMs: 15 * 60 * 1000, maxRequests: 20 }; // 20/15min
  if (pathname.startsWith('/api/analysis')) return { windowMs: 60 * 1000, maxRequests: 10 }; // 10/min
  if (pathname.startsWith('/api/auto-execute')) return { windowMs: 60 * 1000, maxRequests: 5 }; // 5/min
  if (pathname.startsWith('/api/backtest')) return { windowMs: 60 * 1000, maxRequests: 5 }; // 5/min
  if (pathname.startsWith('/api/positions')) return { windowMs: 60 * 1000, maxRequests: 60 }; // 60/min
  if (pathname.startsWith('/api/pending-orders')) return { windowMs: 60 * 1000, maxRequests: 40 }; // 40/min
  if (pathname.startsWith('/api/mt5/')) return { windowMs: 60 * 1000, maxRequests: 60 }; // 60/min
  // Default: generous for read-only endpoints
  return { windowMs: 60 * 1000, maxRequests: 120 }; // 120/min
}

function getClientKey(request: NextRequest): string {
  const sessionToken = request.cookies.get('next-auth.session-token')?.value
    || request.cookies.get('__Secure-next-auth.session-token')?.value;
  if (sessionToken) return `user:${sessionToken.slice(0, 16)}`;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  return `ip:${ip}`;
}

function checkGlobalRateLimit(key: string, config: GlobalLimitConfig): { allowed: boolean; retryAfterMs: number; resetAt: number } {
  const now = Date.now();
  const entry = globalRateMap.get(key);

  if (!entry || now > entry.resetAt) {
    globalRateMap.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, retryAfterMs: 0, resetAt: now + config.windowMs };
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, retryAfterMs: entry.resetAt - now, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0, resetAt: entry.resetAt };
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const pathname = url.pathname;
  const isProduction = process.env.NODE_ENV === 'production';

  // ============================================================
  // Authentication Check
  // ============================================================
  let token;
  try {
    token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
  } catch (error) {
    safeLog({
      level: 'error',
      route: 'Middleware',
      message: 'getToken() failed — treating as unauthenticated',
      error: error instanceof Error ? error.message : String(error),
    });
    token = null;
  }

  const isAuthenticated = !!token;

  // Allow NextAuth routes and health check without auth
  if (isPublicPath(pathname)) {
    // If already authenticated and trying to access login, redirect to dashboard
    if (pathname === '/login' && isAuthenticated) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    const response = NextResponse.next();
    setSecurityHeaders(response, isProduction);
    return response;
  }

  // ============================================================
  // Global API Rate Limiting (Layer 1: IP-based)
  // ============================================================
  if (pathname.startsWith('/api/') && pathname !== '/api/health') {
    const clientKey = getClientKey(request);
    const globalLimit = getGlobalLimitConfig(pathname);
    const globalResult = checkGlobalRateLimit(clientKey, globalLimit);

    if (!globalResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: Math.ceil(globalResult.retryAfterMs / 1000) },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(globalLimit.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(globalResult.resetAt / 1000)),
            'Retry-After': String(Math.ceil(globalResult.retryAfterMs / 1000)),
          },
        }
      );
    }
  }

  // Require authentication for all other routes
  if (!isAuthenticated) {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    safeLog({ level: 'warn', route: 'Middleware', message: `Auth denied: ${pathname}`, meta: { ip } });

    // For API routes: return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    // For page routes: redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // ============================================================
  // Route Guards
  // ============================================================
  // Only allow / and /login page routes
  if (!pathname.startsWith('/api/') && pathname !== '/' && pathname !== '/register' && !pathname.startsWith('/forgot-password') && !pathname.startsWith('/reset-password') && !pathname.startsWith('/legal')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // ============================================================
  // Security Headers
  // ============================================================
  const response = NextResponse.next();
  setSecurityHeaders(response, isProduction);
  return response;
}

function setSecurityHeaders(response: NextResponse, isProduction: boolean) {
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Clickjacking protection
  response.headers.set('X-Frame-Options', 'DENY');

  // XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy — restrict browser features
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  // HSTS — enforce HTTPS in production
  if (isProduction) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  // Content-Security-Policy — C-3 fix: remove unsafe-eval in production
  const scriptSrc = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

  // Production CSP: restrict connect-src to HTTPS/WSS only, img-src to HTTPS only
  const connectSrc = isProduction
    ? "connect-src 'self' https: wss:"
    : "connect-src 'self' https: http: ws: wss:";

  const imgSrc = isProduction
    ? "img-src 'self' data: blob: https:"
    : "img-src 'self' data: blob: https: http:";

  const cspDirectives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    imgSrc,
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  response.headers.set('Content-Security-Policy', cspDirectives);
}

export const config = {
  matcher: [
    // Match all paths except static files and _next internals
    '/((?!_next/static|_next/image|favicon.svg|logo.svg|robots.txt).*)',
  ],
};
