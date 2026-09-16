import { NextRequest, NextResponse } from 'next/server'
import { getSimulator } from '@/lib/engine/simulator'
import type { SettingsData } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sim = getSimulator()
  const settings = await sim.getSettings()
  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  const sim = getSimulator()
  try {
    const body = (await req.json()) as Partial<SettingsData>
    const arr = (v: unknown): string[] | null =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null

    // Validate selection arrays (min 1 each) — absent fields keep current values
    const cur = await sim.getSettings()
    const pairs = arr(body.pairs) ?? cur.pairs
    if (pairs.length < 1) return NextResponse.json({ error: 'Minimal 1 pair harus dipilih' }, { status: 400 })
    const sessions = arr(body.sessions) ?? cur.sessions
    if (sessions.length < 1) return NextResponse.json({ error: 'Minimal 1 sesi trading harus dipilih' }, { status: 400 })
    const timeframes = arr(body.timeframes) ?? cur.timeframes
    if (timeframes.length < 1) return NextResponse.json({ error: 'Minimal 1 timeframe harus dipilih' }, { status: 400 })
    const indicators = arr(body.indicators) ?? cur.indicators
    if (indicators.length < 1) return NextResponse.json({ error: 'Minimal 1 indikator harus dipilih' }, { status: 400 })

    // Merge over current settings (simulator normalizes + clamps everything else)
    const next: SettingsData = { ...cur, ...body } as SettingsData
    next.pairs = pairs as SettingsData['pairs']
    next.sessions = sessions as SettingsData['sessions']
    next.timeframes = timeframes as SettingsData['timeframes']
    next.indicators = indicators
    const emailEvents = arr(body.emailEvents)
    if (emailEvents !== null) next.emailEvents = emailEvents
    if (typeof body.engineUrl === 'string') next.engineUrl = body.engineUrl
    if (typeof body.emailTo === 'string') next.emailTo = body.emailTo

    await sim.saveSettings(next)
    await sim.log('INFO', 'SYSTEM', 'Settings updated', `pairs=${pairs.join(',')} · tf=${timeframes.join(',')} · risk=${next.riskPerTrade}% · mode=${next.tradingMode}`)
    return NextResponse.json(await sim.getSettings())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Gagal menyimpan settings' }, { status: 400 })
  }
}
