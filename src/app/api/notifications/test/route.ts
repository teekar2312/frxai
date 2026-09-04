/**
 * POST /api/notifications/test — Send a test notification
 * =========================================================
 * Dispatches a TEST event through all configured channels.
 * Returns per-channel dispatch results (SENT/FAILED/SKIPPED).
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendTestNotification } from '@/lib/notifier'
import { rateLimitGuard } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const guard = rateLimitGuard('WRITE')

export async function POST(request: NextRequest) {
  const limited = guard(request)
  if (limited) return limited

  const results = await sendTestNotification()

  const anySent = results.some((r) => r.status === 'SENT')
  return NextResponse.json({
    success: true,
    data: {
      results,
      summary: anySent ? 'Test notification dispatched' : 'No channel delivered — check configuration',
    },
  })
}
