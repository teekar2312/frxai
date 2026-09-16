import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from '@/lib/auth-core'
import {
  checkLoginGate,
  clearLoginFails,
  getClientIp,
  recordLoginFail,
  verifyCredentials,
} from '@/lib/auth-node'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/login — publik (dikecualikan dari middleware auth).
 * Body: { username: string, password: string }
 *
 * Proteksi brute-force: 5 kegagalan per IP dalam 15 menit → terkunci 15 menit.
 * Semua percobaan (sukses/gagal) dicatat ke LogEntry (kategori AUTH) untuk
 * audit trail di panel Logs.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  // Gate brute-force
  const gate = checkLoginGate(ip)
  if (!gate.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'RATE_LIMITED',
        message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(gate.retryAfterSec / 60)} menit.`,
      },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
    )
  }

  // Parse body dengan aman
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'BAD_REQUEST', message: 'Body harus JSON valid.' },
      { status: 400 }
    )
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return NextResponse.json(
      { success: false, error: 'BAD_REQUEST', message: 'Username dan password wajib diisi.' },
      { status: 400 }
    )
  }
  if (username.length > 100 || password.length > 200) {
    return NextResponse.json(
      { success: false, error: 'BAD_REQUEST', message: 'Username/password terlalu panjang.' },
      { status: 400 }
    )
  }

  // Verifikasi kredensial
  if (!verifyCredentials(username, password)) {
    const remaining = recordLoginFail(ip)
    // Audit trail (best-effort, jangan gagalkan response bila DB bermasalah)
    try {
      await db.logEntry.create({
        data: {
          level: 'WARN',
          category: 'AUTH',
          message: `Login gagal untuk "${username}" dari ${ip}`,
          details: remaining > 0 ? `Sisa percobaan: ${remaining}` : 'IP dikunci 15 menit',
        },
      })
    } catch {
      /* audit best-effort */
    }
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_CREDENTIALS',
        message:
          remaining > 0
            ? `Username atau password salah. Sisa ${remaining} percobaan.`
            : 'Username atau password salah. IP dikunci 15 menit.',
      },
      { status: 401 }
    )
  }

  // Sukses — buat session
  clearLoginFails(ip)
  const token = await createSessionToken(username)

  // Cookie secure hanya bila request datang via HTTPS (di belakang proxy
  // cek x-forwarded-proto agar preview HTTP lokal tetap berfungsi)
  const isHttps = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() === 'https'

  try {
    await db.logEntry.create({
      data: {
        level: 'INFO',
        category: 'AUTH',
        message: `Login sukses: ${username} dari ${ip}`,
      },
    })
  } catch {
    /* audit best-effort */
  }

  const res = NextResponse.json({ success: true, username })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
