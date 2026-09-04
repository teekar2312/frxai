/**
 * FRxAI — AES-256-GCM field-level encryption for secrets at rest
 * ================================================================
 * Encrypts sensitive NotificationConfig fields (Telegram botToken,
 * Discord webhookUrl) BEFORE they are persisted to SQLite, so a leaked
 * database file does not leak credentials.
 *
 * Envelope format:  enc:v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 *   - AES-256-GCM (authenticated encryption)
 *   - 12-byte random IV + 16-byte auth tag per value
 *   - random IV → encrypting the same plaintext twice yields different
 *     ciphertexts (no equality leakage across rows)
 *
 * Key source — env NOTIFICATION_ENCRYPTION_KEY (exactly 32 bytes):
 *   - 64-char hex string    (e.g. `openssl rand -hex 32`)
 *   - 44-char base64 string (e.g. `openssl rand -base64 32`)
 *   - missing / empty / invalid → STABLE derived dev fallback key
 *     (sha256 of a constant) + a ONE-TIME console.warn. Never crashes on
 *     a missing key; production MUST set a real key because fallback-
 *     encrypted values are readable by anyone holding the source. Note
 *     that changing the key later makes previously stored values
 *     undecryptable (decryptSecret returns '' — never throws).
 *
 * Backward compatibility (the migration path): values that do NOT start
 * with `enc:v1:` are legacy plaintext rows — decryptSecret returns them
 * UNCHANGED. Re-saving a channel through updateChannelConfig transparently
 * upgrades the stored value to encrypted form.
 *
 * This module reads process.env directly (not the cached env() snapshot)
 * so key rotation and tests take effect immediately per call.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const DEV_FALLBACK_SEED = 'frxai::notification-encryption::dev-fallback::v1'

// ============================================
// KEY RESOLUTION
// ============================================

/** Module-level flags — each fallback notice fires at most once per process. */
let devFallbackWarned = false
let invalidKeyReported = false
/** Cached derived dev fallback key (constant for the process lifetime). */
let devFallbackKey: Buffer | null = null

function getDevFallbackKey(): Buffer {
  if (!devFallbackKey) {
    devFallbackKey = createHash('sha256').update(DEV_FALLBACK_SEED).digest()
  }
  if (!devFallbackWarned) {
    devFallbackWarned = true
    console.warn(
      '[secret-crypto] NOTIFICATION_ENCRYPTION_KEY is not set — using a derived DEV fallback key. ' +
        'Set a 32-byte key (64-char hex or 44-char base64, e.g. `openssl rand -hex 32`) in production; ' +
        'fallback-encrypted values are NOT secure, and rotating the key later makes them undecryptable.'
    )
  }
  return devFallbackKey
}

/** Parse a user-supplied key: 64-char hex or base64 encoding exactly 32 bytes. */
function parseKeyMaterial(raw: string): Buffer | null {
  const value = raw.trim()
  if (value.length === 64 && /^[0-9a-fA-F]+$/.test(value)) {
    return Buffer.from(value, 'hex')
  }
  // 32 bytes → 43–44 base64 chars (+ optional '=' padding); decode leniently, then verify length
  if (/^[A-Za-z0-9+/]{43,44}={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.length === 32) return decoded
  }
  return null
}

/** Resolve the active 32-byte key from env, falling back to the dev-derived key. */
function resolveKey(): Buffer {
  const raw = process.env.NOTIFICATION_ENCRYPTION_KEY
  if (raw !== undefined && raw.trim() !== '') {
    const key = parseKeyMaterial(raw)
    if (key) return key
    if (!invalidKeyReported) {
      invalidKeyReported = true
      console.error(
        '[secret-crypto] NOTIFICATION_ENCRYPTION_KEY is set but invalid ' +
          '(expected 64-char hex or 44-char base64 for 32 bytes) — falling back to the derived DEV key'
      )
    }
  }
  return getDevFallbackKey()
}

// ============================================
// PUBLIC API
// ============================================

/** True when the value uses the encrypted envelope format (`enc:v1:`). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

/**
 * Encrypt a secret with AES-256-GCM → `enc:v1:<iv>:<tag>:<ct>` (base64 segments).
 * - '' → '' (nothing to encrypt; empty stays empty)
 * - already-encrypted input is returned unchanged (idempotent — protects
 *   write paths that may receive a value twice)
 */
export function encryptSecret(plaintext: string): string {
  if (plaintext === '' || isEncrypted(plaintext)) return plaintext
  const key = resolveKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

/**
 * Decrypt a secret. NEVER throws.
 * - legacy plaintext (no `enc:v1:` prefix) → returned UNCHANGED (backward compat)
 * - malformed envelope / wrong key / tampered value (GCM auth failure) → ''
 *   + console.error (the caller treats '' as "credential unusable")
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value

  const parts = value.slice(PREFIX.length).split(':')
  if (parts.length !== 3) {
    console.error(`[secret-crypto] decrypt failed: malformed envelope — expected iv:tag:ciphertext, got ${parts.length} segment(s)`)
    return ''
  }
  const [ivB64, tagB64, ctB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    console.error(`[secret-crypto] decrypt failed: malformed envelope — iv ${iv.length}B (want ${IV_LENGTH}), tag ${tag.length}B (want ${TAG_LENGTH})`)
    return ''
  }

  try {
    const key = resolveKey()
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString('utf8')
  } catch (err) {
    console.error(`[secret-crypto] decrypt failed (wrong key or tampered value): ${err instanceof Error ? err.message : String(err)}`)
    return ''
  }
}
