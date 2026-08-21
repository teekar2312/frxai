import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthForMutation } from '@/lib/api-auth';
import { validateAuth } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError, safeLog } from '@/lib/safe-log';

const VALID_TYPES = ['deposit', 'withdrawal', 'adjustment'] as const;

type TransactionType = (typeof VALID_TYPES)[number];

// GET - List transactions
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const where = typeFilter && VALID_TYPES.includes(typeFilter as TransactionType)
      ? { type: typeFilter as TransactionType }
      : {};

    const [transactions, total] = await Promise.all([
      db.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.transaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions,
      total,
      limit,
      offset,
    });
  } catch (error) {
    logApiError('Transactions', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

// POST - Create deposit/withdrawal/adjustment
export async function POST(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'mutation');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = requireAuthForMutation(request);
  if (!auth.authorized) return auth.error!;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  try {
    const body = await request.json();
    const { type, amount, description } = body as {
      type: string;
      amount: number;
      description?: string;
    };

    // Validate type
    if (!type || !VALID_TYPES.includes(type as TransactionType)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate amount
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    }

    // Get current balance from TradingConfig
    const config = await db.tradingConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: {},
    });

    const balanceBefore = config.accountBalance;
    let balanceAfter: number;

    if (type === 'deposit' || type === 'adjustment') {
      balanceAfter = balanceBefore + amount;
    } else if (type === 'withdrawal') {
      if (amount > balanceBefore) {
        return NextResponse.json(
          { error: `Insufficient balance. Current balance: $${balanceBefore.toFixed(2)}, requested: $${amount.toFixed(2)}` },
          { status: 400 },
        );
      }
      balanceAfter = balanceBefore - amount;
    } else {
      balanceAfter = balanceBefore;
    }

    // Create transaction and update balance atomically
    const transaction = await db.$transaction(async (tx) => {
      const newTx = await tx.transaction.create({
        data: {
          type,
          amount,
          currency: 'USD',
          balanceBefore,
          balanceAfter,
          description: description || null,
        },
      });

      await tx.tradingConfig.update({
        where: { id: 'default' },
        data: { accountBalance: balanceAfter },
      });

      return newTx;
    });

    // Activity log
    try {
      await db.activityLog.create({
        data: {
          level: 'info',
          category: 'trading',
          message: `${type === 'deposit' ? 'Deposit' : type === 'withdrawal' ? 'Withdrawal' : 'Adjustment'}: $${amount.toFixed(2)} (balance: $${balanceBefore.toFixed(2)} → $${balanceAfter.toFixed(2)})`,
        },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      transaction,
      newBalance: balanceAfter,
    }, { status: 201 });
  } catch (error) {
    logApiError('Transactions', error);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
