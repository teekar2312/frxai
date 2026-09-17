#!/usr/bin/env node
/**
 * dev.mjs — Dev runner LINTAS PLATFORM (Windows PowerShell/cmd, Linux, macOS).
 *
 * Menggantikan script lama `next dev -p 3000 2>&1 | tee dev.log` yang gagal
 * di Windows karena `tee` tidak tersedia. Wrapper ini:
 *   1. Menjalankan `next dev -p 3000` (runtime node via shebang .bin/next).
 *   2. Meneruskan seluruh output ke stdout DAN file dev.log (perilaku tee).
 *   3. SEBELUM boot: self-heal .env (scripts/lib/ensure-env.mjs) — pulihkan
 *      SESSION_SECRET dari backup db/.session-secret bila file terpotong
 *      oleh daemon sandbox (insiden berulang), lengkapi DATABASE_URL/
 *      ENGINE_MODE bila kosong. Idempotent; .env sehat tidak disentuh.
 *
 * Bisa dijalankan lewat npm / bun / pnpm — keduanya menaruh
 * node_modules/.bin di PATH sehingga `next` ter-resolve oleh shell.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { ensureEnv } from './lib/ensure-env.mjs'

const PORT = '3000'
const LOG_FILE = resolve(process.cwd(), 'dev.log')
const log = createWriteStream(LOG_FILE, { flags: 'w' })

try {
  const r = ensureEnv(process.cwd())
  if (r.envChanged || r.backupWritten) {
    const msg = `[ensure-env] .env dipulihkan: ${r.actions.join(' · ') || 'backup secret disegarkan'}`
    console.log(msg)
    log.write(msg + '\n')
  }
} catch (e) {
  const msg = `[ensure-env] non-fatal: ${e instanceof Error ? e.message : e}`
  console.warn(msg)
  log.write(msg + '\n')
}

console.log(`[dev] next dev -p ${PORT} — output juga disalin ke dev.log`)

const child = spawn(`next dev -p ${PORT}`, {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
  env: process.env,
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
  console.error('[dev] Gagal menjalankan next:', err.message)
  log.end()
  process.exit(1)
})

child.on('exit', (code) => {
  log.end()
  process.exit(code ?? 0)
})
