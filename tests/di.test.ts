import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  getDb,
  getLogger,
  setService,
  resetServices,
  withServices,
} from '@/lib/di'
import { db as realDb } from '@/lib/db'
import { logger as realLogger } from '@/lib/trading-logger'
import { getAccountEquity } from '@/lib/db-utils'

// ---- fake services for injection ----

const fakeDb = {
  trade: {
    aggregate: async () => ({ _sum: { pnl: 123.45 } }),
  },
} as unknown as typeof realDb

const fakeLogger = {
  ...realLogger,
  info: () => undefined as void,
} as unknown as typeof realLogger

// ============================================
// DEFAULT RESOLUTION (no overrides)
// ============================================

describe('di — default resolution', () => {
  test('getDb() returns the shared Prisma singleton when not overridden', () => {
    expect(getDb()).toBe(realDb)
  })

  test('getLogger() returns the shared logger singleton when not overridden', () => {
    expect(getLogger()).toBe(realLogger)
  })

  test('resetServices() restores defaults', () => {
    setService('db', fakeDb)
    expect(getDb()).toBe(fakeDb)
    resetServices()
    expect(getDb()).toBe(realDb)
  })
})

// ============================================
// OVERRIDE SEMANTICS
// ============================================

describe('di — setService / resetServices', () => {
  beforeEach(() => resetServices())
  afterEach(() => resetServices())

  test('setService(db) swaps only the db — logger untouched', () => {
    setService('db', fakeDb)
    expect(getDb()).toBe(fakeDb)
    expect(getLogger()).toBe(realLogger)
  })

  test('setService(logger) swaps only the logger — db untouched', () => {
    setService('logger', fakeLogger)
    expect(getLogger()).toBe(fakeLogger)
    expect(getDb()).toBe(realDb)
  })

  test('setService can be called repeatedly — last write wins', () => {
    const other = { trade: { aggregate: async () => ({ _sum: { pnl: 1 } }) } } as unknown as typeof realDb
    setService('db', fakeDb)
    setService('db', other)
    expect(getDb()).toBe(other)
  })
})

// ============================================
// SCOPED OVERRIDES
// ============================================

describe('di — withServices', () => {
  beforeEach(() => resetServices())
  afterEach(() => resetServices())

  test('override active inside fn, restored after', () => {
    let seenInside: unknown
    const result = withServices({ db: fakeDb }, () => {
      seenInside = getDb()
      return 42
    })
    expect(seenInside).toBe(fakeDb)
    expect(result).toBe(42)
    expect(getDb()).toBe(realDb)
  })

  test('restores overrides even when fn throws', () => {
    expect(() =>
      withServices({ db: fakeDb }, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(getDb()).toBe(realDb)
  })

  test('async fn: override stays active across awaits, restored after settle', async () => {
    const p = withServices({ db: fakeDb }, async () => {
      await new Promise((r) => setTimeout(r, 10))
      return getDb() // must still see the override after an await
    })
    const resolved = await p
    expect(resolved).toBe(fakeDb)
    expect(getDb()).toBe(realDb)
  })

  test('nesting: inner scope restores to outer state, not to defaults', () => {
    setService('db', fakeDb)
    const other = {} as unknown as typeof realDb
    const inner = withServices({ db: other }, () => getDb())
    expect(inner).toBe(other)
    // after inner scope ends, the OUTER override (fakeDb) is back
    expect(getDb()).toBe(fakeDb)
  })
})

// ============================================
// DI IN ACTION — db-utils through the seam
// ============================================

describe('di — injected service used by db-utils.getAccountEquity', () => {
  afterEach(() => resetServices())

  test('fake db aggregate result flows through getAccountEquity', async () => {
    const equity = await withServices({ db: fakeDb }, () => getAccountEquity())
    // BASE_BALANCE (10000 default) + 123.45
    expect(equity).toBeCloseTo(10123.45, 2)
  })

  test('aggregate returning null pnl falls back to BASE_BALANCE', async () => {
    const nullDb = {
      trade: { aggregate: async () => ({ _sum: { pnl: null } }) },
    } as unknown as typeof realDb
    const equity = await withServices({ db: nullDb }, () => getAccountEquity())
    expect(equity).toBeGreaterThanOrEqual(10000)
    expect(equity).toBeLessThan(10001)
  })

  test('query filters to OPEN/PARTIAL_FILLED/CLOSED statuses', async () => {
    let capturedWhere: unknown
    const spyDb = {
      trade: {
        aggregate: async (args: { where?: unknown }) => {
          capturedWhere = args?.where
          return { _sum: { pnl: 0 } }
        },
      },
    } as unknown as typeof realDb
    await withServices({ db: spyDb }, () => getAccountEquity())
    expect(capturedWhere).toEqual({ status: { in: ['OPEN', 'PARTIAL_FILLED', 'CLOSED'] } })
  })
})
