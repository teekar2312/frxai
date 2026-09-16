/**
 * crypto.ts — Enkripsi at-rest untuk kredensial AI provider (server-only).
 *
 * Skema: AES-256-GCM.
 *  - Kunci master diturunkan dari env SESSION_SECRET (sumber yang sama dengan
 *    tanda tangan session JWT) via scrypt — sehingga rotasi SESSION_SECRET
 *    juga meng-invalidate kredensial lama (by design, dokumentasikan).
 *  - Format tersimpan: `v1:<ivB64url>:<tagB64url>:<ctB64url>`
 *
 * Mengapa GCM: authenticated encryption — tamper pada kolom DB langsung
 * terdeteksi saat decrypt (tag mismatch), bukan diam-diam menghasilkan key salah.
 */

import 'server-only'
import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'
const SALT = 'finex-ai-provider-keys-v1' // stabil; jangan diubah setelah ada data
const KEYLEN = 32

let cachedKey: Buffer | null = null

/** Turunkan kunci 32-byte dari SESSION_SECRET (cache per-proses). */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey
  const secret = process.env.SESSION_SECRET ?? ''
  if (secret.length < 32) {
    throw new Error(
      'SESSION_SECRET belum diatur (min. 32 karakter) — diperlukan untuk enkripsi kredensial AI provider. ' +
        'Generate: openssl rand -base64 48',
    )
  }
  cachedKey = crypto.scryptSync(secret, SALT, KEYLEN, { N: 16384, r: 8, p: 1 })
  return cachedKey
}

/** Enkripsi plaintext → string `v1:iv:tag:ct` (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`
}

/**
 * Dekripsi string `v1:iv:tag:ct` → plaintext.
 * Return null bila format tidak dikenal / tag mismatch (data rusak/di-tamper).
 */
export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null
  const parts = encoded.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  try {
    const iv = Buffer.from(parts[1], 'base64url')
    const tag = Buffer.from(parts[2], 'base64url')
    const ct = Buffer.from(parts[3], 'base64url')
    const decipher = crypto.createDecipheriv(ALGO, masterKey(), iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString('utf8')
  } catch {
    return null
  }
}

/** Mask kunci untuk ditampilkan: `sk-…abc4` (tidak pernah kirim utuh ke client). */
export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 8) return '••••••••'
  return `${k.slice(0, 3)}…${k.slice(-4)}`
}
