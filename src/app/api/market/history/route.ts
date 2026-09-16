import { NextRequest, NextResponse } from 'next/server'
import { getSimulator } from '@/lib/engine/simulator'
import { PAIR_IDS, TIMEFRAME_IDS } from '@/lib/constants'

export const dynamic = 'force-dynamic'

/** GET /api/market/history?pair=EURUSD&tf=M15&limit=200 → Candle[] (oldest → newest) */
export async function GET(req: NextRequest) {
  const sim = getSimulator()
  const sp = req.nextUrl.searchParams
  const pair = sp.get('pair') ?? 'EURUSD'
  const tf = sp.get('tf') ?? 'M15'
  const limitRaw = Number.parseInt(sp.get('limit') ?? '200', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200

  if (!PAIR_IDS.includes(pair as (typeof PAIR_IDS)[number])) {
    return NextResponse.json({ error: `Pair tidak dikenal: ${pair}` }, { status: 400 })
  }
  if (!TIMEFRAME_IDS.includes(tf as (typeof TIMEFRAME_IDS)[number])) {
    return NextResponse.json({ error: `Timeframe tidak dikenal: ${tf}` }, { status: 400 })
  }

  const candles = sim.getCandles(pair, tf, limit)
  return NextResponse.json(candles)
}
