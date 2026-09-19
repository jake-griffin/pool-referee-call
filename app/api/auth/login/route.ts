/**
 * app/api/auth/login/route.ts
 *
 * POST — Log in as a Tournament Director or as the global admin, issuing a
 * global session cookie (`gsession`).
 *
 * Director login:  { email, password }
 * Admin login:     { adminSecret }   (matches process.env.ADMIN_SECRET)
 *
 * On success, sets the gsession cookie and returns the session identity
 * (never a password hash).
 */

import { NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/auth/password';
import { issueGlobalSession } from '@/lib/auth/session';
import { getDirectorByEmail } from '@/lib/db/queries';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    // --- Admin login via shared secret ---
    if (typeof body.adminSecret === 'string' && body.adminSecret.length > 0) {
      const adminSecret = process.env.ADMIN_SECRET;
      if (adminSecret && body.adminSecret === adminSecret) {
        const { cookieHeader } = await issueGlobalSession({
          role: 'admin',
          entityId: 'admin',
          displayName: 'Admin',
        });
        const res = NextResponse.json(
          { role: 'admin', displayName: 'Admin' },
          { status: 200 },
        );
        res.headers.set('Set-Cookie', cookieHeader);
        return res;
      }
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    // --- Director login via email + password ---
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return NextResponse.json(
        { message: 'Email and password are required.' },
        { status: 400 },
      );
    }

    const director = await getDirectorByEmail(email);
    // Always run verification to reduce user-enumeration timing differences.
    const ok = director
      ? await verifyPassword(password, director.passwordHash)
      : await verifyPassword(password, 'scrypt:16384:8:1:00:00');

    if (!director || !ok) {
      return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
    }

    const { cookieHeader } = await issueGlobalSession({
      role: 'director',
      entityId: director.directorId,
      displayName: director.name,
    });

    const res = NextResponse.json(
      { role: 'director', directorId: director.directorId, displayName: director.name },
      { status: 200 },
    );
    res.headers.set('Set-Cookie', cookieHeader);
    return res;
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
