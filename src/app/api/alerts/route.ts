import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSimulator } from '@/lib/engine/simulator'
import { PAIR_IDS } from '@/lib/constants'
import type { AlertView, Pair } from '@/lib/types'

export const dynamic = 'force-dynamic'

function toView(row: {
  id: string
  pair: string
  condition: string
  price: number
  status: string
  note: string | null
  createdAt: Date
  triggeredAt: Date | null
}): AlertView {
  return {
    id: row.id,
    pair: row.pair as Pair,
    condition: row.condition === 'BELOW' ? 'BELOW' : 'ABOVE',
    price: row.price,
    status: row.status === 'TRIGGERED' ? 'TRIGGERED' : row.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    triggeredAt: row.triggeredAt ? row.triggeredAt.toISOString() : null,
  }
}

/** GET /api/alerts → AlertView[] (newest first) */
export async function GET() {
  try {
    const rows = await db.priceAlert.findMany({ orderBy: { createdAt: 'desc' } })
    return NextResponse.json(rows.map(toView))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'engine error' }, { status: 500 })
  }
}

/** POST /api/alerts — create { pair, condition, price, note } */
export async function POST(req: NextRequest) {
  const sim = getSimulator()
  try {
    const body = (await req.json()) as { pair?: string; condition?: string; price?: number; note?: string }
    const pair = body.pair ?? ''
    if (!PAIR_IDS.includes(pair as (typeof PAIR_IDS)[number])) {
      return NextResponse.json({ error: 'Pair tidak valid' }, { status: 400 })
    }
    const condition = body.condition === 'BELOW' ? 'BELOW' : body.condition === 'ABOVE' ? 'ABOVE' : null
    if (!condition) return NextResponse.json({ error: 'Kondisi harus ABOVE atau BELOW' }, { status: 400 })
    const price = Number(body.price)
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: 'Harga alert harus > 0' }, { status: 400 })
    }
    const row = await db.priceAlert.create({
      data: {
        pair,
        condition,
        price,
        status: 'ACTIVE',
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
        mode: 'DEMO',
      },
    })
    await sim.log('INFO', 'ALERT', `Alert dibuat: ${pair} ${condition} ${price}`, body.note ?? undefined)
    return NextResponse.json(toView(row))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal membuat alert' }, { status: 400 })
  }
}
