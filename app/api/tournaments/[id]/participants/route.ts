/**
 * app/api/tournaments/[id]/participants/route.ts
 *
 * DELETE — Clear a tournament's participants and history: all referee and team
 * records, calls, join sessions, and push subscriptions. The tournament itself
 * (name, tables, tokens, owner) is KEPT, so the same join links keep working —
 * this is for wiping test data before the real event begins.
 *
 * Auth: admin or the owning director (or the legacy per-tournament admin token).
 * This is destructive and irreversible; the UI requires an explicit confirm.
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta, clearTournamentData } from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // The legacy admin token may arrive via the Authorization header or body.
    // Parse the body once (optional) so authorizeTournamentManagement can use it.
    let adminToken: string | null = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
        adminToken = parts[1];
      }
    }
    if (!adminToken) {
      try {
        const body = (await request.json()) as { adminToken?: string };
        if (typeof body?.adminToken === 'string') adminToken = body.adminToken;
      } catch {
        // no/!JSON body — fine when a session authorizes
      }
    }

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

    const cleared = await clearTournamentData(id);

    return NextResponse.json(
      { tournamentId: id, cleared },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
