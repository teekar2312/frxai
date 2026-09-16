#!/usr/bin/env node
/**
 * build.mjs — Build produksi LINTAS PLATFORM (Windows cmd/PowerShell, Linux, macOS).
 *
 * Menggantikan script lama `next build && cp -r ...` yang gagal di Windows
 * karena `cp` hanya ada di sistem Unix. Wrapper ini:
 *   1. Menjalankan `next build` (output standalone sesuai next.config.ts).
 *   2. Menyalin .next/static  → .next/standalone/.next/static
 *      dan        public/     → .next/standalone/public
 *      memakai fs.cpSync Node (berfungsi di semua platform).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const standalone = resolve(root, '.next', 'standalone')

console.log('[build] next build (output: standalone) ...')

const res = spawnSync('next build', {
  stdio: 'inherit',
  shell: true,
  env: process.env,
})

if (res.status !== 0) {
  console.error(`[build] GAGAL dengan exit code ${res.status ?? 1}`)
  process.exit(res.status ?? 1)
}

if (!existsSync(standalone)) {
  console.error('[build] .next/standalone tidak ditemukan — pastikan next.config.ts memuat output: "standalone"')
  process.exit(1)
}

// Salin deterministic: hapus dest dulu bila tersisa dari build sebelumnya,
// lalu cpSync membuat dest sebagai salinan persis src (tanpa nesting folder).
function copyInto(src, dst) {
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true })
  console.log(`[build] ✓ ${rel(src)} → ${rel(dst)}`)
}

// static assets → .next/standalone/.next/static
copyInto(resolve(root, '.next', 'static'), resolve(standalone, '.next', 'static'))

// public/ → .next/standalone/public (opsional — hanya bila ada)
if (existsSync(resolve(root, 'public'))) {
  copyInto(resolve(root, 'public'), resolve(standalone, 'public'))
}

console.log('[build] Selesai. Jalankan produksi via:  npm run start   (atau bun run start)')

function rel(p) {
  return p.startsWith(root) ? p.slice(root.length + 1) : p
}
