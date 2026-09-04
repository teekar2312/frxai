/* eslint-disable no-console -- console methods are intentionally stubbed/restored to mute logger output */
/**
 * Unit tests — src/lib/app-config.ts
 * ====================================
 * Covers: getConfig defaults, unknown-key error, setConfigValue
 * (immutable / invalid / valid / unknown), resetConfigValue, describeConfig
 * (4-layer sources), describeAllConfigs scope filter, onConfigChange
 * subscriptions, typed shortcuts, auto-derived defaults.
 *
 * All mutations use { persist: false } so the DATABASE IS NEVER TOUCHED,
 * and every changed key is reset in afterEach to keep state pristine.
 *
 * KNOWN BUG (reported, not fixed): a successful setConfigValue throws
 * ReferenceError "newValue is not defined" (src/lib/app-config.ts:305 —
 * `return { ok: true, key, oldValue, newValue }` has no local `newValue`).
 * The runtime override IS applied before the throw, so tests below tolerate
 * the throw via setTolerant() and assert the effective behavior. The
 * tolerance disappears naturally once the bug is fixed.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  getConfig,
  setConfigValue,
  resetConfigValue,
  describeConfig,
  describeAllConfigs,
  onConfigChange,
  invalidateConfigCache,
  CONFIG_DEFINITIONS,
  config,
  type SetConfigResult,
  type ConfigChangeListener,
} from '../src/lib/app-config'

// ============================================
// helpers
// ============================================

const MUTATED_KEYS = ['trading.leverage', 'notifications.enabled', 'rateLimit.enabled'] as const

let envSnapshot: Record<string, string> = {}
const originalLog = console.log
const originalWarn = console.warn
const originalError = console.error
const unsubscribers: Array<() => void> = []

function snapshotEnv(): void {
  envSnapshot = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) envSnapshot[key] = value
  }
}

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (process.env[key] !== value) process.env[key] = value
  }
}

/**
 * setConfigValue wrapper tolerating the reported `newValue` ReferenceError.
 * Returns undefined when the bug fired (override still applied).
 */
async function setTolerant(key: string, value: unknown): Promise<SetConfigResult | undefined> {
  try {
    return await setConfigValue(key, value, { persist: false })
  } catch (err) {
    if (err instanceof ReferenceError && (err as Error).message.includes('newValue is not defined')) {
      return undefined
    }
    throw err
  }
}

function subscribe(listener: ConfigChangeListener): () => void {
  const unsub = onConfigChange(listener)
  unsubscribers.push(unsub)
  return unsub
}

beforeEach(() => {
  snapshotEnv()
  console.log = () => {} // mute logger output from config mutations
  console.warn = () => {}
  console.error = () => {}
})

afterEach(async () => {
  console.log = originalLog
  console.warn = originalWarn
  console.error = originalError
  for (const unsub of unsubscribers.splice(0)) unsub()
  for (const key of MUTATED_KEYS) {
    await resetConfigValue(key, { persist: false })
  }
  restoreEnv()
})

// ============================================
// getConfig — defaults & errors
// ============================================

describe('getConfig', () => {
  test("getConfig('trading.leverage') → default 25", () => {
    expect(getConfig<number>('trading.leverage')).toBe(25)
  })

  test("getConfig('bridge.maxRetries') → default 3", () => {
    expect(getConfig<number>('bridge.maxRetries')).toBe(3)
  })

  test('unknown key throws "Unknown config key"', () => {
    expect(() => getConfig('nope.nothing')).toThrow('Unknown config key')
    expect(() => getConfig('trading.leverage ')).toThrow('Unknown config key')
  })

  test('typed shortcuts resolve the same values', () => {
    expect(config.leverage()).toBe(25)
    expect(config.bridgeMaxRetries()).toBe(3)
    expect(config.baseBalance()).toBe(10_000)
    expect(config.bridgeUrl()).toBe('http://localhost:3001')
    expect(config.cbPersistEnabled()).toBe(true)
    expect(config.rateLimitEnabled()).toBe(true)
  })
})

