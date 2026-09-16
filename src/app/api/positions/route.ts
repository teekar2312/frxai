import { NextResponse } from 'next/server'
import { getSimulator } from '@/lib/engine/simulator'

export const dynamic = 'force-dynamic'

/** GET /api/positions → PositionView[] (live profit, openedAt desc) */
export async function GET() {
  const sim = getSimulator()
  try {
    await sim.tick()
    const positions = await sim.getPositions()
    return NextResponse.json(positions)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'engine error' }, { status: 500 })
  }
}
