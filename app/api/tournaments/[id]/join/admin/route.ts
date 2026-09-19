/**
 * app/api/tournaments/[id]/join/admin/route.ts
 *
 * POST — Admin joins a tournament session using the admin token.
 * This creates a session cookie so the admin can poll the state endpoint.
 *
 * Requirements: 9.1 (admin needs session to view state)
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta } from '@/lib/db/queries';
import { issueSession, getGlobalSession } from '@/lib/auth/session';
import { canManageTournament } from '@/lib/auth/tournament-access';
import { verifyToken } from '@/lib/auth/tokens';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Body is optional now — a director/admin global session can authorize
    // without an admin token. Parse leniently.
    let adminToken: string | undefined;
    try {
      const body = (await request.json()) as { adminToken?: string };
      if (typeof body?.adminToken === 'string') adminToken = body.adminToken;
    } catch {
      // No/!JSON body — fine when a global session authorizes.
    }

    // Fetch tournament metadata
    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json(
        { message: 'Tournament not found.' },
        { status: 404 },
      );
    }

    // Authorize: owning director / admin global session, or a valid admin token.
    const globalSession = await getGlobalSession(request);
    const authorized =
      canManageTournament(globalSession, tournament) ||
      (!!adminToken && verifyToken(adminToken, tournament.adminTokenHash));

    if (!authorized) {
      return NextResponse.json(
        { message: 'Unauthorized. You do not have access to this tournament.' },
        { status: 401 },
      );
    }

    // Issue a per-tournament admin cookie session (used by the state endpoint).
    const { cookieHeader } = await issueSession({
      tournamentId: id,
      role: 'admin',
      entityId: 'admin',
      displayName: 'Admin',
    });

    const response = NextResponse.json(
      { tournamentId: id, role: 'admin' },
      { status: 200 },
    );
    response.headers.set('Set-Cookie', cookieHeader);
    return response;
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
