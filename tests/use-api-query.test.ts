import { describe, test, expect } from 'bun:test'
import { extractApiData } from '@/hooks/use-api-query'

describe('extractApiData — payload containment', () => {
  test('unwraps { success, data } envelope', () => {
    const json = { success: true, data: [1, 2, 3] }
    expect(extractApiData<number[]>(json, [])).toEqual([1, 2, 3])
  })

  test('returns fallback when data is null', () => {
    const json = { success: true, data: null }
    expect(extractApiData<string[]>(json, [])).toEqual([])
  })

  test('returns fallback when data is undefined (missing key)', () => {
    const json = { success: true }
    expect(extractApiData<string[]>(json, ['x'])).toEqual(['x'])
  })

  test('returns fallback when json is null', () => {
    expect(extractApiData(null, 'fb')).toBe('fb')
  })

  test('returns fallback when json is undefined', () => {
    expect(extractApiData(undefined, 0)).toBe(0)
  })

  test('returns fallback when json is a primitive (string)', () => {
    // a proxy / HTML error page parsed as text would land here
    expect(extractApiData('oops', 'fb')).toBe('fb')
  })

  test('returns fallback when json is a primitive (number)', () => {
    expect(extractApiData(42, 'fb')).toBe('fb')
  })

  test('data: 0 is preserved (falsy but valid)', () => {
    const json = { success: true, data: 0 }
    expect(extractApiData<number>(json, -1)).toBe(0)
  })

  test('data: false is preserved (falsy but valid)', () => {
    const json = { success: true, data: false }
    expect(extractApiData<boolean>(json, true)).toBe(false)
  })

  test('data: empty string is preserved (falsy but valid)', () => {
    const json = { success: true, data: '' }
    expect(extractApiData<string>(json, 'fb')).toBe('')
  })

  test('nested envelope shape { data: { strategies } } passes object through', () => {
    const json = { data: { strategies: [{ id: 1 }], summary: { active: 2 } } }
    const out = extractApiData<{ strategies: unknown[]; summary: unknown }>(json, {
      strategies: [],
      summary: null,
    })
    expect(out.strategies).toEqual([{ id: 1 }])
  })

  test('error envelope { success: false, error } without data → fallback', () => {
    const json = { success: false, error: 'boom' }
    expect(extractApiData<string[]>(json, [])).toEqual([])
  })
})
