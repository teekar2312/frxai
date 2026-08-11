import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET - Fetch activity logs (paginated)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const level = searchParams.get('level');
    const category = searchParams.get('category');
    const pair = searchParams.get('pair');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: Record<string, unknown> = {};
    if (level) where.level = level;
    if (category) where.category = category;
    if (pair) where.pair = pair;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      db.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.activityLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Logs GET] Error:', error);
    // Auto-log error (best effort)
    try {
      await db.activityLog.create({
        data: {
          level: 'error',
          category: 'system',
          message: `Failed to fetch logs: ${error instanceof Error ? error.message : 'Unknown'}`,
        },
      });
    } catch {
      // Ignore - can't log if logging is broken
    }
    return NextResponse.json(
      { error: 'Failed to fetch logs', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// POST - Create a new log entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { level, category, message, pair, details, metadata } = body as {
      level?: 'info' | 'warn' | 'error' | 'debug';
      category?: string;
      message: string;
      pair?: string;
      details?: string;
      metadata?: Record<string, unknown>;
    };

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const validLevels = ['info', 'warn', 'error', 'debug'];
    const validCategories = ['trading', 'analysis', 'alert', 'system', 'api'];

    const log = await db.activityLog.create({
      data: {
        level: validLevels.includes(level || '') ? level! : 'info',
        category: validCategories.includes(category || '') ? category! : 'general',
        message,
        pair: pair || null,
        details: details || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    console.error('[Logs POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create log', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// DELETE - Clear old logs
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const beforeDate = searchParams.get('beforeDate');
    const keepLast = parseInt(searchParams.get('keepLast') || '0', 10);
    const clearAll = searchParams.get('all') === 'true';

    if (clearAll) {
      const count = await db.activityLog.count();
      await db.activityLog.deleteMany({});
      return NextResponse.json({ success: true, deletedCount: count });
    }

    if (beforeDate) {
      const date = new Date(beforeDate);
      if (isNaN(date.getTime())) {
        return NextResponse.json({ error: 'Invalid beforeDate format' }, { status: 400 });
      }
      const { count } = await db.activityLog.deleteMany({
        where: { createdAt: { lt: date } },
      });
      return NextResponse.json({ success: true, deletedCount: count });
    }

    if (keepLast > 0) {
      const total = await db.activityLog.count({
        orderBy: { createdAt: 'desc' },
      });
      if (total <= keepLast) {
        return NextResponse.json({ success: true, deletedCount: 0, message: `Only ${total} logs exist, keeping all` });
      }

      // Find the timestamp of the keepLast-th log
      const keepLogs = await db.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: keepLast,
        select: { id: true },
      });
      const keepIds = keepLogs.map((l) => l.id);
      const oldestKeep = await db.activityLog.findUnique({
        where: { id: keepIds[keepIds.length - 1]! },
        select: { createdAt: true },
      });

      if (oldestKeep) {
        const { count } = await db.activityLog.deleteMany({
          where: { createdAt: { lt: oldestKeep.createdAt } },
        });
        return NextResponse.json({ success: true, deletedCount: count });
      }
    }

    return NextResponse.json(
      { error: 'Specify beforeDate, keepLast, or all=true query parameter' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Logs DELETE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete logs', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
