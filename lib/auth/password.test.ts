/**
 * Unit tests for scrypt-based password hashing.
 */

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('s3cret-passw0rd');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces a self-describing scrypt format with a unique salt', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a.startsWith('scrypt:')).toBe(true);
    // Different salts => different stored hashes for the same password.
    expect(a).not.toBe(b);
    // Both still verify.
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('returns false for malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'sha256:deadbeef')).toBe(false);
  });

  it('throws when hashing an empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });
});
