/**
 * app/api/tournaments/[id]/owner/route.ts
 *
 * PATCH — Assign or clear a tournament's owning director. Admin only.
 *
 * Body:
 *   { directorId: "d_..." }  → assign the tournament to that director
 *   { directorId: null }     → un-assign (return to admin-only ownerless state)
 *
 * Works for any tournament, including ones created before director accounts
 * existed. Admin auth is via the ADMIN_SECRET Bearer header or an admin global
 * session cookie.
 */

import { NextResponse } from 'next/server';
import { constantTimeEqual } from '@/lib/auth/password';
import { getGlobalSession } from '@/lib/auth/session';
import {
  getTournamentMeta,
  getDirectorById,
  assignTournamentOwner,
} from '@/lib/db/queries';

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

    // directorId must be a non-empty string (assign) or null (un-assign).
    const raw = body.directorId;
    if (raw !== null && (typeof raw !== 'string' || raw.trim() === '')) {
      return NextResponse.json(
        { message: 'directorId must be a director id string, or null to un-assign.' },
        { status: 400 },
      );
    }
    const directorId = raw === null ? null : (raw as string).trim();

    // Tournament must exist.
    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json({ message: 'Tournament not found.' }, { status: 404 });
    }

    // When assigning, the target director must exist.
    if (directorId) {
      const director = await getDirectorById(directorId);
      if (!director) {
        return NextResponse.json({ message: 'Director not found.' }, { status: 404 });
      }
    }

    await assignTournamentOwner(id, directorId);

    return NextResponse.json(
      { tournamentId: id, ownerId: directorId },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
