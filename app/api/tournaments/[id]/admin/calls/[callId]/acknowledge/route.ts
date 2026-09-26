/**
 * app/api/tournaments/[id]/admin/calls/[callId]/acknowledge/route.ts
 *
 * POST — Admin/owning-director acknowledges a call on behalf of a referee.
 *
 * Body: {
 *   refereeId?: string,        // an existing referee
 *   newRefereeName?: string,   // OR create a placeholder referee with this name
 *   adminToken?: string,
 * }
 * Exactly one of refereeId / newRefereeName must be supplied.
 */

import { NextResponse } from 'next/server';
import {
  getTournamentMeta,
  createPlaceholderReferee,
  queryAllTournamentItems,
} from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';
import { extractBearerToken } from '@/lib/auth/bearer';
import { acknowledgeCall } from '@/lib/calls/manager';
import {
  TournamentClosedError,
  AlreadyClaimedError,
  CallNotFoundError,
} from '@/lib/calls/errors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; callId: string }> },
): Promise<NextResponse> {
  try {
    const { id, callId } = await params;

    let body: { refereeId?: unknown; newRefereeName?: unknown; adminToken?: unknown };
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

    const refereeId = typeof body.refereeId === 'string' ? body.refereeId.trim() : '';
    const newRefereeName =
      typeof body.newRefereeName === 'string' ? body.newRefereeName.trim() : '';

    if ((!refereeId && !newRefereeName) || (refereeId && newRefereeName)) {
      return NextResponse.json(
        { message: 'Provide exactly one of refereeId or newRefereeName.' },
        { status: 400 },
      );
    }

    let resolvedRefId = refereeId;
    let resolvedRefName = '';

    if (newRefereeName) {
      const created = await createPlaceholderReferee(id, newRefereeName);
      resolvedRefId = created.refereeId;
      resolvedRefName = created.name;
    } else {
      const all = await queryAllTournamentItems(id);
      const ref = all.referees.find((r) => r.refereeId === refereeId);
      if (!ref) {
        return NextResponse.json({ message: 'Referee not found.' }, { status: 404 });
      }
      resolvedRefName = ref.name;
    }

    const record = await acknowledgeCall(callId, resolvedRefId, resolvedRefName, id);

    return NextResponse.json(
      {
        callId: record.callId,
        status: record.status,
        refereeId: resolvedRefId,
        refereeName: resolvedRefName,
        acknowledgedAt: record.acknowledgedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof TournamentClosedError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof AlreadyClaimedError) {
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
