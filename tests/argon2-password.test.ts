import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from '@/lib/auth/password';

// Note: This test requires @node-rs/argon2 which is a native module.
// It will work in the test environment if the module is properly installed.

describe('Argon2id Password Hashing', () => {
  describe('hashPassword', () => {
    it('hashes a password successfully', async () => {
      const hash = await hashPassword('testpassword123');
      expect(hash).toBeTruthy();
      expect(hash).toMatch(/^\$argon2/);
    }, 30_000); // 30s timeout for argon2

    it('produces different hashes for the same password', async () => {
      const hash1 = await hashPassword('samepassword');
      const hash2 = await hashPassword('samepassword');
      expect(hash1).not.toBe(hash2);
    }, 30_000);

    it('produces hash starting with $argon2id$', async () => {
      const hash = await hashPassword('mypassword');
      expect(hash.startsWith('$argon2id$')).toBe(true);
    }, 30_000);
  });

  describe('verifyPassword', () => {
    it('verifies a correct password against argon2 hash', async () => {
      const hash = await hashPassword('correctpassword');
      const result = await verifyPassword(hash, 'correctpassword');
      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(false);
    }, 30_000);

    it('rejects an incorrect password against argon2 hash', async () => {
      const hash = await hashPassword('correctpassword');
      const result = await verifyPassword(hash, 'wrongpassword');
      expect(result.valid).toBe(false);
    }, 30_000);

    it('detects bcrypt hash as needing rehash on successful verify', async () => {
      // Real bcrypt hash for 'testpass'
      const bcryptHash = '$2b$12$3kTAhd/5aW0yt.Mfl.qd9uSirMXTuumgJOAXvoNO3OQ1ibhvkzRt2';
      const result = await verifyPassword(bcryptHash, 'testpass');
      expect(result.valid).toBe(true);
      // needsRehash is true when bcrypt verification succeeds (should upgrade to argon2)
      expect(result.needsRehash).toBe(true);
    });

    it('does not flag argon2 hash as needing rehash', async () => {
      const hash = await hashPassword('testpassword');
      expect(needsRehash(hash)).toBe(false);
    }, 30_000);
  });
});
