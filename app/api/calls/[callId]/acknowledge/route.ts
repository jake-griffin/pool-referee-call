/**
 * app/api/calls/[callId]/acknowledge/route.ts
 *
 * POST — Referee acknowledges (claims) an unanswered call.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 13.4
 */

import { NextResponse } from 'next/server';
import { getSession, requireSession, AuthError } from '@/lib/auth/session';
import { acknowledgeCall } from '@/lib/calls/manager';
import {
  TournamentClosedError,
  AlreadyClaimedError,
  CallNotFoundError,
} from '@/lib/calls/errors';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ callId: string }> },
): Promise<NextResponse> {
  try {
    const { callId } = await params;

    // Parse request body to get tournamentId
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: 'Invalid JSON body.' },
        { status: 400 },
      );
    }

    const { tournamentId } = body as { tournamentId?: unknown };

    if (typeof tournamentId !== 'string' || !tournamentId) {
      return NextResponse.json(
        { message: 'tournamentId is required.' },
        { status: 400 },
      );
    }

    // Authenticate and authorize as referee
    const session = await getSession(request, tournamentId);
    requireSession(session, tournamentId, ['referee']);

    // Acknowledge the call
    const record = await acknowledgeCall(
      callId,
      session.entityId,
      session.displayName,
      tournamentId,
    );

    return NextResponse.json(
      {
        callId: record.callId,
        status: record.status,
        acknowledgedAt: record.acknowledgedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    // Map domain errors to HTTP responses
    if (error instanceof AuthError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.statusCode },
      );
    }
    if (error instanceof TournamentClosedError) {
      return NextResponse.json(
        { message: error.message },
        { status: 403 },
      );
    }
    if (error instanceof AlreadyClaimedError) {
      return NextResponse.json(
        { message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof CallNotFoundError) {
      return NextResponse.json(
        { message: error.message },
        { status: 404 },
      );
    }

    // Generic fallback — never expose raw error details
    console.error('[acknowledge] Unhandled error:', error);
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
