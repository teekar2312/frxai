import { NextRequest, NextResponse } from 'next/server.js';
import { timingSafeEqual } from 'node:crypto';
import { safeLog } from '@/lib/safe-log';

const API_KEY = process.env.API_SECRET_KEY || '';

if (!API_KEY && process.env.NODE_ENV === 'production') {
  safeLog({ level: 'warn', route: 'API-Auth', message: 'API_SECRET_KEY is not set in production. All mutating endpoints are unprotected!' });
}

export function validateAuth(request: NextRequest): { authorized: boolean; error?: NextResponse } {
  // FIX LIB-016: In production, reject mutations when no API key is configured
  if (!API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      return {
        authorized: false,
        error: NextResponse.json({ error: 'Server misconfigured: API_SECRET_KEY not set' }, { status: 503 }),
      };
    }
    return { authorized: true };
  }

  const authHeader = request.headers.get('authorization');
  const apiKeyHeader = request.headers.get('x-api-key');

  let providedKey = '';
  if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  if (!providedKey) {
    return {
      authorized: false,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  // FIX LIB-004: Use timing-safe comparison to prevent timing side-channel attacks
  try {
    const a = Buffer.from(providedKey);
    const b = Buffer.from(API_KEY);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return {
        authorized: false,
        error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }
  } catch {
    return {
      authorized: false,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { authorized: true };
}

export const AUTH_REQUIRED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export function requireAuthForMutation(request: NextRequest): { authorized: boolean; error?: NextResponse } {
  const method = request.method.toUpperCase();
  if (!AUTH_REQUIRED_METHODS.includes(method)) {
    return { authorized: true };
  }
  return validateAuth(request);
}
