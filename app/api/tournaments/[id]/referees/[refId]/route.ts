/**
 * app/api/tournaments/[id]/referees/[refId]/route.ts
 *
 * DELETE — Remove a specific referee, their sessions and push subscriptions,
 * and their completed calls. Any of the referee's incomplete (acknowledged)
 * calls are reopened to the shared unanswered queue so another referee can pick
 * them up. Admin or owning director only.
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta, deleteReferee } from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';
import { extractBearerToken } from '@/lib/auth/bearer';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; refId: string }> },
): Promise<NextResponse> {
  try {
    const { id, refId } = await params;
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

    const deleted = await deleteReferee(id, refId);
    return NextResponse.json({ tournamentId: id, refereeId: refId, deleted }, { status: 200 });
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
