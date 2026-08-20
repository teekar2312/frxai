import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateAuth } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

function escapeCSV(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function positionsToCSV(positions: Array<Record<string, unknown>>): string {
  const headers = ['ID', 'Pair', 'Direction', 'Lot Size', 'Entry Price', 'Current Price', 'Stop Loss', 'Take Profit', 'PnL', 'PnL Pips', 'Status', 'Strategy', 'AI Confidence', 'Risk Level', 'Opened At', 'Closed At'];
  const rows = positions.map(p => [
    p.id, p.pair, p.direction, p.lotSize, p.entryPrice, p.currentPrice,
    p.stopLoss, p.takeProfit, p.pnl, p.pnlPips, p.status, p.strategy,
    p.aiConfidence, p.riskLevel, p.openedAt, p.closedAt,
  ].map(escapeCSV).join(','));
  return [headers.join(','), ...rows].join('\n');
}

// GET - Export data
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'positions';
    const format = searchParams.get('format') || 'json';
    const status = searchParams.get('status');

    if (!['positions', 'analytics'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type. Use: positions, analytics' }, { status: 400 });
    }

    if (!['csv', 'json'].includes(format)) {
      return NextResponse.json({ error: 'Invalid format. Use: csv, json' }, { status: 400 });
    }

    if (type === 'positions') {
      const where: Record<string, unknown> = {};
      if (status) {
        const validStatuses = ['open', 'closed', 'cancelled'];
        if (!validStatuses.includes(status)) {
          return NextResponse.json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` }, { status: 400 });
        }
        where.status = status;
      }

      const positions = await db.tradingPosition.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      const plainPositions = positions.map(p => ({
        id: p.id,
        pair: p.pair,
        direction: p.direction,
        lotSize: p.lotSize,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        pnl: p.pnl,
        pnlPips: p.pnlPips,
        status: p.status,
        strategy: p.strategy,
        aiConfidence: p.aiConfidence,
        riskLevel: p.riskLevel,
        openedAt: p.openedAt?.toISOString() || p.createdAt.toISOString(),
        closedAt: p.closedAt?.toISOString() || null,
      }));

      if (format === 'csv') {
        const csv = positionsToCSV(plainPositions);
        return new NextResponse(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="positions-export-${new Date().toISOString().slice(0, 10)}.csv"`,
          },
        });
      }

      return NextResponse.json({ positions: plainPositions });
    }

    // type === 'analytics'
    // Fetch trade analytics (reuse logic)
    const closedPositions = await db.tradingPosition.findMany({
      where: { status: 'closed' },
      orderBy: { closedAt: 'asc' },
    });

    const wins = closedPositions.filter(p => p.pnl > 0);
    const losses = closedPositions.filter(p => p.pnl < 0);
    const totalTrades = closedPositions.length;
    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
    const totalPnl = closedPositions.reduce((sum, p) => sum + p.pnl, 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum, p) => sum + p.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, p) => sum + p.pnl, 0) / losses.length) : 0;
    const totalWins = wins.reduce((sum, p) => sum + p.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

    const analytics = {
      totalTrades,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      generatedAt: new Date().toISOString(),
    };

    if (format === 'csv') {
      const headers = Object.keys(analytics);
      const values = Object.values(analytics).map(escapeCSV);
      const csv = [headers.join(','), values.join(',')].join('\n');
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="analytics-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return NextResponse.json(analytics);
  } catch (error) {
    logApiError('Export', error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
