/**
 * /api/config — Layered Configuration API
 * ==========================================
 * GET  ?scope=trading|risk|bridge|... — list entries (effective values + layer sources)
 * PATCH { key, value }                — set a runtime override (persisted to DB)
 * DELETE ?key=...                      — reset a key to its lower layers
 *
 * All mutations audit-logged via trading-logger + AuditTrail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { describeAllConfigs, setConfigValue, resetConfigValue, loadDatabaseLayer, type ConfigScope } from '@/lib/app-config'
import { rateLimitGuard } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const guard = rateLimitGuard('WRITE')

const VALID_SCOPES = ['trading', 'risk', 'notifications', 'logging', 'bridge', 'rateLimit', 'backtest', 'monitoring']

export async function GET(request: NextRequest) {
  const limited = guard(request)
  if (limited) return limited

  await loadDatabaseLayer()
  const scopeParam = request.nextUrl.searchParams.get('scope')
  const scope = scopeParam && VALID_SCOPES.includes(scopeParam) ? (scopeParam as ConfigScope) : undefined

  const entries = describeAllConfigs(scope)
  return NextResponse.json({
    success: true,
    data: {
      scope: scope ?? 'all',
      count: entries.length,
      entries: entries.map((e) => ({
        key: e.definition.key,
        scope: e.definition.scope,
        description: e.definition.description,
        mutable: e.definition.mutable,
        effective: e.effective,
        effectiveType: typeof e.effective,
        sources: e.sources.map((s) => ({ layer: s.layer, value: s.value, updatedAt: s.updatedAt?.toISOString() })),
      })),
    },
  })
}

export async function PATCH(request: NextRequest) {
  const limited = guard(request)
  if (limited) return limited

  try {
    const body = (await request.json()) as { key?: string; value?: unknown; persist?: boolean }
    if (typeof body.key !== 'string' || !body.key) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_KEY', message: 'key is required' } }, { status: 400 })
    }

    const result = await setConfigValue(body.key, body.value, { persist: body.persist !== false, source: 'api' })

    // Audit trail
    await db.auditTrail
      .create({
        data: {
          action: 'CONFIG_UPDATED',
          category: 'SYSTEM',
          fieldName: body.key,
          oldValue: String(result.oldValue),
          newValue: String(body.value),
          reason: 'Runtime config change via /api/config',
          performedBy: 'USER',
        },
      })
      .catch(() => { /* best effort */ })

    if (!result.ok) {
      return NextResponse.json({ success: false, error: { code: 'SET_FAILED', message: result.error } }, { status: 400 })
    }
    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: err instanceof Error ? err.message : 'Invalid body' } },
      { status: 400 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const limited = guard(request)
  if (limited) return limited

  const key = request.nextUrl.searchParams.get('key')
  if (!key) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_KEY', message: 'key query param required' } }, { status: 400 })
  }

  const result = await resetConfigValue(key)
  if (!result.ok) {
    return NextResponse.json({ success: false, error: { code: 'RESET_FAILED', message: result.error } }, { status: 400 })
  }

  await db.auditTrail
    .create({
      data: {
        action: 'CONFIG_UPDATED',
        category: 'SYSTEM',
        fieldName: key,
        oldValue: String(result.oldValue),
        newValue: String(result.newValue),
        reason: 'Reset runtime override via /api/config',
        performedBy: 'USER',
      },
    })
    .catch(() => { /* best effort */ })

  return NextResponse.json({ success: true, data: result })
}
