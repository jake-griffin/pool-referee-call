/**
 * app/api/tournaments/[id]/admin/calls/route.ts
 *
 * POST — Admin/owning-director places a call on behalf of a team.
 *
 * Body: {
 *   tableNumber: number,
 *   teamId?: string,        // an existing team
 *   newTeamName?: string,   // OR create a placeholder team with this name
 *   adminToken?: string,    // legacy fallback auth
 * }
 *
 * Exactly one of teamId / newTeamName must be supplied.
 */

import { NextResponse } from 'next/server';
import {
  getTournamentMeta,
  createPlaceholderTeam,
  queryAllTournamentItems,
} from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';
import { extractBearerToken } from '@/lib/auth/bearer';
import { createCall } from '@/lib/calls/manager';
import {
  TournamentClosedError,
  InvalidTableError,
  MaxCallsError,
} from '@/lib/calls/errors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    let body: {
      tableNumber?: unknown;
      teamId?: unknown;
      newTeamName?: unknown;
      adminToken?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json({ message: 'Tournament not found.' }, { status: 404 });
    }

    const bearer = extractBearerToken(request);
    const adminToken = bearer ?? (typeof body.adminToken === 'string' ? body.adminToken : null);
    const allowed = await authorizeTournamentManagement(request, tournament, adminToken);
    if (!allowed) {
      return NextResponse.json(
        { message: 'Unauthorized. You do not have access to this tournament.' },
        { status: 401 },
      );
    }

    const tableNumber = body.tableNumber;
    if (typeof tableNumber !== 'number' || !Number.isFinite(tableNumber)) {
      return NextResponse.json(
        { message: 'tableNumber must be a valid number.' },
        { status: 400 },
      );
    }

    const teamId = typeof body.teamId === 'string' ? body.teamId.trim() : '';
    const newTeamName = typeof body.newTeamName === 'string' ? body.newTeamName.trim() : '';

    if ((!teamId && !newTeamName) || (teamId && newTeamName)) {
      return NextResponse.json(
        { message: 'Provide exactly one of teamId or newTeamName.' },
        { status: 400 },
      );
    }

    // Resolve the acting team: existing id, or a new placeholder.
    let resolvedTeamId = teamId;
    let resolvedTeamName = '';

    if (newTeamName) {
      const created = await createPlaceholderTeam(id, newTeamName);
      resolvedTeamId = created.teamId;
      resolvedTeamName = created.name;
    } else {
      // Look up the existing team's name.
      const all = await queryAllTournamentItems(id);
      const team = all.teams.find((t) => t.teamId === teamId);
      if (!team) {
        return NextResponse.json({ message: 'Team not found.' }, { status: 404 });
      }
      resolvedTeamName = team.name;
    }

    const record = await createCall({
      tournamentId: id,
      teamId: resolvedTeamId,
      teamName: resolvedTeamName,
      tableNumber,
    });

    return NextResponse.json(
      {
        callId: record.callId,
        status: record.status,
        teamId: resolvedTeamId,
        teamName: resolvedTeamName,
        createdAt: record.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof TournamentClosedError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof InvalidTableError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof MaxCallsError) {
      return NextResponse.json({ message: error.message }, { status: 429 });
    }
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
