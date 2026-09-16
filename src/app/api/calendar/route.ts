// ============================================================
// FINEX AI TRADING SYSTEM — ECONOMIC CALENDAR API
// GET /api/calendar → CalendarEvent[]
//
// Today's economic calendar generated deterministically: the RNG is
// seeded with the UTC date string (hashSeed → mulberry32), so the
// event list is stable for the whole day. Only the countdown
// (minutesUntil) and the "actual" of already-released events change
// as real time passes. The RNG stream is consumed identically on
// every call so values never shift within the day.
// ============================================================

import { NextResponse } from 'next/server'
import { gauss, hashSeed, mulberry32 } from '@/lib/engine/rng'
import type { CalendarEvent, NewsImpact } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface CalTemplate {
  title: string
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'CHF' | 'NZD'
  impact: NewsImpact // NFP / CPI / Central Bank → HIGH
  base: number // typical value
  unit: 'K' | '%' | ''
  dec: number
  spread: number // typical deviation around the base
}

const CALENDAR_POOL: CalTemplate[] = [
  // Employment / inflation — HIGH impact
  { title: 'Non-Farm Payrolls', currency: 'USD', impact: 'HIGH', base: 205, unit: 'K', dec: 0, spread: 70 },
  { title: 'CPI y/y', currency: 'USD', impact: 'HIGH', base: 3.2, unit: '%', dec: 1, spread: 0.3 },
  { title: 'CPI y/y', currency: 'EUR', impact: 'HIGH', base: 2.5, unit: '%', dec: 1, spread: 0.3 },
  { title: 'CPI y/y', currency: 'GBP', impact: 'HIGH', base: 3.7, unit: '%', dec: 1, spread: 0.3 },
  { title: 'Core CPI m/m', currency: 'USD', impact: 'HIGH', base: 0.3, unit: '%', dec: 1, spread: 0.12 },
  // Central bank rate decisions — HIGH impact
  { title: 'Fed Interest Rate Decision', currency: 'USD', impact: 'HIGH', base: 5.25, unit: '%', dec: 2, spread: 0.25 },
  { title: 'ECB Rate Decision', currency: 'EUR', impact: 'HIGH', base: 4.0, unit: '%', dec: 2, spread: 0.25 },
  { title: 'BOE Bank Rate Decision', currency: 'GBP', impact: 'HIGH', base: 5.25, unit: '%', dec: 2, spread: 0.25 },
  { title: 'BOJ Policy Rate Decision', currency: 'JPY', impact: 'HIGH', base: 0.25, unit: '%', dec: 2, spread: 0.15 },
  { title: 'RBA Cash Rate Decision', currency: 'AUD', impact: 'HIGH', base: 4.35, unit: '%', dec: 2, spread: 0.25 },
  { title: 'BoC Overnight Rate Decision', currency: 'CAD', impact: 'HIGH', base: 5.0, unit: '%', dec: 2, spread: 0.25 },
  { title: 'SNB Policy Rate Decision', currency: 'CHF', impact: 'HIGH', base: 1.5, unit: '%', dec: 2, spread: 0.25 },
  { title: 'RBNZ Official Cash Rate', currency: 'NZD', impact: 'HIGH', base: 5.5, unit: '%', dec: 2, spread: 0.25 },
  { title: 'CPI y/y', currency: 'CAD', impact: 'HIGH', base: 2.9, unit: '%', dec: 1, spread: 0.3 },
  { title: 'CPI y/y', currency: 'AUD', impact: 'HIGH', base: 3.5, unit: '%', dec: 1, spread: 0.3 },
  // Growth / prices / activity — MEDIUM impact
  { title: 'PPI m/m', currency: 'USD', impact: 'MEDIUM', base: 0.2, unit: '%', dec: 1, spread: 0.25 },
  { title: 'PPI m/m', currency: 'EUR', impact: 'MEDIUM', base: -0.1, unit: '%', dec: 1, spread: 0.25 },
  { title: 'GDP q/q', currency: 'USD', impact: 'MEDIUM', base: 0.4, unit: '%', dec: 1, spread: 0.25 },
  { title: 'GDP q/q', currency: 'EUR', impact: 'MEDIUM', base: 0.2, unit: '%', dec: 1, spread: 0.2 },
  { title: 'GDP q/q', currency: 'JPY', impact: 'MEDIUM', base: 0.3, unit: '%', dec: 1, spread: 0.3 },
  { title: 'Unemployment Rate', currency: 'USD', impact: 'MEDIUM', base: 3.9, unit: '%', dec: 1, spread: 0.15 },
  { title: 'Unemployment Rate', currency: 'EUR', impact: 'MEDIUM', base: 6.4, unit: '%', dec: 1, spread: 0.15 },
  { title: 'Unemployment Rate', currency: 'GBP', impact: 'MEDIUM', base: 4.3, unit: '%', dec: 1, spread: 0.15 },
  { title: 'Unemployment Rate', currency: 'JPY', impact: 'MEDIUM', base: 2.5, unit: '%', dec: 1, spread: 0.1 },
  { title: 'Retail Sales m/m', currency: 'USD', impact: 'MEDIUM', base: 0.4, unit: '%', dec: 1, spread: 0.4 },
  { title: 'Retail Sales m/m', currency: 'GBP', impact: 'MEDIUM', base: 0.2, unit: '%', dec: 1, spread: 0.4 },
  { title: 'Manufacturing PMI', currency: 'USD', impact: 'MEDIUM', base: 49.2, unit: '', dec: 1, spread: 1.2 },
  { title: 'Manufacturing PMI', currency: 'EUR', impact: 'MEDIUM', base: 46.5, unit: '', dec: 1, spread: 1.0 },
  { title: 'Manufacturing PMI', currency: 'JPY', impact: 'MEDIUM', base: 48.8, unit: '', dec: 1, spread: 1.0 },
  { title: 'Services PMI', currency: 'USD', impact: 'MEDIUM', base: 52.5, unit: '', dec: 1, spread: 1.2 },
  { title: 'Services PMI', currency: 'EUR', impact: 'MEDIUM', base: 48.9, unit: '', dec: 1, spread: 1.0 },
  { title: 'Services PMI', currency: 'GBP', impact: 'MEDIUM', base: 50.8, unit: '', dec: 1, spread: 1.0 },
  // AUD / CAD / CHF / NZD activity data — covers the remaining quote currencies
  { title: 'Employment Change', currency: 'AUD', impact: 'MEDIUM', base: 15, unit: 'K', dec: 0, spread: 20 },
  { title: 'Employment Change', currency: 'CAD', impact: 'MEDIUM', base: 25, unit: 'K', dec: 0, spread: 30 },
  { title: 'Retail Sales m/m', currency: 'AUD', impact: 'MEDIUM', base: 0.3, unit: '%', dec: 1, spread: 0.4 },
  { title: 'Retail Sales m/m', currency: 'CAD', impact: 'MEDIUM', base: 0.2, unit: '%', dec: 1, spread: 0.4 },
  { title: 'GDP q/q', currency: 'CHF', impact: 'MEDIUM', base: 0.2, unit: '%', dec: 1, spread: 0.2 },
  { title: 'Trade Balance', currency: 'NZD', impact: 'MEDIUM', base: 120, unit: 'K', dec: 0, spread: 250 },
  { title: 'Unemployment Rate', currency: 'AUD', impact: 'MEDIUM', base: 4.1, unit: '%', dec: 1, spread: 0.15 },
  { title: 'Manufacturing PMI', currency: 'CHF', impact: 'MEDIUM', base: 47.5, unit: '', dec: 1, spread: 1.0 },
]

