#!/usr/bin/env node
// ============================================================
// FINEX AI TRADING SYSTEM — Generator hash password admin (scrypt)
//
// Menghasilkan hash password dalam format:
//   scrypt:16384:8:1:<saltB64url>:<hashB64url>
//
// Pemakaian:
//   node scripts/hash-password.mjs <password>
//   bun run hash-password <password>   (alias di package.json)
//
// Lalu tempel baris hasilnya ke file .env sebagai
// ADMIN_PASSWORD_HASH (satu baris utuh).
// ============================================================

import crypto from 'node:crypto'

const password = process.argv[2]

if (!password) {
  console.error('Usage: node scripts/hash-password.mjs <password>')
  process.exit(1)
}

if (password.length < 8) {
  console.error('Error: Password minimal 8 karakter.')
  process.exit(1)
}

// Parameter scrypt harus IDENTIK dengan yang dipakai server saat verifikasi login
const N = 16384
const r = 8
const p = 1
const KEYLEN = 64

const salt = crypto.randomBytes(16)
const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r, p })

const saltB64url = salt.toString('base64url')
const hashB64url = hash.toString('base64url')

console.log(`scrypt:${N}:${r}:${p}:${saltB64url}:${hashB64url}`)
console.log('')
console.log('Simpan baris di atas (utuh, satu baris) di file .env sebagai:')
console.log('  ADMIN_PASSWORD_HASH=scrypt:16384:8:1:...')
console.log('')
console.log('Penting:')
console.log('  - Kosongkan / hapus ADMIN_PASSWORD agar hash yang dipakai.')
console.log('  - Setelah mengubah .env, restart aplikasi (pm2 restart / docker compose restart).')
