/**
 * app/api/tournaments/[id]/close/route.ts
 *
 * POST — Close a tournament (requires admin token).
 *
 * Requirements: 13.1, 13.5
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta, closeTournament } from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Extract the (optional) legacy admin token from body JSON or header.
    const adminToken = await extractAdminToken(request);

    // Fetch tournament metadata
    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json(
        { message: 'Tournament not found.' },
        { status: 404 },
      );
    }

    // Authorize: owning director / admin session, or legacy admin token.
    const allowed = await authorizeTournamentManagement(request, tournament, adminToken);
    if (!allowed) {
      return NextResponse.json(
        { message: 'Unauthorized. You do not have access to this tournament.' },
        { status: 401 },
      );
    }

    // Close the tournament
    await closeTournament(id);

    return NextResponse.json(
      { tournamentId: id, status: 'closed' },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}

/**
 * Extracts adminToken from request body JSON or Authorization Bearer header.
 * Returns null if neither source provides a token.
 */
async function extractAdminToken(request: Request): Promise<string | null> {
  // Try Authorization header first
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      return parts[1];
    }
  }

  // Try request body JSON
  try {
    const body = await request.json();
    if (body && typeof body.adminToken === 'string' && body.adminToken) {
      return body.adminToken;
    }
  } catch {
    // Body is not valid JSON or empty — fall through
  }

  return null;
}
