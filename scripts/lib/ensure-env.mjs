/**
 * ensure-env.mjs — Self-healing .env untuk dev runner (lintas platform).
 *
 * Latar belakang insiden BERULANG di sandbox: daemon snapshot sesekali
 * memotong/reset file `.env` hingga tinggal 1 baris (DATABASE_URL saja).
 * Akibat: SESSION_SECRET hilang → login 500 dan kredensial AI terenkripsi
 * tidak bisa dibaca (kunci AES diturunkan dari SESSION_SECRET).
 *
 * Mekanisme (dijalankan SEBELUM `next dev` boot, dari scripts/dev.mjs):
 *  1. DATABASE_URL / ENGINE_MODE dilengkapi bila kosong (nilai default aman).
 *  2. SESSION_SECRET:
 *     - valid di .env  → tulis-through ke backup `db/.session-secret`
 *     - hilang/pendek  → pulihkan dari backup `db/.session-secret`
 *     - backup kosong  → generate baru (openssl-equivalent) → tulis ke
 *                        .env + backup
 *   Folder `db/` dipilih sebagai lokasi backup karena di-restore sandbox
 *   SEKALIGUS (atomik) dengan file SQLite berisi ciphertext kredensial —
 *   sehingga pasangan (secret, ciphertext) selalu konsisten.
 *
 * File .env yang sudah sehat TIDAK disentuh (idempotent, mtime aman).
 * Seluruh baris lain (API key AI provider, ADMIN_*, dll.) dipertahankan
 * verbatim. Nilai secret TIDAK pernah di-print ke log.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const MIN_SECRET_LEN = 32
const DEFAULT_DATABASE_URL = 'file:../db/custom.db' // relatif terhadap prisma/schema.prisma
const DEFAULT_ENGINE_MODE = 'demo'

function parseEnvLine(line) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
  return m ? { key: m[1], value: m[2].trim() } : null
}

export function ensureEnv(cwd = process.cwd()) {
  const envPath = resolve(cwd, '.env')
  const dbDir = resolve(cwd, 'db')
  const secretPath = resolve(dbDir, '.session-secret')
  mkdirSync(dbDir, { recursive: true })

  const original = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const lines = original.split(/\r?\n/)

  const kv = new Map()
  for (const line of lines) {
    const parsed = parseEnvLine(line)
    if (parsed && !kv.has(parsed.key)) kv.set(parsed.key, parsed.value)
  }

  const actions = []

  // --- 1. Kunci non-rahasia: lengkapi bila kosong ---
  if (!kv.get('DATABASE_URL')) {
    kv.set('DATABASE_URL', DEFAULT_DATABASE_URL)
    actions.push('DATABASE_URL diisi default')
  }
  if (!kv.get('ENGINE_MODE')) {
    kv.set('ENGINE_MODE', DEFAULT_ENGINE_MODE)
    actions.push('ENGINE_MODE diisi default (demo)')
  }

  // --- 2. SESSION_SECRET: pulihkan dengan prioritas .env → backup → generate ---
  let secret = kv.get('SESSION_SECRET') ?? ''
  let secretSource = 'env'
  if (secret.length < MIN_SECRET_LEN) {
    const backup = existsSync(secretPath) ? readFileSync(secretPath, 'utf8').trim() : ''
    if (backup.length >= MIN_SECRET_LEN) {
      secret = backup
      secretSource = 'backup'
      actions.push('SESSION_SECRET dipulihkan dari db/.session-secret')
    } else {
      secret = randomBytes(48).toString('base64')
      secretSource = 'generated'
      actions.push('SESSION_SECRET dibuat baru + backup db/.session-secret')
    }
    kv.set('SESSION_SECRET', secret)
  }

  // --- 3. Write-through backup (jaga agar .env sehat menjadi anchor) ---
  const backupNow = existsSync(secretPath) ? readFileSync(secretPath, 'utf8').trim() : ''
  let backupWritten = false
  if (backupNow !== secret) {
    writeFileSync(secretPath, secret + '\n', { mode: 0o600 })
    try {
      chmodSync(secretPath, 0o600)
    } catch {
      /* Windows: chmod no-op, abaikan */
    }
    backupWritten = true
  }

  // --- 4. Tulis ulang .env hanya bila ada perubahan kunci yang dijaga ---
  const ensured = {
    DATABASE_URL: kv.get('DATABASE_URL'),
    ENGINE_MODE: kv.get('ENGINE_MODE'),
    SESSION_SECRET: kv.get('SESSION_SECRET'),
  }
  const rewritten = lines.map((line) => {
    const parsed = parseEnvLine(line)
    if (parsed && parsed.key in ensured) return `${parsed.key}=${ensured[parsed.key]}`
    return line
  })
  const seen = new Set(
    rewritten.map((l) => parseEnvLine(l)?.key).filter(Boolean),
  )
  for (const [key, value] of Object.entries(ensured)) {
    if (!seen.has(key)) rewritten.push(`${key}=${value}`)
  }
  const next = rewritten.join('\n')

  const envChanged = next !== original
  if (envChanged) writeFileSync(envPath, next)

  return {
    envChanged,
    backupWritten,
    secretSource, // 'env' | 'backup' | 'generated' — nilai secret TIDAK disertakan
    actions,
  }
}

// Bisa dijalankan langsung: node scripts/lib/ensure-env.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = ensureEnv()
  if (r.envChanged || r.backupWritten) {
    console.log(`[ensure-env] ${r.actions.join(' · ') || 'backup secret disegarkan'}`)
  } else {
    console.log('[ensure-env] .env sehat — tidak ada perubahan.')
  }
}
