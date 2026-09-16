import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-node'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/session — info session saat ini (publik).
 * Dipakai client untuk mengetahui status autentikasi tanpa membocorkan
 * detail token.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  return NextResponse.json({
    authenticated: !!session,
    username: session?.sub ?? null,
    expiresAt: session?.exp ?? null,
  })
}
