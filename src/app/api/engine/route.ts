import { NextResponse } from 'next/server'
import { getSimulator } from '@/lib/engine/simulator'
import { maybeAutoSyncAiKeys } from '@/lib/engine-sync'
import type { EnginePollResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Main poll endpoint (called by the header every 2s).
 * Drives the demo simulator tick and returns the full poll payload.
 * In LIVE mode, proxies to the Python engine; falls back to demo data
 * (with connected=false) when the engine is unreachable.
 */
export async function GET() {
  const sim = getSimulator()
  try {
    await sim.tick()
    const settings = await sim.getSettings()

    if (settings.engineMode === 'live') {
      try {
        const base = settings.engineUrl.trim().replace(/\/+$/, '')
        // Engine key for the Python engine's X-Engine-Key auth guard
        // (must match ENGINE_API_KEY in the engine's .env / api.api_key in config.yaml).
        const engineKey = process.env.ENGINE_API_KEY?.trim() ?? ''
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 2500)
        const res = await fetch(`${base}/api/v1/poll`, {
          signal: ctrl.signal,
          cache: 'no-store',
          headers: engineKey ? { 'X-Engine-Key': engineKey } : {},
        })
        clearTimeout(timer)
        if (res.ok) {
          const json = (await res.json()) as EnginePollResponse
          // Engine LIVE terjangkau → jadwalkan resync kunci AI (rate-limited
          // 1x/5 menit, fire-and-forget) agar override pulih setelah restart engine.
          maybeAutoSyncAiKeys()
          return NextResponse.json(json)
        }
      } catch {
        // engine unreachable → fall back to demo data below
      }
    }

    const status = settings.engineMode === 'live' ? { ...sim.getStatus(), connected: false } : sim.getStatus()
    const account = await sim.getAccount()
    const prices = sim.getPrices()
    const openPositions = (await sim.getPositions()).length
    const payload: EnginePollResponse = {
      status,
      account,
      prices,
      openPositions,
      dailyPnlPct: account.dailyPnlPct,
    }
    return NextResponse.json(payload)
  } catch (e) {
    // last-resort fallback so the dashboard never breaks
    const status = sim.getStatus()
    return NextResponse.json({
      status: { ...status, connected: false },
      account: {
        balance: 0,
        equity: 0,
        margin: 0,
        freeMargin: 0,
        marginLevel: 0,
        floatingPnl: 0,
        dailyPnl: 0,
        dailyPnlPct: 0,
        dailyStartBalance: 0,
        dailyTargetPct: 0,
        dailyLimitPct: 0,
        currency: 'USD',
        leverage: 500,
        server: 'FINEX Indonesia',
        login: 'FINEX-DEMO-10001',
        mode: 'DEMO',
      },
      prices: sim.getPrices(),
      openPositions: 0,
      dailyPnlPct: 0,
      error: e instanceof Error ? e.message : 'engine error',
    } satisfies EnginePollResponse & { error: string })
  }
}
