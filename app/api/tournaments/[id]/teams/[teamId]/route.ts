/**
 * app/api/tournaments/[id]/teams/[teamId]/route.ts
 *
 * DELETE — Remove a specific team/player and all of its calls (including
 * completed ones) and its join session. Admin or owning director only.
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta, deleteTeam } from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';
import { extractBearerToken } from '@/lib/auth/bearer';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> },
): Promise<NextResponse> {
  try {
    const { id, teamId } = await params;
    const adminToken = extractBearerToken(request);

    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json({ message: 'Tournament not found.' }, { status: 404 });
    }

    const allowed = await authorizeTournamentManagement(request, tournament, adminToken);
    if (!allowed) {
      return NextResponse.json(
        { message: 'Unauthorized. You do not have access to this tournament.' },
        { status: 401 },
      );
    }

    const deleted = await deleteTeam(id, teamId);
    return NextResponse.json({ tournamentId: id, teamId, deleted }, { status: 200 });
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
