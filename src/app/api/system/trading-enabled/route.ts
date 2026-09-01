import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const CONFIG_PATH = join(process.cwd(), 'data', 'trading-enabled.json')

function readState(): boolean {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      const parsed = JSON.parse(raw)
      return typeof parsed.enabled === 'boolean' ? parsed.enabled : false
    }
  } catch { /* ignore */ }
  return false
}

function writeState(enabled: boolean) {
  const dir = join(process.cwd(), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify({ enabled }), 'utf-8')
}

export async function GET() {
  return NextResponse.json({ success: true, data: { enabled: readState() } })
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : false
    writeState(enabled)
    return NextResponse.json({ success: true, data: { enabled } })
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to update' }, { status: 500 })
  }
}
