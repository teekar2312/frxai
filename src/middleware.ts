import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Public paths that don't require authentication
const PUBLIC_PATHS = ['/api/auth', '/api/health', '/login'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const pathname = url.pathname;
  const isProduction = process.env.NODE_ENV === 'production';

  // ============================================================
  // Authentication Check
  // ============================================================
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

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

  // Require authentication for all other routes
  if (!isAuthenticated) {
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
  if (!pathname.startsWith('/api/') && pathname !== '/') {
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
