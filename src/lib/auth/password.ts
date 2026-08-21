import { hash, verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  algorithm: 2 as const, // Argon2id
};

/** Hash a new password with Argon2id */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Verify password — supports both Argon2id (new) and bcrypt (legacy) hashes */
export async function verifyPassword(storedHash: string, inputPassword: string): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (storedHash.startsWith('$argon2')) {
    const valid = await verify(storedHash, inputPassword);
    return { valid, needsRehash: false };
  }
  // Legacy bcrypt hash
  const valid = await bcrypt.compare(inputPassword, storedHash);
  return { valid, needsRehash: valid };
}

/** Check if a hash needs rehashing (is bcrypt, not argon2) */
export function needsRehash(storedHash: string): boolean {
  return !storedHash.startsWith('$argon2');
}
