import { NextRequest, NextResponse } from 'next/server'
import { getSimulator } from '@/lib/engine/simulator'

export const dynamic = 'force-dynamic'

/** GET /api/positions/history?limit=50 → ClosedTrade[] (newest first) */
export async function GET(req: NextRequest) {
  const sim = getSimulator()
  const limitRaw = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
  try {
    const trades = await sim.getClosedTrades(limit)
    return NextResponse.json(trades)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'engine error' }, { status: 500 })
  }
}
