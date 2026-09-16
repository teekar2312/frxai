/**
 * auth-core.ts — Inti sesi autentikasi FINEX AI (EDGE-SAFE).
 *
 * Aman diimpor dari middleware (Edge Runtime) maupun route Node:
 * hanya bergantung pada `jose` + Web API, TIDAK pada node:crypto.
 *
 * Desain:
 *  - Session = JWT HS256 yang disimpan di cookie `finex_session`
 *    (HttpOnly, SameSite=Lax, kedaluwarsa 7 hari).
 *  - Ditandatangani dengan env SESSION_SECRET (wajib diisi di produksi).
 */

import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'finex_session'

/** Masa berlaku session: 7 hari (detik). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7

export interface SessionPayload {
  /** username admin */
  sub: string
  iat: number
  exp: number
}

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET ?? ''
  if (secret.length < 32) {
    throw new Error(
      'SESSION_SECRET belum diatur / terlalu pendek (minimal 32 karakter). ' +
        'Generate: openssl rand -base64 48'
    )
  }
  return new TextEncoder().encode(secret)
}

/** Buat token session JWT untuk username. */
export async function createSessionToken(username: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecretKey())
}

/**
 * Verifikasi token session. Return payload bila valid, null bila
 * token rusak/kedaluwarsa/secret tidak cocok.
 */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ['HS256'],
    })
    if (!payload.sub || typeof payload.sub !== 'string') return null
    return {
      sub: payload.sub,
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
      exp: typeof payload.exp === 'number' ? payload.exp : 0,
    }
  } catch {
    return null
  }
}
