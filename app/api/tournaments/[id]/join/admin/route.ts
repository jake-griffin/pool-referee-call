/**
 * app/api/tournaments/[id]/join/admin/route.ts
 *
 * POST — Admin joins a tournament session using the admin token.
 * This creates a session cookie so the admin can poll the state endpoint.
 *
 * Requirements: 9.1 (admin needs session to view state)
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth/tokens';
import { getTournamentMeta } from '@/lib/db/queries';
import { issueSession } from '@/lib/auth/session';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: 'Invalid JSON body.' },
        { status: 400 },
      );
    }

    const { adminToken } = body as { adminToken?: string };

    if (!adminToken) {
      return NextResponse.json(
        { message: 'Admin token is required.' },
        { status: 401 },
      );
    }

    // Fetch tournament metadata
    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json(
        { message: 'Tournament not found.' },
        { status: 404 },
      );
    }

    // Verify admin token
    if (!verifyToken(adminToken, tournament.adminTokenHash)) {
      return NextResponse.json(
        { message: 'Invalid admin token.' },
        { status: 401 },
      );
    }

    // Issue an admin session
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
