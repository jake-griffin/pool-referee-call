/**
 * app/api/auth/logout/route.ts
 *
 * POST — Clear the global session cookie. Always succeeds.
 */

import { NextResponse } from 'next/server';
import { clearGlobalSessionCookie } from '@/lib/auth/session';

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.headers.set('Set-Cookie', clearGlobalSessionCookie());
  return res;
}
