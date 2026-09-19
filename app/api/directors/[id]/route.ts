/**
 * app/api/directors/[id]/route.ts
 *
 * PATCH — Enable or disable a director account (admin only). A disabled
 * director cannot sign in. Revoking access is done by disabling the account;
 * existing global sessions still expire/revoke via the session lifecycle.
 *
 * Body: { disabled: boolean }
 */

import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/password';
import { getGlobalSession } from '@/lib/auth/session';
import { setDirectorDisabled, getDirectorById } from '@/lib/db/queries';

async function isAdmin(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET;
  if (authHeader && adminSecret) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer' && constantTimeEqual(parts[1], adminSecret)) {
      return true;
    }
  }
  const session = await getGlobalSession(request);
  return session?.role === 'admin';
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json(
        { message: 'Unauthorized. Admin access is required.' },
        { status: 401 },
      );
    }

    const { id } = await params;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    if (typeof body.disabled !== 'boolean') {
      return NextResponse.json(
        { message: 'Body must include a boolean "disabled" field.' },
        { status: 400 },
      );
    }

    const director = await getDirectorById(id);
    if (!director) {
      return NextResponse.json({ message: 'Director not found.' }, { status: 404 });
    }

    await setDirectorDisabled(id, body.disabled);

    return NextResponse.json(
      { directorId: id, disabled: body.disabled },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
