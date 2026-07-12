/**
 * app/api/tournaments/[id]/join/referee/route.ts
 *
 * POST — Referee joins a tournament via token + display name.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 13.3
 */

import { NextResponse } from 'next/server';
import { generateToken, verifyToken } from '@/lib/auth/tokens';
import { getTournamentMeta, putReferee } from '@/lib/db/queries';
import { issueSession } from '@/lib/auth/session';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // 1. Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: 'Invalid JSON body.' },
        { status: 400 },
      );
    }

    const { token, name } = body as { token?: string; name?: string };

    // 2. Validate token is present
    if (!token) {
      return NextResponse.json(
        { message: 'Token is required.' },
        { status: 401 },
      );
    }

    // 3. Fetch tournament metadata
    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json(
        { message: 'Tournament not found.' },
        { status: 404 },
      );
    }

    // 4. Check tournament status
    if (tournament.status === 'closed') {
      return NextResponse.json(
        { message: 'This tournament is closed.' },
        { status: 403 },
      );
    }

    // 5. Verify token against stored hash
    if (!verifyToken(token, tournament.refereeTokenHash)) {
      return NextResponse.json(
        { message: 'Invalid token.' },
        { status: 401 },
      );
    }

    // 6. Validate name is non-empty after trimming
    if (!name || !name.trim()) {
      return NextResponse.json(
        { message: 'Display name is required and must not be empty.' },
        { status: 400 },
      );
    }

    const trimmedName = name.trim();

    // 7. Generate refereeId
    const refereeId = `ref_${generateToken()}`;

    // 8. Write referee record to DynamoDB
    await putReferee({
      refereeId,
      tournamentId: id,
      name: trimmedName,
      joinedAt: new Date().toISOString(),
    });

    // 9. Issue session cookie
    const { cookieHeader } = await issueSession({
      tournamentId: id,
      role: 'referee',
      entityId: refereeId,
      displayName: trimmedName,
    });

    // 10. Return success with Set-Cookie header
    const response = NextResponse.json(
      { refereeId, tournamentId: id },
      { status: 200 },
    );
    response.headers.set('Set-Cookie', cookieHeader);
    return response;
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
