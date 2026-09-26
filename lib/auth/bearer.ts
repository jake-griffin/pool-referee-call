/**
 * lib/auth/bearer.ts
 *
 * Small helper to extract a Bearer token from a request's Authorization header.
 * Used by per-tournament management routes that accept the legacy admin token.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
    return parts[1];
  }
  return null;
}
