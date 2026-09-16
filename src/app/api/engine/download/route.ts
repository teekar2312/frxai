import JSZip from 'jszip'
import { readdir, readFile } from 'fs/promises'
import path from 'path'

const ENGINE_ROOT = path.join(process.cwd(), 'python-engine')

async function addDir(zip: JSZip, dir: string, rel = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    // Skip dotfiles, caches, and the runtime `data/` state folder (alerts.json etc.
    // are machine-local artifacts, not part of the distributable engine).
    if (e.name.startsWith('.') || e.name === '__pycache__' || e.name === 'node_modules' || e.name === 'data') continue
    const relPath = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      await addDir(zip, path.join(dir, e.name), relPath)
    } else {
      zip.file(`finex-ai-engine/${relPath}`, await readFile(path.join(dir, e.name)))
    }
  }
}

export async function GET() {
  try {
    const zip = new JSZip()
    await addDir(zip, ENGINE_ROOT)
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="finex-ai-engine.zip"',
        'Content-Length': String(buf.length),
      },
    })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed to zip' }, { status: 500 })
  }
}
