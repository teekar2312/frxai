import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const ENGINE_ROOT = path.join(process.cwd(), 'python-engine')

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rel = searchParams.get('path') ?? ''
  // Prevent path traversal
  const abs = path.resolve(ENGINE_ROOT, rel)
  if (!abs.startsWith(ENGINE_ROOT)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }
  try {
    const content = await readFile(abs, 'utf-8')
    return NextResponse.json({ path: rel, content })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
