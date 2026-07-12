// Token utilities — SHA-256 hashing and UUID generation
// Full implementation in task 3.1

import { createHash, randomUUID, timingSafeEqual } from 'crypto';

/** Generates a cryptographically random UUID token. */
export function generateToken(): string {
  return randomUUID();
}

/**
 * Produces a hex-encoded SHA-256 hash prefixed with "sha256:".
 * The prefix ensures stored value can never equal the raw token (Property 8).
 */
export function hashToken(token: string): string {
  return 'sha256:' + createHash('sha256').update(token).digest('hex');
}

/**
 * Validates a plaintext token against its stored hash in constant time
 * to prevent timing attacks.
 */
export function verifyToken(plaintext: string, stored: string): boolean {
  const expected = hashToken(plaintext);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(stored));
  } catch {
    return false;
  }
}
