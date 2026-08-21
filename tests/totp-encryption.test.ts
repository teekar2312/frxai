import { describe, it, expect } from 'vitest';
import { encryptTotpSecret, decryptTotpSecret } from '@/lib/auth/totp-encryption';

describe('TOTP Secret Encryption (AES-256-GCM)', () => {
  const originalKey = process.env.TOTP_ENCRYPTION_KEY;

  beforeAll(() => {
    // Set a test encryption key (64 hex chars = 32 bytes)
    process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterAll(() => {
    // Restore original
    if (originalKey) {
      process.env.TOTP_ENCRYPTION_KEY = originalKey;
    } else {
      delete (process.env as Record<string, string | undefined>).TOTP_ENCRYPTION_KEY;
    }
  });

  it('encrypts and decrypts a TOTP secret correctly', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptTotpSecret(secret);
    const decrypted = decryptTotpSecret(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertext for the same plaintext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted1 = encryptTotpSecret(secret);
    const encrypted2 = encryptTotpSecret(secret);
    // Due to random IV, ciphertexts should differ
    expect(encrypted1).not.toBe(encrypted2);
    // But both should decrypt to the same secret
    expect(decryptTotpSecret(encrypted1)).toBe(secret);
    expect(decryptTotpSecret(encrypted2)).toBe(secret);
  });

  it('encrypted format is iv:authTag:ciphertext', () => {
    const encrypted = encryptTotpSecret('TESTSECRET123');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    // IV should be 32 hex chars (16 bytes)
    expect(parts[0]).toHaveLength(32);
    // Auth tag should be 32 hex chars (16 bytes)
    expect(parts[1]).toHaveLength(32);
    // Ciphertext should be non-empty
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('throws error for invalid encrypted format', () => {
    expect(() => decryptTotpSecret('invalid')).toThrow('Invalid encrypted secret format');
  });

  it('handles long TOTP secrets', () => {
    const secret = 'A'.repeat(100);
    const encrypted = encryptTotpSecret(secret);
    expect(decryptTotpSecret(encrypted)).toBe(secret);
  });

  it('throws error when TOTP_ENCRYPTION_KEY is not set', () => {
    const saved = process.env.TOTP_ENCRYPTION_KEY;
    delete (process.env as Record<string, string | undefined>).TOTP_ENCRYPTION_KEY;
    expect(() => encryptTotpSecret('test')).toThrow('TOTP_ENCRYPTION_KEY');
    process.env.TOTP_ENCRYPTION_KEY = saved;
  });
});
