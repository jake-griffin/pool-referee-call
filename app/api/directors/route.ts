/**
 * app/api/directors/route.ts
 *
 * POST — Create a Tournament Director account. Invite-only: requires the global
 * admin, authenticated either via the ADMIN_SECRET Bearer header or an admin
 * global session cookie.
 *
 * Directors own the tournaments they create. Their password is hashed with
 * scrypt and never returned.
 */

import { NextResponse } from 'next/server';
import { generateToken } from '@/lib/auth/tokens';
import { hashPassword } from '@/lib/auth/password';
import { getGlobalSession } from '@/lib/auth/session';
import { putDirector, getDirectorByEmail } from '@/lib/db/queries';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

async function isAdmin(request: Request): Promise<boolean> {
  // ADMIN_SECRET bearer header
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET;
  if (authHeader && adminSecret) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1] === adminSecret) {
      return true;
    }
  }
  // Admin global session cookie
  const session = await getGlobalSession(request);
  return session?.role === 'admin';
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json(
        { message: 'Unauthorized. Admin access is required to create directors.' },
        { status: 401 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ message: 'A valid email is required.' }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ message: 'Name is required.' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 },
      );
    }

    // Reject duplicate emails
    const existing = await getDirectorByEmail(email);
    if (existing) {
      return NextResponse.json(
        { message: 'A director with that email already exists.' },
        { status: 409 },
      );
    }

    const directorId = `d_${generateToken()}`;
    const passwordHash = await hashPassword(password);
    const createdAt = new Date().toISOString();

    await putDirector({ directorId, email, name, passwordHash, createdAt });

    // Never return the password hash.
    return NextResponse.json(
      { directorId, email, name, createdAt },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
