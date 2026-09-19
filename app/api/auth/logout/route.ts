/**
 * app/api/auth/logout/route.ts
 *
 * POST — Clear the global session cookie. Always succeeds.
 */

import { NextResponse } from 'next/server';
import { clearGlobalSessionCookie, revokeGlobalSession } from '@/lib/auth/session';

export async function POST(request: Request): Promise<NextResponse> {
  // Revoke the session server-side so a retained/stolen cookie can't be reused,
  // then clear the cookie on the client. Best-effort: always clears the cookie.
  try {
    await revokeGlobalSession(request);
  } catch {
    // Ignore revocation failures — clearing the cookie is the minimum guarantee.
  }
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.headers.set('Set-Cookie', clearGlobalSessionCookie());
  return res;
}
