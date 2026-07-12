/**
 * app/api/tournaments/[id]/state/route.ts
 *
 * GET — Returns the full tournament state for polling clients.
 *
 * Requirements: 9.1, 9.2, 9.6
 */

import { NextResponse } from 'next/server';
import { getSession, requireSession, AuthError } from '@/lib/auth/session';
import { getTournamentState, TournamentStateResponse } from '@/lib/db/queries';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Authenticate — any valid session for this tournament is allowed
    const session = await getSession(request, id);
    requireSession(session, id, ['player', 'referee', 'admin']);

    // Fetch full tournament state
    const state: TournamentStateResponse = await getTournamentState(id, session);

    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
