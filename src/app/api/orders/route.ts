import { NextRequest, NextResponse } from 'next/server'
import { getSimulator } from '@/lib/engine/simulator'
import type { OrderRequest } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders — trading actions.
 * body OrderRequest:
 *  - { action: 'open', pair, side, volume? | riskBased?, stopLossPips?, takeProfitPips? }
 *  - { action: 'close', positionId }
 *  - { action: 'closeAll' }
 *  - { action: 'modify', positionId, stopLoss?, takeProfit?, trailing? }
 * Returns the updated PositionView (open/modify) or { success: true, closed: n }.
 */
export async function POST(req: NextRequest) {
  const sim = getSimulator()
  try {
    const body = (await req.json()) as OrderRequest
    switch (body.action) {
      case 'open': {
        if (!body.pair) return NextResponse.json({ error: 'pair wajib diisi' }, { status: 400 })
        if (body.side !== 'BUY' && body.side !== 'SELL') return NextResponse.json({ error: 'side harus BUY atau SELL' }, { status: 400 })
        const row = await sim.placeOrder({
          pair: body.pair,
          side: body.side,
          volume: body.volume,
          riskBased: body.riskBased,
          stopLossPips: body.stopLossPips,
          takeProfitPips: body.takeProfitPips,
          source: body.source ?? 'MANUAL',
          comment: body.comment,
        })
        const view = (await sim.getPositions()).find((p) => p.id === row.id)
        return NextResponse.json(view ?? { success: true })
      }
      case 'close': {
        if (!body.positionId) return NextResponse.json({ error: 'positionId wajib diisi' }, { status: 400 })
        await sim.closePosition(body.positionId, 'MANUAL')
        return NextResponse.json({ success: true, closed: 1 })
      }
      case 'closeAll': {
        const n = await sim.closeAll('MANUAL')
        return NextResponse.json({ success: true, closed: n })
      }
      case 'modify': {
        if (!body.positionId) return NextResponse.json({ error: 'positionId wajib diisi' }, { status: 400 })
        await sim.modifyPosition(body.positionId, {
          stopLoss: body.stopLoss,
          takeProfit: body.takeProfit,
          trailing: body.trailing,
        })
        const view = (await sim.getPositions()).find((p) => p.id === body.positionId)
        return NextResponse.json(view ?? { success: true })
      }
      default:
        return NextResponse.json({ error: `action tidak dikenal: ${String(body.action)}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Order gagal' }, { status: 400 })
  }
}
