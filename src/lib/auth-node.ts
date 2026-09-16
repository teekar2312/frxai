/**
 * auth-node.ts — Utilitas autentikasi sisi server Node (bukan Edge).
 *
 * - Verifikasi kredensial admin (scrypt hash / plaintext env / default).
 * - Pembacaan session dari cookie di Server Component & Route Handler.
 * - Rate-limit brute-force login per IP (in-memory).
 *
 * Sumber kredensial (urutan prioritas):
 *   1. ADMIN_PASSWORD_HASH  — format scrypt:16384:8:1:<salt>:<hash>  (PRODUKSI)
 *   2. ADMIN_PASSWORD       — plaintext env (development saja)
 *   3. default              — "finex-admin-2025" (fallback + warning)
 */

import 'server-only'
import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from './auth-core'

export const DEFAULT_ADMIN_USERNAME = 'admin'
export const DEFAULT_ADMIN_PASSWORD = 'finex-admin-2025'

/** Parameter scrypt — HARUS identik dengan scripts/hash-password.mjs */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

export interface AuthConfig {
  username: string
  usingDefaultPassword: boolean
}

/** Baca konfigurasi kredensial dari env (dipanggil per-request, murah). */
export function getAuthConfig(): AuthConfig {
  const username = (process.env.ADMIN_USERNAME ?? '').trim() || DEFAULT_ADMIN_USERNAME
  const usingDefaultPassword =
    !(process.env.ADMIN_PASSWORD_HASH ?? '').trim() && !(process.env.ADMIN_PASSWORD ?? '').trim()
  return { username, usingDefaultPassword }
}

/** Bandingkan dua string secara konstan-waktu (anti timing attack). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/** Verifikasi password scrypt hash format `scrypt:N:r:p:<saltB64url>:<hashB64url>`. */
function verifyScryptHash(password: string, encoded: string): boolean {
  const parts = encoded.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  if (N < 1024 || N > 1 << 22 || r <= 0 || p <= 0) return false
  try {
    const salt = Buffer.from(saltB64, 'base64url')
    const expected = Buffer.from(hashB64, 'base64url')
    if (salt.length < 8 || expected.length < 32) return false
    const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p })
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * Verifikasi kredensial login.
 * Return true bila username + password cocok dengan env.
 */
export function verifyCredentials(username: string, password: string): boolean {
  const cfg = getAuthConfig()
  if (!timingSafeEqualStr(username, cfg.username)) return false

  const hash = (process.env.ADMIN_PASSWORD_HASH ?? '').trim()
  if (hash) return verifyScryptHash(password, hash)

  const plain = (process.env.ADMIN_PASSWORD ?? '').trim()
  if (plain) return timingSafeEqualStr(password, plain)

  // Fallback default — hanya untuk first-run/preview.
  return timingSafeEqualStr(password, DEFAULT_ADMIN_PASSWORD)
}

// ---------------------------------------------------------------------------
// Session (Server Component / Route Handler)
// ---------------------------------------------------------------------------

/** Baca & verifikasi session dari cookie (async cookies() Next 16). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  return verifySessionToken(store.get(SESSION_COOKIE)?.value)
}

/** Baca & verifikasi session dari NextRequest (Route Handler). */
export function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}

// ---------------------------------------------------------------------------
// Brute-force guard login (in-memory, per-IP)
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000 // 15 menit
const WINDOW_MS = 15 * 60 * 1000

interface AttemptRecord {
  fails: number
  firstFailAt: number
  lockedUntil: number
}

const globalForAuth = globalThis as unknown as {
  __finexLoginAttempts?: Map<string, AttemptRecord>
}
const attempts: Map<string, AttemptRecord> =
  globalForAuth.__finexLoginAttempts ?? new Map<string, AttemptRecord>()
globalForAuth.__finexLoginAttempts = attempts

/** Ambil IP client dari header proxy (gateway) atau fallback. */
export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

export type LoginGate = { allowed: true } | { allowed: false; retryAfterSec: number }

/** Cek apakah IP masih boleh mencoba login. */
export function checkLoginGate(ip: string): LoginGate {
  const rec = attempts.get(ip)
  if (!rec) return { allowed: true }
  if (rec.lockedUntil > Date.now()) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.lockedUntil - Date.now()) / 1000) }
  }
  return { allowed: true }
}

/** Catat kegagalan login; mengunci IP setelah MAX_ATTEMPTS dalam WINDOW_MS. */
export function recordLoginFail(ip: string): number {
  const now = Date.now()
  const rec = attempts.get(ip)
  if (!rec || now - rec.firstFailAt > WINDOW_MS || rec.lockedUntil > now) {
    attempts.set(ip, { fails: 1, firstFailAt: now, lockedUntil: 0 })
    return MAX_ATTEMPTS - 1
  }
  rec.fails += 1
  if (rec.fails >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS
    return 0
  }
  return MAX_ATTEMPTS - rec.fails
}

/** Bersihkan catatan kegagalan setelah login sukses. */
export function clearLoginFails(ip: string): void {
  attempts.delete(ip)
}
