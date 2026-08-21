import { z } from 'zod/v4';

// ============ AUTH ============
export const RegisterSchema = z.object({
  email: z.email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().max(100).optional(),
});

export const LoginSchema = z.object({
  email: z.email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
  twoFactorCode: z.string().length(6, '2FA code must be 6 digits').optional(),
});

export const ForgotPasswordSchema = z.object({
  email: z.email('Invalid email format'),
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

// ============ TRADING ============
export const FOREX_PAIRS = ['EURUSD', 'USDJPY', 'GBPUSD', 'XAUUSD'] as const;
export type ForexPair = (typeof FOREX_PAIRS)[number];

export const CreatePositionSchema = z.object({
  pair: z.enum(FOREX_PAIRS, { error: 'Invalid pair' }),
  direction: z.enum(['BUY', 'SELL'], { error: 'direction must be BUY or SELL' }),
  lotSize: z.number().min(0.01).max(50).multipleOf(0.01).optional(),
  entryPrice: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  trailingStop: z.number().positive().nullable().optional(),
  strategy: z.string().max(100).optional(),
  marketCondition: z.string().max(50).optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  riskAmount: z.number().nonnegative().optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  aiRecommendation: z.enum(['BUY', 'SELL', 'HOLD', 'AVOID']).optional(),
});

export const ClosePositionSchema = z.object({
  id: z.string().min(1, 'Position ID is required'),
  closeReason: z.string().max(200).optional(),
});

export const CreatePendingOrderSchema = z.object({
  pair: z.enum(FOREX_PAIRS, { error: 'Invalid pair' }),
  direction: z.enum(['BUY', 'SELL']),
  orderType: z.enum(['limit', 'stop', 'buy_stop', 'sell_stop', 'buy_limit', 'sell_limit']),
  lotSize: z.number().min(0.01).max(50).multipleOf(0.01),
  price: z.number().positive('Price must be positive'),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  strategy: z.string().max(100).optional(),
  aiConfidence: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const CreateAlertSchema = z.object({
  pair: z.enum(FOREX_PAIRS),
  condition: z.enum(['above', 'below', 'crosses_above', 'crosses_below']),
  targetPrice: z.number().positive(),
  note: z.string().max(500).optional(),
  emailNotify: z.boolean().optional(),
});

// ============ ANALYSIS ============
export const AnalysisSchema = z.object({
  pair: z.enum(FOREX_PAIRS),
  timeframe: z.string().min(1),
  provider: z.string().optional(),
});

export const MtfAnalysisSchema = z.object({
  pair: z.enum(FOREX_PAIRS),
  timeframes: z.array(z.string().min(1)).min(1).max(6),
  provider: z.string().optional(),
});

// ============ BACKTEST ============
export const BacktestSchema = z.object({
  pair: z.enum(FOREX_PAIRS),
  strategy: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  initialBalance: z.number().positive().default(10000),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

// ============ CONFIG ============
export const UpdateConfigSchema = z.object({
  riskPerTrade: z.number().min(0.1).max(10).optional(),
  stopLossMin: z.number().min(1).max(50).optional(),
  stopLossMax: z.number().min(5).max(100).optional(),
  riskRewardRatio: z.number().min(0.5).max(10).optional(),
  maxOpenPositions: z.number().int().min(1).max(20).optional(),
  minLot: z.number().min(0.01).max(1).optional(),
  maxLotPerOrder: z.number().min(0.01).max(100).optional(),
  dailyRiskLimit: z.number().min(0.5).max(50).optional(),
  leverage: z.number().int().min(1).max(100).optional(),
  autoTrading: z.boolean().optional(),
  autoTrailingStop: z.boolean().optional(),
  trailingStopPips: z.number().min(1).max(100).optional(),
  avoidNewsTrading: z.boolean().optional(),
  aiProvider: z.string().max(50).optional(),
  aiModel: z.string().max(100).optional(),
  notifyEmail: z.email().optional().nullable(),
  emailOnPositionOpen: z.boolean().optional(),
  emailOnPositionClose: z.boolean().optional(),
  emailOnAlertTrigger: z.boolean().optional(),
});

// ============ WATCHLIST ============
export const AddWatchlistSchema = z.object({
  pair: z.enum(FOREX_PAIRS),
});

// ============ SIGNALS ============
export const ShareSignalSchema = z.object({
  pair: z.enum(FOREX_PAIRS),
  direction: z.enum(['BUY', 'SELL']),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().max(2000).optional(),
  strategy: z.string().max(100).optional(),
});

export const SignalCommentSchema = z.object({
  content: z.string().min(1).max(1000, 'Comment must be 1-1000 characters'),
});

// ============ TRANSACTIONS ============
export const CreateTransactionSchema = z.object({
  type: z.enum(['deposit', 'withdrawal', 'adjustment']),
  amount: z.number().positive('Amount must be positive'),
  description: z.string().max(500).optional(),
});

// ============ HELPER ============
/** Validate request body against a Zod schema, return parsed data or error response */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown
):
  | { success: true; data: T }
  | { success: false; error: { error: string; details: Array<{ path: string; message: string }> }; status: number } {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return {
      success: false,
      error: { error: 'Validation failed', details },
      status: 400,
    };
  }
  return { success: true, data: result.data };
}
