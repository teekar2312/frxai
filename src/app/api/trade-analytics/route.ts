import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateAuth } from '@/lib/api-auth';
import { checkRateLimit, rateLimitedResponse, clientIp } from '@/lib/rate-limit';
import { logApiError } from '@/lib/safe-log';

// GET - Calculate comprehensive trade analytics
export async function GET(request: NextRequest) {
  const rateCheck = checkRateLimit(clientIp(request), 'general');
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);
  const auth = validateAuth(request);
  if (!auth.authorized) return auth.error!;

  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d';

    // Determine date filter based on period
    let dateFilter: Date | undefined;
    switch (period) {
      case '7d':
        dateFilter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        dateFilter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        dateFilter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        dateFilter = undefined;
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid period. Use: 7d, 30d, 90d, all' },
          { status: 400 }
        );
    }

    // Fetch closed positions within the period
    const positions = await db.tradingPosition.findMany({
      where: {
        status: 'closed',
        ...(dateFilter ? { closedAt: { gte: dateFilter } } : {}),
      },
      orderBy: { closedAt: 'asc' },
    });

    if (positions.length === 0) {
      return NextResponse.json({
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        bestPair: 'N/A',
        worstPair: 'N/A',
        pnlByPair: {},
        pnlByDay: [],
        pnlByHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, pnl: 0 })),
        winRateByPair: {},
        equityCurve: [],
      });
    }

    // Basic metrics
    const wins = positions.filter(p => p.pnl > 0);
    const losses = positions.filter(p => p.pnl < 0);
    const totalTrades = positions.length;
    const winRate = (wins.length / totalTrades) * 100;
    const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum, p) => sum + p.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, p) => sum + p.pnl, 0) / losses.length) : 0;
    const totalWins = wins.reduce((sum, p) => sum + p.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // PnL by pair
    const pnlByPair: Record<string, number> = {};
    for (const p of positions) {
      pnlByPair[p.pair] = (pnlByPair[p.pair] || 0) + p.pnl;
    }

    // Best and worst pairs
    const pairEntries = Object.entries(pnlByPair).sort((a, b) => b[1] - a[1]);
    const bestPair = pairEntries.length > 0 ? pairEntries[0][0] : 'N/A';
    const worstPair = pairEntries.length > 0 ? pairEntries[pairEntries.length - 1][0] : 'N/A';

    // Win rate by pair
    const tradesByPair: Record<string, { wins: number; total: number }> = {};
    for (const p of positions) {
      if (!tradesByPair[p.pair]) tradesByPair[p.pair] = { wins: 0, total: 0 };
      tradesByPair[p.pair].total++;
      if (p.pnl > 0) tradesByPair[p.pair].wins++;
    }
    const winRateByPair: Record<string, number> = {};
    for (const [pair, data] of Object.entries(tradesByPair)) {
      winRateByPair[pair] = (data.wins / data.total) * 100;
    }

    // PnL by day (last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const pnlByDayMap: Record<string, number> = {};
    for (const p of positions) {
      if (p.closedAt && p.closedAt >= thirtyDaysAgo) {
        const dateKey = p.closedAt.toISOString().slice(0, 10);
        pnlByDayMap[dateKey] = (pnlByDayMap[dateKey] || 0) + p.pnl;
      }
    }
    const pnlByDay = Object.entries(pnlByDayMap)
      .map(([date, pnl]) => ({ date, pnl }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // PnL by hour
    const pnlByHourMap: Record<number, number> = {};
    for (let h = 0; h < 24; h++) pnlByHourMap[h] = 0;
    for (const p of positions) {
      if (p.closedAt) {
        const hour = p.closedAt.getHours();
        pnlByHourMap[hour] = (pnlByHourMap[hour] || 0) + p.pnl;
      }
    }
    const pnlByHour = Object.entries(pnlByHourMap)
      .map(([hour, pnl]) => ({ hour: Number(hour), pnl }))
      .sort((a, b) => a.hour - b.hour);

    // Equity curve (cumulative PnL as equity over time)
    let cumulativePnl = 0;
    const equityCurve = positions.map(p => {
      cumulativePnl += p.pnl;
      return {
        date: p.closedAt?.toISOString() || p.createdAt.toISOString(),
        equity: cumulativePnl,
      };
    });

    // Max drawdown from equity curve
    let maxDrawdown = 0;
    let peak = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const drawdown = peak - point.equity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Sharpe ratio approximation (annualized)
    // Using daily returns from equity curve points
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      const curr = equityCurve[i].equity;
      if (prev !== 0) {
        dailyReturns.push((curr - prev) / Math.abs(prev));
      }
    }

    let sharpeRatio = 0;
    if (dailyReturns.length > 1) {
      const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
    }

    return NextResponse.json({
      totalTrades,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      bestPair,
      worstPair,
      pnlByPair,
      pnlByDay,
      pnlByHour,
      winRateByPair,
      equityCurve,
    });
  } catch (error) {
    logApiError('TradeAnalytics', error);
    return NextResponse.json({ error: 'Failed to compute trade analytics' }, { status: 500 });
  }
}
