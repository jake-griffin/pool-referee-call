/**
 * lib/auth/password.ts
 *
 * Password hashing utilities for director accounts.
 *
 * Uses Node's built-in scrypt (a deliberately slow, memory-hard KDF) so no
 * third-party dependency is required. Each password gets a unique random salt.
 * The stored format is:
 *
 *   scrypt:<N>:<r>:<p>:<saltHex>:<hashHex>
 *
 * The cost parameters are embedded so hashes remain verifiable even if the
 * defaults change later. Verification uses a constant-time comparison.
 */

import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
  type ScryptOptions,
} from 'crypto';

/**
 * Promise wrapper around crypto.scrypt that supports the options argument.
 * (util.promisify picks the 3-arg overload, so we wrap manually.)
 */
function scrypt(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// scrypt cost parameters. N must be a power of two. These give a strong hash
// while staying well within Node's default maxmem for keylen 64.
const N = 16384; // CPU/memory cost
const r = 8; // block size
const p = 1; // parallelization
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * Hashes a plaintext password with a fresh random salt.
 * Returns a self-describing string safe to store in the database.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string.');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored hash produced by hashPassword.
 * Returns false (never throws) for malformed or non-matching input.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  try {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;

    const parts = stored.split(':');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const nParam = parseInt(parts[1], 10);
    const rParam = parseInt(parts[2], 10);
    const pParam = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');

    if (
      !Number.isFinite(nParam) ||
      !Number.isFinite(rParam) ||
      !Number.isFinite(pParam) ||
      salt.length === 0 ||
      expected.length === 0
    ) {
      return false;
    }

    const derived = await scrypt(password, salt, expected.length, {
      N: nParam,
      r: rParam,
      p: pParam,
    });

    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Anti-enumeration + constant-time helpers
// ---------------------------------------------------------------------------

let _dummyHash: string | null = null;

/**
 * Returns a real, full-cost dummy password hash (same scrypt cost and 64-byte
 * key length as genuine hashes). Verify an incoming password against this when
 * no matching user exists so the login timing is indistinguishable from the
 * "known user, wrong password" path. Computed once and cached.
 */
export async function getDummyPasswordHash(): Promise<string> {
  if (_dummyHash === null) {
    // A fixed, non-guessable input — its plaintext is irrelevant since no real
    // password will ever match it; only the derivation cost matters.
    _dummyHash = await hashPassword('dummy-password-for-timing-equalization');
  }
  return _dummyHash;
}

/**
 * Constant-time comparison of two secrets provided as strings (e.g. the
 * ADMIN_SECRET). Hashes both sides to fixed length first so the comparison
 * doesn't leak length, and returns false on any error.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  try {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
  } catch {
    return false;
  }
}
