import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.API_SECRET_KEY || '';

/**
 * C-1: Validate API key from request headers.
 * If API_SECRET_KEY env var is not set, auth is disabled (development mode).
 * Key can be passed via Authorization: Bearer <key> or X-API-Key: <key>.
 */
export function validateAuth(request: NextRequest): { authorized: boolean; error?: NextResponse } {
  // Auth disabled if no key configured
  if (!API_KEY) return { authorized: true };

  const authHeader = request.headers.get('authorization');
  const apiKeyHeader = request.headers.get('x-api-key');

  let providedKey = '';
  if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  if (!providedKey || providedKey !== API_KEY) {
    return {
      authorized: false,
      error: NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  return { authorized: true };
}

/** Mutating endpoints that require auth check */
export const AUTH_REQUIRED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Check auth for mutating methods only.
 * GET requests are always allowed (read-only data).
 */
export function requireAuthForMutation(request: NextRequest): { authorized: boolean; error?: NextResponse } {
  const method = request.method.toUpperCase();
  if (!AUTH_REQUIRED_METHODS.includes(method)) {
    return { authorized: true };
  }
  return validateAuth(request);
}
