import { describe, test, expect } from 'bun:test'
import { parsePagination } from '@/lib/api-query'

const sp = (qs: Record<string, string> = {}) =>
  new URLSearchParams(qs)

// ============================================
// DEFAULTS
// ============================================

describe('parsePagination — defaults', () => {
  test('empty params → page 1, limit 20, skip 0, take 20', () => {
    expect(parsePagination(sp())).toEqual({ page: 1, limit: 20, skip: 0, take: 20 })
  })

  test('custom defaults are honored', () => {
    expect(parsePagination(sp(), { page: 3, limit: 50 })).toEqual({
      page: 3, limit: 50, skip: 100, take: 50,
    })
  })

  test('custom maxLimit clamps the default limit too', () => {
    const p = parsePagination(sp(), { limit: 500, maxLimit: 200 })
    expect(p.limit).toBe(200)
  })
})

// ============================================
// VALID INPUT
// ============================================

describe('parsePagination — valid input', () => {
  test('page=2&limit=10 → skip 10', () => {
    expect(parsePagination(sp({ page: '2', limit: '10' }))).toEqual({
      page: 2, limit: 10, skip: 10, take: 10,
    })
  })

  test('large page computes skip correctly', () => {
    expect(parsePagination(sp({ page: '100', limit: '25' })).skip).toBe(2475)
  })

  test('whitespace-padded numerics parse', () => {
    expect(parsePagination(sp({ limit: ' 30 ' })).limit).toBe(30)
  })
})

// ============================================
// INVALID INPUT
// ============================================

describe('parsePagination — invalid input', () => {
  test('non-numeric limit falls back to default', () => {
    expect(parsePagination(sp({ limit: 'abc' })).limit).toBe(20)
  })

  test('NaN limit falls back to default', () => {
    expect(parsePagination(sp({ limit: 'NaN' })).limit).toBe(20)
  })

  test('null limit (missing key) falls back to default', () => {
    expect(parsePagination(sp({ page: '1' })).limit).toBe(20)
  })

  test('empty-string limit falls back to default', () => {
    expect(parsePagination(sp({ limit: '' })).limit).toBe(20)
  })

  test('non-numeric page falls back to 1', () => {
    expect(parsePagination(sp({ page: 'xyz' })).page).toBe(1)
  })
})

// ============================================
// CLAMPING
// ============================================

describe('parsePagination — clamping', () => {
  test('limit below 1 clamps to 1', () => {
    expect(parsePagination(sp({ limit: '0' })).limit).toBe(1)
  })

  test('negative limit clamps to 1', () => {
    expect(parsePagination(sp({ limit: '-5' })).limit).toBe(1)
  })

  test('limit above maxLimit (100 default) clamps', () => {
    expect(parsePagination(sp({ limit: '9999' })).limit).toBe(100)
  })

  test('custom maxLimit respected', () => {
    expect(parsePagination(sp({ limit: '1500' }), { maxLimit: 500 }).limit).toBe(500)
  })

  test('page below 1 clamps to 1', () => {
    expect(parsePagination(sp({ page: '0' })).page).toBe(1)
    expect(parsePagination(sp({ page: '-3' })).page).toBe(1)
  })

  test('page 0 does not produce negative skip', () => {
    expect(parsePagination(sp({ page: '0' })).skip).toBe(0)
  })
})

// ============================================
// COMPATIBILITY WITH THE ROUTE-LEVEL PATTERN IT REPLACES
// ============================================

describe('parsePagination — drop-in compatibility', () => {
  test('replicates /api/trades/history semantics: page="2", limit="20"', () => {
    // old: page = max(1, parseInt('2') || 1); limit = min(100, max(1, parseInt('20') || 20))
    const p = parsePagination(sp({ page: '2', limit: '20' }))
    expect(p.page).toBe(2)
    expect(p.limit).toBe(20)
    expect(p.skip).toBe(20)
    expect(p.take).toBe(20)
  })

  test("old pattern fallback for garbage input (parseInt(x) || 20)", () => {
    expect(parsePagination(sp({ limit: 'garbage' })).limit).toBe(20)
  })

  test('accepts any .get(name) accessor, not just URLSearchParams', () => {
    const custom = {
      get: (name: string) => (name === 'limit' ? '7' : null),
    }
    expect(parsePagination(custom)).toEqual({ page: 1, limit: 7, skip: 0, take: 7 })
  })
})
