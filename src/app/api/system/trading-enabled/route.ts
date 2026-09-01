import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const CONFIG_KEY = 'trading-enabled'

async function readState(): Promise<boolean> {
  try {
    const row = await db.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
    if (row) {
      const parsed = JSON.parse(row.value)
      return parsed.enabled === true
    }
  } catch { /* ignore */ }
  return false
}

async function writeState(enabled: boolean) {
  await db.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify({ enabled }) },
    update: { value: JSON.stringify({ enabled }) },
  })
}

export async function GET() {
  const enabled = await readState()
  return NextResponse.json({ success: true, data: { enabled } })
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : false
    await writeState(enabled)
    return NextResponse.json({ success: true, data: { enabled } })
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to update' }, { status: 500 })
  }
}
