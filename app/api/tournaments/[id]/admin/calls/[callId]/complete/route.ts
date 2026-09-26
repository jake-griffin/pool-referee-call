/**
 * app/api/tournaments/[id]/admin/calls/[callId]/complete/route.ts
 *
 * POST — Admin/owning-director completes an acknowledged call on behalf of the
 * assigned referee (no referee-ownership check).
 *
 * Body: { adminToken?: string }
 */

import { NextResponse } from 'next/server';
import { getTournamentMeta } from '@/lib/db/queries';
import { authorizeTournamentManagement } from '@/lib/auth/tournament-access';
import { extractBearerToken } from '@/lib/auth/bearer';
import { completeCallAsAdmin } from '@/lib/calls/manager';
import {
  TournamentClosedError,
  WrongStatusError,
  CallNotFoundError,
} from '@/lib/calls/errors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; callId: string }> },
): Promise<NextResponse> {
  try {
    const { id, callId } = await params;

    let body: { adminToken?: unknown } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // Body optional when a session authorizes.
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

    const record = await completeCallAsAdmin(callId, id);

    return NextResponse.json(
      { callId: record.callId, status: record.status, completedAt: record.completedAt },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof TournamentClosedError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
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
