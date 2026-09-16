#!/usr/bin/env node
/**
 * start.mjs — Production runner LINTAS PLATFORM (Windows PowerShell/cmd,
 * Linux, macOS).
 *
 * Menggantikan script lama `NODE_ENV=production bun .next/standalone/server.js
 * 2>&1 | tee server.log` yang gagal di Windows karena syntax `VAR=value`
 * (khusus bash) dan `tee` tidak tersedia. Wrapper ini:
 *   1. Set NODE_ENV=production lewat env spawn (bukan prefix shell).
 *   2. Jalankan server standalone Next.js (.next/standalone/server.js)
 *      memakai runtime yang sama dengan pemanggil (node via npm / bun).
 *   3. Meneruskan output ke stdout DAN file server.log (perilaku tee).
 *
 * Port mengikuti env PORT (default 3000 — sama seperti server standalone).
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const SERVER = resolve(process.cwd(), '.next', 'standalone', 'server.js')
const LOG_FILE = resolve(process.cwd(), 'server.log')

if (!existsSync(SERVER)) {
  console.error(
    '[start] .next/standalone/server.js tidak ditemukan.\n' +
      '        Jalankan build produksi dulu:  bun run build   (atau npm run build)'
  )
  process.exit(1)
}

const log = createWriteStream(LOG_FILE, { flags: 'w' })
const port = process.env.PORT ?? '3000'

console.log(`[start] ${SERVER} — port ${port} (NODE_ENV=production), log: server.log`)

const child = spawn(process.execPath, [SERVER], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production' },
})

const pipe = (stream) => {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    process.stdout.write(chunk)
    log.write(chunk)
  })
}
pipe(child.stdout)
pipe(child.stderr)

/** Matikan pohon proses anak secara andal (Windows butuh taskkill /T). */
function killTree() {
  if (!child.pid || child.killed) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: true,
    })
  } else {
    child.kill('SIGTERM')
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(sig, () => {
    killTree()
    process.exit(0)
  })
}

child.on('error', (err) => {
  console.error('[start] Gagal menjalankan server:', err.message)
  log.end()
  process.exit(1)
})

child.on('exit', (code) => {
  log.end()
  process.exit(code ?? 0)
})
