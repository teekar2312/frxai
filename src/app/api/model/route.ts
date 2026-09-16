import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { INDICATORS, getIndicatorConfig } from '@/lib/constants'
import type { ModelStatView } from '@/lib/types'

export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/model — self-learning memory (ModelStat table)
// Returns { stats: ModelStatView[], samples, accuracy }
// ============================================================

export async function GET() {
  try {
    const rows = await db.modelStat.findMany()

    // Join with INDICATORS for name/category; skip unknown ids
    const stats: ModelStatView[] = rows
      .filter((r) => INDICATORS.some((i) => i.id === r.indicator))
      .map((r) => {
        const cfg = getIndicatorConfig(r.indicator)
        return {
          indicator: r.indicator,
          name: cfg.name,
          category: cfg.category,
          weight: Math.round(r.weight * 1000) / 1000,
          wins: r.wins,
          losses: r.losses,
          samples: r.samples,
          winRate: Math.round((r.wins / Math.max(1, r.wins + r.losses)) * 1000) / 10,
        }
      })
      .sort((a, b) => b.weight - a.weight)

    const totalSamples = stats.reduce((s, x) => s + x.samples, 0)
    const totalWins = stats.reduce((s, x) => s + x.wins, 0)
    const accuracy = Math.round((totalWins / Math.max(1, totalSamples)) * 1000) / 10

    return NextResponse.json({ stats, samples: totalSamples, accuracy })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to load model stats' }, { status: 500 })
  }
}