function fmtValue(v: number, t: CalTemplate): string {
  if (t.unit === 'K') return `${Math.round(v)}K`
  return `${v.toFixed(t.dec)}${t.unit}`
}

/** GET /api/calendar → today's deterministic economic calendar (CalendarEvent[]) */
export async function GET() {
  try {
    const now = Date.now()
    const d = new Date(now)
    const dateStr = d.toISOString().slice(0, 10) // UTC date key — stable within the day
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    const rng = mulberry32(hashSeed(dateStr))

    const count = Math.min(8 + Math.floor(rng() * 7), CALENDAR_POOL.length) // 8..14 events
    // Deterministic partial Fisher-Yates → `count` distinct events
    const idx = CALENDAR_POOL.map((_, i) => i)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const tmp = idx[i]
      idx[i] = idx[j]
      idx[j] = tmp
    }
    const slotLen = 1080 / count // spread across 02:00..20:00 UTC

    const events: CalendarEvent[] = idx.slice(0, count).map((pi, i) => {
      const t = CALENDAR_POOL[pi]
      const minute = Math.round(120 + i * slotLen + rng() * slotLen)
      const time = dayStart + minute * 60000
      const forecast = t.base + (rng() - 0.5) * t.spread * 2
      const previous = forecast + (rng() - 0.5) * t.spread * 1.6
      // The deviation is ALWAYS drawn (keeps the rng stream identical on every
      // call); it is only revealed for events that already took place.
      const actualDev = gauss(rng) * t.spread * 0.5
      return {
        id: '',
        title: t.title,
        currency: t.currency,
        impact: t.impact,
        time: new Date(time).toISOString(),
        minutesUntil: Math.round((time - now) / 60000), // negative = already released
        actual: time <= now ? fmtValue(forecast + actualDev, t) : null,
        forecast: fmtValue(forecast, t),
        previous: fmtValue(previous, t),
      }
    })

    events.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    const out = events.map((e, i) => ({ ...e, id: `cal-${dateStr}-${String(i + 1).padStart(2, '0')}` }))
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Kalender ekonomi gagal digenerate' }, { status: 500 })
  }
}
