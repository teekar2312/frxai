import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, rateLimitedResponse, clientIp, DEFAULT_CONFIGS } from '@/lib/rate-limit';

describe('Rate Limiting', () => {
  describe('checkRateLimit', () => {
    it('allows first request', () => {
      const result = checkRateLimit('test-user', 'general');
      expect(result.allowed).toBe(true);
    });

    it('allows requests up to the limit', () => {
      for (let i = 0; i < 59; i++) {
        const result = checkRateLimit('test-user-burst', 'general');
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks requests after limit exceeded', () => {
      for (let i = 0; i < 60; i++) {
        checkRateLimit('test-user-exceeded', 'general');
      }
      const result = checkRateLimit('test-user-exceeded', 'general');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('uses separate buckets for different config names', () => {
      // Exhaust trade bucket (10/min)
      for (let i = 0; i < 10; i++) {
        checkRateLimit('test-user-bucket', 'trade');
      }
      expect(checkRateLimit('test-user-bucket', 'trade').allowed).toBe(false);
      // General bucket should still be open
      expect(checkRateLimit('test-user-bucket', 'general').allowed).toBe(true);
    });

    it('uses separate buckets for different keys', () => {
      for (let i = 0; i < 60; i++) {
        checkRateLimit('user-a', 'general');
      }
      expect(checkRateLimit('user-a', 'general').allowed).toBe(false);
      expect(checkRateLimit('user-b', 'general').allowed).toBe(true);
    });

    it('auth bucket has stricter limit (10/min)', () => {
      expect(DEFAULT_CONFIGS.auth.maxRequests).toBe(10);
      for (let i = 0; i < 10; i++) {
        checkRateLimit('test-auth-user', 'auth');
      }
      expect(checkRateLimit('test-auth-user', 'auth').allowed).toBe(false);
    });

    it('backtest bucket has limit of 3/min', () => {
      expect(DEFAULT_CONFIGS.backtest.maxRequests).toBe(3);
    });

    it('autoTrade bucket has limit of 2/min', () => {
      expect(DEFAULT_CONFIGS.autoTrade.maxRequests).toBe(2);
    });

    it('falls back to general config for unknown config name', () => {
      const result = checkRateLimit('test-unknown', 'nonexistent');
      expect(result.allowed).toBe(true);
    });
  });

  describe('rateLimitedResponse', () => {
    it('returns 429 status', () => {
      const response = rateLimitedResponse(1000);
      expect(response.status).toBe(429);
    });

    it('includes Retry-After header', () => {
      const response = rateLimitedResponse(5000);
      expect(response.headers.get('Retry-After')).toBe('5');
    });

    it('includes X-RateLimit headers when configName provided', () => {
      const response = rateLimitedResponse('trade', 5000);
      expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('backwards compatible: works with just retryAfterMs (number)', () => {
      const response = rateLimitedResponse(3000);
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('3');
    });

    it('returns JSON body with error and retryAfterMs', async () => {
      const response = rateLimitedResponse(2000);
      const body = await response.json();
      expect(body.error).toBe('Too many requests');
      expect(body.retryAfterMs).toBe(2000);
    });
  });

  describe('clientIp', () => {
    it('extracts IP from x-forwarded-for', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      });
      expect(clientIp(req)).toBe('1.2.3.4');
    });

    it('extracts IP from x-real-ip', () => {
      const req = new Request('http://localhost', {
        headers: { 'x-real-ip': '10.0.0.1' },
      });
      expect(clientIp(req)).toBe('10.0.0.1');
    });

    it('returns unknown when no IP headers', () => {
      const req = new Request('http://localhost');
      expect(clientIp(req)).toBe('unknown');
    });
  });
});
