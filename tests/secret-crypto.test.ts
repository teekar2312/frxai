/**
 * Unit tests — src/lib/secret-crypto.ts (AES-256-GCM secrets at rest)
 * ==================================================================
 * Covers: encrypt→decrypt round-trip (hex key, base64 key, unset key →
 * dev fallback), enc:v1: envelope format, plaintext passthrough (legacy
 * DB rows / backward compatibility), tamper detection (GCM auth failure
 * → '' without throwing), random IV (same plaintext → different
 * ciphertext), wrong-key failure, idempotent encryption, isEncrypted.
 *
 * NOTE: every test that touches process.env saves the original
 * NOTIFICATION_ENCRYPTION_KEY in beforeEach and restores it in
 * afterEach so other test files are never polluted (same pattern as
 * env-validation.test.ts).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret, isEncrypted } from '../src/lib/secret-crypto'

const ENV_KEY = 'NOTIFICATION_ENCRYPTION_KEY'

const SECRET = '123456789:AAHfiqksKZ8WmoQTsZhfkbxK9-tfE6mbvCw' // Telegram-shaped bot token
const WEBHOOK = 'https://discord.com/api/webhooks/1234567890/SlWqmpXoSgmqyIsT7mFqO3kZ'

let savedKey: string | undefined
const originalWarn = console.warn
const originalError = console.error

beforeEach(() => {
  savedKey = process.env[ENV_KEY]
  // mute the module's documented warn/error logs (they are side effects, not test subjects)
  console.warn = () => {}
  console.error = () => {}
})

afterEach(() => {
  if (savedKey === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedKey
  console.warn = originalWarn
  console.error = originalError
})

/** Flip one character of a base64 segment (guaranteed to change it). */
function flipOneChar(s: string): string {
  if (s.length === 0) return s
  const idx = Math.floor(s.length / 2)
  const replacement = s[idx] === 'A' ? 'B' : 'A'
  return s.slice(0, idx) + replacement + s.slice(idx + 1)
}

// ============================================
// ROUND-TRIP
// ============================================

describe('encryptSecret / decryptSecret — round-trip', () => {
  test('round-trips the original secret with a 64-char hex key', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const encrypted = encryptSecret(SECRET)
    expect(encrypted).not.toBe(SECRET)
    expect(decryptSecret(encrypted)).toBe(SECRET)
  })

  test('round-trips the original secret with a 44-char base64 key', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('base64')
    const encrypted = encryptSecret(WEBHOOK)
    expect(decryptSecret(encrypted)).toBe(WEBHOOK)
  })

  test('round-trips when the env key is UNSET (stable dev fallback key)', () => {
    delete process.env[ENV_KEY]
    const encrypted = encryptSecret(SECRET)
    expect(encrypted.startsWith('enc:v1:')).toBe(true)
    expect(decryptSecret(encrypted)).toBe(SECRET)
  })

  test('round-trips when the env key is an empty string (treated as unset)', () => {
    process.env[ENV_KEY] = ''
    expect(decryptSecret(encryptSecret(SECRET))).toBe(SECRET)
  })

  test('round-trips when the env key is INVALID (falls back without crashing)', () => {
    process.env[ENV_KEY] = 'definitely-not-hex-or-base64-32-bytes'
    expect(decryptSecret(encryptSecret(SECRET))).toBe(SECRET)
  })

  test('unicode and multi-line secrets survive the round-trip', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const weird = 'emoji 🚀 secret\nwith newlines\tand tabs'
    expect(decryptSecret(encryptSecret(weird))).toBe(weird)
  })
})

// ============================================
// ENVELOPE FORMAT
// ============================================

