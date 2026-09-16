import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { SESSION_COOKIE } from '@/lib/auth-core'
import { getSessionFromRequest, getClientIp } from '@/lib/auth-node'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout — hapus cookie session.
 * Publik (dikecualikan dari middleware) agar pengguna yang session-nya
 * kedaluwarsa tetap bisa "logout" (clear cookie) tanpa error 401.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (session) {
    try {
      await db.logEntry.create({
        data: {
          level: 'INFO',
          category: 'AUTH',
          message: `Logout: ${session.sub} dari ${getClientIp(req)}`,
        },
      })
    } catch {
      /* audit best-effort */
    }
  }
  const res = NextResponse.json({ success: true })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
