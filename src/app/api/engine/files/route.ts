import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import path from 'path'

const ENGINE_ROOT = path.join(process.cwd(), 'python-engine')

interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

async function walk(dir: string, rel = ''): Promise<FileNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === '__pycache__' || e.name === 'node_modules') continue
    const relPath = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      nodes.push({
        name: e.name,
        path: relPath,
        type: 'dir',
        children: await walk(path.join(dir, e.name), relPath),
      })
    } else {
      const s = await stat(path.join(dir, e.name))
      nodes.push({ name: e.name, path: relPath, type: 'file', size: s.size })
    }
  }
  // dirs first, then files alphabetically
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return nodes
}

export async function GET() {
  try {
    const tree = await walk(ENGINE_ROOT)
    return NextResponse.json({ root: 'python-engine', tree })
  } catch {
    return NextResponse.json({ root: 'python-engine', tree: [] })
  }
}
