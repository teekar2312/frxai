import { NextResponse } from 'next/server'
import { seedProviderConfigs } from '@/lib/ai-providers'

/**
 * POST /api/ai/providers/seed — Seed default provider configs
 */
export async function POST() {
  try {
    await seedProviderConfigs()
    return NextResponse.json({ success: true, message: 'Provider configs seeded' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
