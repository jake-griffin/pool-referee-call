/**
 * app/api/tournaments/[id]/close/route.ts
 *
 * POST — Close a tournament (requires admin token).
 *
 * Requirements: 13.1, 13.5
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta, closeTournament } from '@/lib/db/queries';
import { verifyToken } from '@/lib/auth/tokens';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Extract adminToken from body JSON or Authorization header
    const adminToken = await extractAdminToken(request);
    if (!adminToken) {
      return NextResponse.json(
        { message: 'Unauthorized. A valid admin token is required.' },
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
    const isValid = verifyToken(adminToken, tournament.adminTokenHash);
    if (!isValid) {
      return NextResponse.json(
        { message: 'Unauthorized. A valid admin token is required.' },
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
