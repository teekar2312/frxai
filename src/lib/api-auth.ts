import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.API_SECRET_KEY || '';

if (!API_KEY && process.env.NODE_ENV === 'production') {
  console.warn('[SECURITY] API_SECRET_KEY is not set in production. All mutating endpoints are unprotected!');
}

export function validateAuth(request: NextRequest): { authorized: boolean; error?: NextResponse } {
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
