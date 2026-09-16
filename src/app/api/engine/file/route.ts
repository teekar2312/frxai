import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const ENGINE_ROOT = path.join(process.cwd(), 'python-engine')

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rel = searchParams.get('path') ?? ''
  // Prevent path traversal: resolve and verify the result stays INSIDE the
  // engine root (relative check — robust against sibling-dir prefix tricks
  // like "../python-engine-x/secret.txt" passing a naive startsWith test).
  const abs = path.resolve(ENGINE_ROOT, rel)
  const relFromRoot = path.relative(ENGINE_ROOT, abs)
  const isInside = relFromRoot !== '' && !relFromRoot.startsWith('..') && !path.isAbsolute(relFromRoot)
  if (!isInside) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }
  try {
    const content = await readFile(abs, 'utf-8')
    return NextResponse.json({ path: rel, content })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
