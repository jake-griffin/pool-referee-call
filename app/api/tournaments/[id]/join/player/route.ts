/**
 * app/api/tournaments/[id]/join/player/route.ts
 *
 * POST — Player joins a tournament via token + team name.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.3
 */

import { NextResponse } from 'next/server';
import { generateToken, verifyToken } from '@/lib/auth/tokens';
import { getTournamentMeta, putTeam } from '@/lib/db/queries';
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

    const { token, teamName } = body as { token?: string; teamName?: string };

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
    if (!verifyToken(token, tournament.playerTokenHash)) {
      return NextResponse.json(
        { message: 'Invalid token.' },
        { status: 401 },
      );
    }

    // 6. Validate teamName is non-empty after trimming
    if (!teamName || !teamName.trim()) {
      return NextResponse.json(
        { message: 'Team name is required and must not be empty.' },
        { status: 400 },
      );
    }

    const trimmedTeamName = teamName.trim();

    // 7. Generate teamId
    const teamId = `team_${generateToken()}`;

    // 8. Write team record to DynamoDB
    await putTeam({
      teamId,
      tournamentId: id,
      name: trimmedTeamName,
      joinedAt: new Date().toISOString(),
    });

    // 9. Issue session cookie
    const { cookieHeader } = await issueSession({
      tournamentId: id,
      role: 'player',
      entityId: teamId,
      displayName: trimmedTeamName,
    });

    // 10. Return success with Set-Cookie header
    const response = NextResponse.json(
      { teamId, tournamentId: id },
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