describe('encrypted envelope format', () => {
  test("output starts with 'enc:v1:' and has exactly 5 colon-separated segments", () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const encrypted = encryptSecret(SECRET)
    expect(encrypted.startsWith('enc:v1:')).toBe(true)
    expect(encrypted.split(':')).toHaveLength(5) // enc, v1, iv, tag, ciphertext
  })

  test('ciphertext never contains the plaintext', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const encrypted = encryptSecret(SECRET)
    expect(encrypted).not.toContain(SECRET)
    expect(encrypted).not.toContain('AAHfiqksKZ8WmoQTs')
  })

  test('empty string encrypts to empty string (nothing to protect)', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    expect(encryptSecret('')).toBe('')
    expect(decryptSecret('')).toBe('')
  })

  test('isEncrypted() recognises the envelope and rejects plaintext', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    expect(isEncrypted(encryptSecret(SECRET))).toBe(true)
    expect(isEncrypted(SECRET)).toBe(false)
    expect(isEncrypted('')).toBe(false)
    expect(isEncrypted('enc:v1:truncated')).toBe(true) // prefix is enough to be "encrypted"
  })
})

// ============================================
// BACKWARD COMPATIBILITY (legacy plaintext rows)
// ============================================

describe('decryptSecret — legacy plaintext passthrough', () => {
  test('plaintext values are returned UNCHANGED (migration path for existing rows)', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    expect(decryptSecret('legacy-plaintext-bot-token')).toBe('legacy-plaintext-bot-token')
    expect(decryptSecret(WEBHOOK)).toBe(WEBHOOK)
  })

  test('encrypting an already-encrypted value is a no-op (idempotent write path)', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const once = encryptSecret(SECRET)
    expect(encryptSecret(once)).toBe(once)
  })
})

// ============================================
// TAMPER DETECTION (GCM authentication)
// ============================================

describe('decryptSecret — tamper detection', () => {
  test('flipping one ciphertext char yields "" without throwing', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const encrypted = encryptSecret(SECRET)
    const parts = encrypted.split(':')
    parts[4] = flipOneChar(parts[4] ?? '')
    const tampered = parts.join(':')
    expect(tampered).not.toBe(encrypted)
    let result = ''
    expect(() => { result = decryptSecret(tampered) }).not.toThrow()
    expect(result).toBe('')
  })

  test('flipping one auth-tag char yields "" without throwing', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const encrypted = encryptSecret(SECRET)
    const parts = encrypted.split(':')
    parts[3] = flipOneChar(parts[3] ?? '')
    expect(decryptSecret(parts.join(':'))).toBe('')
  })

  test('malformed envelopes (wrong segment count / lengths) yield ""', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    expect(decryptSecret('enc:v1:onlyonesegment')).toBe('')
    expect(decryptSecret('enc:v1:')).toBe('')
    expect(decryptSecret('enc:v1:a:b:c:d')).toBe('')
    expect(decryptSecret('enc:v1:short:short:short')).toBe('')
  })
})

// ============================================
// RANDOM IV
// ============================================

describe('random IV per encryption', () => {
  test('two encryptions of the same plaintext differ (but both decrypt back)', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const first = encryptSecret(SECRET)
    const second = encryptSecret(SECRET)
    expect(first).not.toBe(second)
    expect(decryptSecret(first)).toBe(SECRET)
    expect(decryptSecret(second)).toBe(SECRET)
  })
})

// ============================================
// KEY MISMATCH
// ============================================

describe('decryptSecret — wrong key', () => {
  test('value encrypted under key A is undecryptable under key B ("" not a throw)', () => {
    process.env[ENV_KEY] = randomBytes(32).toString('hex')
    const encrypted = encryptSecret(SECRET)
    process.env[ENV_KEY] = randomBytes(32).toString('hex') // rotate to a different key
    expect(decryptSecret(encrypted)).toBe('')
  })

  test('hex key with a wrong length is rejected (falls back, so round-trip still works)', () => {
    process.env[ENV_KEY] = 'a'.repeat(63) // 63 hex chars — not 64
    expect(decryptSecret(encryptSecret(SECRET))).toBe(SECRET)
  })
})
