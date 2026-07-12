/**
 * app/api/calls/[callId]/complete/route.ts
 *
 * POST — Referee marks an acknowledged call as completed.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 13.4
 */

import { NextResponse } from 'next/server';
import { getSession, requireSession, AuthError } from '@/lib/auth/session';
import { completeCall } from '@/lib/calls/manager';
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

    // Complete the call
    const record = await completeCall(
      callId,
      session.entityId,
      tournamentId,
    );

    return NextResponse.json(
      {
        callId: record.callId,
        status: record.status,
        completedAt: record.completedAt,
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
    if (error instanceof WrongRefereeError) {
      return NextResponse.json(
        { message: error.message },
        { status: 403 },
      );
    }
    if (error instanceof WrongStatusError) {
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
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