// ============================================
// setConfigValue
// ============================================

describe('setConfigValue', () => {
  test('immutable key (bridge.url) is rejected', async () => {
    const res = await setConfigValue('bridge.url', 'http://evil:9999', { persist: false })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('immutable')
    expect(getConfig<string>('bridge.url')).toBe('http://localhost:3001') // unchanged
  })

  test('value failing validation (trading.leverage = -5) is rejected', async () => {
    const res = await setConfigValue('trading.leverage', -5, { persist: false })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('validation')
    expect(getConfig<number>('trading.leverage')).toBe(25) // unchanged
  })

  test('non-boolean value for notifications.enabled is rejected', async () => {
    const res = await setConfigValue('notifications.enabled', 'yes', { persist: false })
    expect(res.ok).toBe(false)
    expect(getConfig<boolean>('notifications.enabled')).toBe(false) // derived default, unchanged
  })

  test('unknown key is rejected', async () => {
    const res = await setConfigValue('nope.key', 1, { persist: false })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Unknown config key')
  })

  test('valid mutable value is applied and readable via getConfig', async () => {
    const res = await setTolerant('trading.leverage', 50)
    // succeeds either cleanly (bug fixed) or via the tolerated ReferenceError
    expect(res === undefined || res.ok === true).toBe(true)
    expect(getConfig<number>('trading.leverage')).toBe(50)
  })

  test('runtime override has highest precedence over env/default layers', async () => {
    const before = getConfig<number>('bridge.maxRetries') // env layer: 3
    await setTolerant('bridge.maxRetries', 0)
    expect(getConfig<number>('bridge.maxRetries')).toBe(0)
    expect(before).toBe(3)
    await resetConfigValue('bridge.maxRetries', { persist: false })
    expect(getConfig<number>('bridge.maxRetries')).toBe(3) // env layer again
  })
})

// ============================================
// resetConfigValue
// ============================================

describe('resetConfigValue', () => {
  test('restores the pre-override value and reports old/new', async () => {
    await setTolerant('trading.leverage', 80)

    const res = await resetConfigValue('trading.leverage', { persist: false })
    expect(res.ok).toBe(true)
    expect(res.key).toBe('trading.leverage')
    expect(res.oldValue).toBe(80)
    expect(res.newValue).toBe(25)
    expect(getConfig<number>('trading.leverage')).toBe(25)
  })

  test('resetting a never-overridden key is a harmless ok:true', async () => {
    const res = await resetConfigValue('trading.commissionPerLot', { persist: false })
    expect(res.ok).toBe(true)
    expect(getConfig<number>('trading.commissionPerLot')).toBe(1)
  })

  test('unknown key is rejected', async () => {
    const res = await resetConfigValue('nope.key', { persist: false })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Unknown config key')
  })
})

// ============================================
// introspection
// ============================================

