/**
 * app/api/calls/[callId]/cancel/route.ts
 *
 * POST — Cancel a call. Allowed while the call is unanswered or acknowledged.
 *
 * Authorization (either):
 *   - the player who owns the call's team (player session), or
 *   - an admin / owning director (global session or legacy admin token).
 *
 * Cancelled calls leave the queues and appear in recent activity.
 */

import { NextResponse } from 'next/server';
import { getSession, AuthError } from '@/lib/auth/session';
import { getTournamentMeta } from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';
import { extractBearerToken } from '@/lib/auth/bearer';
import { cancelCall } from '@/lib/calls/manager';
import {
  TournamentClosedError,
  WrongRefereeError,
  WrongStatusError,
  CallNotFoundError,
} from '@/lib/calls/errors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callId: string }> },
): Promise<NextResponse> {
  try {
    const { callId } = await params;

    // Parse body once (tournamentId required; optional legacy admin token).
    let body: { tournamentId?: unknown; adminToken?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const tournamentId = typeof body.tournamentId === 'string' ? body.tournamentId : '';
    if (!tournamentId) {
      return NextResponse.json({ message: 'tournamentId is required.' }, { status: 400 });
    }

    // Try player session first (scopes cancel to their own team).
    const playerSession = await getSession(request, tournamentId);
    let expectedTeamId: string | undefined;

    if (playerSession && playerSession.role === 'player') {
      expectedTeamId = playerSession.entityId;
    } else {
      // Not a player — must be an admin/owning director (or legacy token).
      const tournament = await getTournamentMeta(tournamentId);
      if (!tournament) {
        return NextResponse.json({ message: 'Tournament not found.' }, { status: 404 });
      }
      const bearer = extractBearerToken(request);
      const adminToken =
        bearer ?? (typeof body.adminToken === 'string' ? body.adminToken : null);
      const allowed = await authorizeTournamentManagement(request, tournament, adminToken);
      if (!allowed) {
        return NextResponse.json(
          { message: 'You do not have permission to cancel this call.' },
          { status: 403 },
        );
      }
      // Admin cancels any call in the tournament (no team scoping).
    }

    const record = await cancelCall(callId, tournamentId, { expectedTeamId });

    return NextResponse.json(
      { callId: record.callId, status: record.status, cancelledAt: record.cancelledAt },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode });
    }
    if (error instanceof TournamentClosedError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof WrongRefereeError) {
      // Reused as "not your call" ownership failure.
      return NextResponse.json(
        { message: 'You can only cancel your own call.' },
        { status: 403 },
      );
    }
    if (error instanceof WrongStatusError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    if (error instanceof CallNotFoundError) {
      return NextResponse.json({ message: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
