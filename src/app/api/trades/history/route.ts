import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const VALID_SORT_FIELDS = ['closeTime', 'pnl', 'pnlPercent'] as const
const VALID_SORT_DIRS = ['asc', 'desc'] as const

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get('symbol')
    const strategy = searchParams.get('strategy')
    const outcome = searchParams.get('outcome') // all, win, loss
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20))
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')
    const sortField = searchParams.get('sort') || 'closeTime'
    const sortDir = searchParams.get('order') || 'desc'

    if (!VALID_SORT_FIELDS.includes(sortField as typeof VALID_SORT_FIELDS[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid sort field. Use: ${VALID_SORT_FIELDS.join(', ')}` },
        { status: 400 },
      )
    }
    if (!VALID_SORT_DIRS.includes(sortDir as typeof VALID_SORT_DIRS[number])) {
      return NextResponse.json(
        { success: false, error: 'Invalid sort direction. Use: asc, desc' },
        { status: 400 },
      )
    }

    // Build where clause
    const where: Record<string, unknown> = { status: 'CLOSED' }

    if (symbol) where.symbol = symbol
    if (strategy) where.strategy = strategy
    if (outcome === 'win') where.pnl = { gt: 0 }
    else if (outcome === 'loss') where.pnl = { lt: 0 }

    if (startDateStr || endDateStr) {
      const closeTimeFilter: Record<string, unknown> = {}
      if (startDateStr) {
        const d = new Date(startDateStr)
        if (!isNaN(d.getTime())) closeTimeFilter.gte = d
      }
      if (endDateStr) {
        const d = new Date(endDateStr)
        if (!isNaN(d.getTime())) closeTimeFilter.lte = d
      }
      if (Object.keys(closeTimeFilter).length > 0) {
        where.closeTime = closeTimeFilter
      }
    }

    const skip = (page - 1) * limit

    const [trades, total] = await Promise.all([
      db.trade.findMany({
        where,
        orderBy: { [sortField]: sortDir },
        skip,
        take: limit,
        select: {
          id: true,
          symbol: true,
          direction: true,
          lotSize: true,
          entryPrice: true,
          closePrice: true,
          pnl: true,
          pnlPercent: true,
          reason: true,
          strategy: true,
          timeframe: true,
          openTime: true,
          closeTime: true,
          commission: true,
          slippage: true,
        },
      }),
      db.trade.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: trades,
      total,
      page,
      limit,
    })
  } catch (error) {
    console.error('Trade history error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch trade history' },
      { status: 500 },
    )
  }
}
