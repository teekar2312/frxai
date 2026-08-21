import { describe, it, expect } from 'vitest';
import { validateBody, RegisterSchema, LoginSchema, CreatePositionSchema, CreatePendingOrderSchema, CreateAlertSchema, AnalysisSchema, BacktestSchema, ShareSignalSchema, CreateTransactionSchema } from '@/lib/validation/schemas';

describe('Zod Validation Schemas', () => {
  describe('RegisterSchema', () => {
    it('accepts valid registration', () => {
      const result = validateBody(RegisterSchema, {
        email: 'user@example.com',
        password: 'securepass123',
        name: 'Test User',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const result = validateBody(RegisterSchema, {
        email: 'not-an-email',
        password: 'securepass123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details.some(d => d.path.includes('email'))).toBe(true);
      }
    });

    it('rejects short password', () => {
      const result = validateBody(RegisterSchema, {
        email: 'user@example.com',
        password: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('name is optional', () => {
      const result = validateBody(RegisterSchema, {
        email: 'user@example.com',
        password: 'securepass123',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('CreatePositionSchema', () => {
    it('accepts valid BUY position', () => {
      const result = validateBody(CreatePositionSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        lotSize: 0.01,
        stopLoss: 1.08000,
        takeProfit: 1.09000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid pair', () => {
      const result = validateBody(CreatePositionSchema, {
        pair: 'INVALID',
        direction: 'BUY',
        lotSize: 0.01,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid direction', () => {
      const result = validateBody(CreatePositionSchema, {
        pair: 'EURUSD',
        direction: 'HOLD',
        lotSize: 0.01,
      });
      expect(result.success).toBe(false);
    });

    it('rejects lotSize below minimum', () => {
      const result = validateBody(CreatePositionSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        lotSize: 0.001,
      });
      expect(result.success).toBe(false);
    });

    it('rejects lotSize above maximum', () => {
      const result = validateBody(CreatePositionSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        lotSize: 51,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative lotSize', () => {
      const result = validateBody(CreatePositionSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        lotSize: -0.01,
      });
      expect(result.success).toBe(false);
    });

    it('rejects aiConfidence outside 0-1 range', () => {
      const result = validateBody(CreatePositionSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        aiConfidence: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it('accepts all 4 valid pairs', () => {
      for (const pair of ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD']) {
        const result = validateBody(CreatePositionSchema, { pair, direction: 'SELL', lotSize: 0.01 });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('CreatePendingOrderSchema', () => {
    it('accepts valid limit order', () => {
      const result = validateBody(CreatePendingOrderSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        orderType: 'limit',
        lotSize: 0.01,
        price: 1.08000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid orderType', () => {
      const result = validateBody(CreatePendingOrderSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        orderType: 'market',
        lotSize: 0.01,
        price: 1.08,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing price', () => {
      const result = validateBody(CreatePendingOrderSchema, {
        pair: 'EURUSD',
        direction: 'BUY',
        orderType: 'limit',
        lotSize: 0.01,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateAlertSchema', () => {
    it('accepts valid price alert', () => {
      const result = validateBody(CreateAlertSchema, {
        pair: 'EURUSD',
        condition: 'above',
        targetPrice: 1.10000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid condition', () => {
      const result = validateBody(CreateAlertSchema, {
        pair: 'EURUSD',
        condition: 'equals',
        targetPrice: 1.1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('BacktestSchema', () => {
    it('accepts valid backtest request', () => {
      const result = validateBody(BacktestSchema, {
        pair: 'EURUSD',
        strategy: 'MA Ribbon',
        timeframe: 'H1',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-06-01T00:00:00Z',
        initialBalance: 10000,
      });
      expect(result.success).toBe(true);
    });

    it('uses default initialBalance', () => {
      const result = validateBody(BacktestSchema, {
        pair: 'EURUSD',
        strategy: 'EMA Crossover',
        timeframe: 'H1',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-06-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.initialBalance).toBe(10000);
      }
    });
  });

  describe('ShareSignalSchema', () => {
    it('accepts valid signal share', () => {
      const result = validateBody(ShareSignalSchema, {
        pair: 'XAUUSD',
        direction: 'BUY',
        entryPrice: 2350.50,
        stopLoss: 2340.00,
        takeProfit: 2370.00,
        confidence: 0.85,
        reasoning: 'Strong support level',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('validateBody helper', () => {
    it('returns error details with path and message', () => {
      const result = validateBody(RegisterSchema, { email: 'bad', password: 'x' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe(400);
        expect(result.error.error).toBe('Validation failed');
        expect(result.error.details.length).toBeGreaterThan(0);
        expect(result.error.details[0]).toHaveProperty('path');
        expect(result.error.details[0]).toHaveProperty('message');
      }
    });
  });
});