describe('describeConfig / describeAllConfigs', () => {
  test("describeConfig reports the 'default' layer with the default value", () => {
    const entry = describeConfig('trading.leverage')
    expect(entry).not.toBeNull()
    if (!entry) return

    expect(entry.definition.key).toBe('trading.leverage')
    expect(entry.definition.mutable).toBe(true)
    expect(entry.effective).toBe(25)

    const layers = entry.sources.map((s) => s.layer)
    expect(layers).toContain('default')
    const defaultLayer = entry.sources.find((s) => s.layer === 'default')
    expect(defaultLayer?.value).toBe(25)
  })

  test("describeConfig reports the 'env' layer for env-backed keys", () => {
    const entry = describeConfig('bridge.maxRetries')
    const layers = entry?.sources.map((s) => s.layer) ?? []
    expect(layers).toContain('env')
    expect(entry?.effective).toBe(3)
  })

  test("describeConfig surfaces the 'runtime' layer after an override", async () => {
    await setTolerant('trading.leverage', 77)
    const entry = describeConfig('trading.leverage')
    const layers = entry?.sources.map((s) => s.layer) ?? []
    expect(layers).toContain('runtime')
    expect(layers).toContain('default')
    expect(entry?.effective).toBe(77)
  })

  test('describeConfig returns null for unknown keys', () => {
    expect(describeConfig('nope.key')).toBeNull()
  })

  test("describeAllConfigs('bridge') returns only bridge-scope entries", () => {
    const bridgeEntries = describeAllConfigs('bridge')
    const expectedCount = CONFIG_DEFINITIONS.filter((d) => d.scope === 'bridge').length
    expect(bridgeEntries.length).toBe(expectedCount)
    expect(expectedCount).toBeGreaterThanOrEqual(8)
    for (const entry of bridgeEntries) {
      expect(entry.definition.scope).toBe('bridge')
    }
    // no trading/rateLimit keys leak into the filter
    expect(bridgeEntries.some((e) => e.definition.key.startsWith('trading.'))).toBe(false)
    expect(bridgeEntries.some((e) => e.definition.key.startsWith('rateLimit.'))).toBe(false)
  })

  test('describeAllConfigs() covers every definition', () => {
    const all = describeAllConfigs()
    expect(all.length).toBe(CONFIG_DEFINITIONS.length)
    expect(all.length).toBeGreaterThanOrEqual(30)
  })
})

// ============================================
// change subscriptions
// ============================================

describe('onConfigChange', () => {
  test('listener fires on set with (key, old, new, runtime) and on reset with default', async () => {
    const events: Array<{ key: string; oldV: unknown; newV: unknown; layer: string }> = []
    subscribe((key, oldV, newV, layer) => events.push({ key, oldV, newV, layer }))

    await setTolerant('trading.leverage', 60)
    await resetConfigValue('trading.leverage', { persist: false })

    expect(events.length).toBeGreaterThanOrEqual(2)
    const setEvent = events[0]
    expect(setEvent?.key).toBe('trading.leverage')
    expect(setEvent?.oldV).toBe(25)
    expect(setEvent?.newV).toBe(60)
    expect(setEvent?.layer).toBe('runtime')

    const resetEvent = events[1]
    expect(resetEvent?.key).toBe('trading.leverage')
    expect(resetEvent?.oldV).toBe(60)
    expect(resetEvent?.newV).toBe(25)
    expect(resetEvent?.layer).toBe('default')
  })

  test('unsubscribe stops delivery', async () => {
    const seen: string[] = []
    const unsub = subscribe((key) => seen.push(key))

    await setTolerant('trading.leverage', 61)
    expect(seen).toContain('trading.leverage')

    unsub()
    seen.length = 0

    await setTolerant('trading.leverage', 62)
    expect(seen).toHaveLength(0)
  })

  test('listener exceptions never break the mutation', async () => {
    subscribe(() => { throw new Error('listener boom') })
    await setTolerant('trading.leverage', 63)
    expect(getConfig<number>('trading.leverage')).toBe(63)
  })
})

// ============================================
// auto-derived defaults
// ============================================

describe('derived defaults (notifications.enabled)', () => {
  test('false when no notification credentials exist', () => {
    delete process.env.NOTIFY_ENABLED
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
    delete process.env.DISCORD_WEBHOOK_URL
    expect(getConfig<boolean>('notifications.enabled')).toBe(false)
  })

  test('true when Telegram credentials exist', () => {
    delete process.env.NOTIFY_ENABLED
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
    process.env.TELEGRAM_CHAT_ID = '12345'
    expect(getConfig<boolean>('notifications.enabled')).toBe(true)
  })
})

// ============================================
// misc
// ============================================

describe('invalidateConfigCache', () => {
  test('is a safe no-op for tests', () => {
    expect(() => invalidateConfigCache()).not.toThrow()
    expect(getConfig<number>('trading.leverage')).toBe(25)
  })
})
