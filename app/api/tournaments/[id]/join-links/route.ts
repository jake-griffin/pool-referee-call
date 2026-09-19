/**
 * app/api/tournaments/[id]/join-links/route.ts
 *
 * GET — Returns the referee/player join links for an existing tournament so an
 * authenticated admin can re-display the join QR codes on any device.
 *
 * Auth: requires a valid admin session for this tournament (the same session
 * the admin dashboard establishes via POST /join/admin). Player and referee
 * sessions are NOT permitted — join tokens are admin-only.
 *
 * Requirements: 2.x (admin join-link management)
 */

import { NextResponse } from 'next/server';
import { getSession, requireSession, AuthError } from '@/lib/auth/session';
import { getTournamentMeta } from '@/lib/db/queries';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Authenticate — admin session only
    const session = await getSession(request, id);
    requireSession(session, id, ['admin']);

    // Fetch tournament metadata
    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json(
        { message: 'Tournament not found.' },
        { status: 404 },
      );
    }

    // Tournaments created before plaintext tokens were stored won't have them.
    if (!tournament.refereeToken || !tournament.playerToken) {
      return NextResponse.json(
        {
          message:
            'Join links are unavailable for this tournament. It was created before join-link recovery was supported.',
          available: false,
        },
        { status: 404 },
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

    return NextResponse.json(
      {
        available: true,
        joinLinks: {
          referee: `${baseUrl}/join/referee/${tournament.refereeToken}?t=${id}`,
          player: `${baseUrl}/join/player/${tournament.playerToken}?t=${id}`,
        },
      },
      { status: 200 },
    );
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
