/**
 * app/api/tournaments/[id]/archive/route.ts
 *
 * GET — Returns the full tournament archive (requires admin token, tournament must be closed).
 *
 * Requirements: 14.1, 14.2, 14.4, 14.5
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta, queryAllTournamentItems } from '@/lib/db/queries';
import { verifyToken } from '@/lib/auth/tokens';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Extract adminToken from Authorization Bearer header
    const adminToken = extractAdminToken(request);
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

    // Tournament must be closed before viewing the archive
    if (tournament.status !== 'closed') {
      return NextResponse.json(
        { message: 'Tournament must be closed before viewing the archive.' },
        { status: 403 },
      );
    }

    // Fetch all tournament items
    const allItems = await queryAllTournamentItems(id);

    return NextResponse.json(
      {
        tournament: {
          name: tournament.name,
          status: tournament.status,
          createdAt: tournament.createdAt,
        },
        calls: allItems.calls,
        referees: allItems.referees,
        teams: allItems.teams,
      },
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
 * Extracts adminToken from Authorization Bearer header.
 * Returns null if the header is missing or malformed.
 */
function extractAdminToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
    return parts[1];
  }

  return null;
}
