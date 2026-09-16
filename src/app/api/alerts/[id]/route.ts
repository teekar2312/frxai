import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSimulator } from '@/lib/engine/simulator'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** PATCH /api/alerts/[id] — body { status: 'CANCELLED' | 'ACTIVE' } (cancel / reactivate) */
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const sim = getSimulator()
  try {
    const { id } = await params
    const body = (await req.json()) as { status?: string }
    const status = body.status === 'CANCELLED' ? 'CANCELLED' : body.status === 'ACTIVE' ? 'ACTIVE' : null
    if (!status) return NextResponse.json({ error: 'status harus CANCELLED atau ACTIVE' }, { status: 400 })
    const existing = await db.priceAlert.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Alert tidak ditemukan' }, { status: 404 })
    const row = await db.priceAlert.update({
      where: { id },
      data: { status, triggeredAt: status === 'ACTIVE' ? null : existing.triggeredAt },
    })
    await sim.log('INFO', 'ALERT', `Alert ${status === 'CANCELLED' ? 'dibatalkan' : 'diaktifkan kembali'}: ${row.pair} ${row.condition} ${row.price}`)
    return NextResponse.json({
      id: row.id,
      pair: row.pair,
      condition: row.condition,
      price: row.price,
      status: row.status,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      triggeredAt: row.triggeredAt ? row.triggeredAt.toISOString() : null,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal update alert' }, { status: 400 })
  }
}

/** DELETE /api/alerts/[id] */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const sim = getSimulator()
  try {
    const { id } = await params
    const existing = await db.priceAlert.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Alert tidak ditemukan' }, { status: 404 })
    await db.priceAlert.delete({ where: { id } })
    await sim.log('INFO', 'ALERT', `Alert dihapus: ${existing.pair} ${existing.condition} ${existing.price}`)
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal hapus alert' }, { status: 400 })
  }
}
