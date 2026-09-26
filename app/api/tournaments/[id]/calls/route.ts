/**
 * app/api/tournaments/[id]/calls/route.ts
 *
 * POST — Player creates a new referee call at a specified table.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { NextResponse } from 'next/server';
import { getSession, requireSession, AuthError } from '@/lib/auth/session';
import { createCall } from '@/lib/calls/manager';
import { listPushSubscriptions } from '@/lib/db/queries';
import { sendToSubscriptions } from '@/lib/push/send';
import {
  TournamentClosedError,
  InvalidTableError,
  MaxCallsError,
} from '@/lib/calls/errors';

/**
 * Notify all referee subscriptions in a tournament that a new call arrived.
 * Fire-and-forget: failures are swallowed so they never affect call creation.
 */
async function notifyReferees(
  tournamentId: string,
  tableNumber: number,
  teamName: string,
): Promise<void> {
  try {
    const subs = await listPushSubscriptions(tournamentId);
    if (subs.length === 0) return;
    await sendToSubscriptions(subs, {
      title: `Table ${tableNumber} needs a referee`,
      body: `${teamName} requested a referee at table ${tableNumber}.`,
      url: `/t/${tournamentId}/referee`,
      tag: `call-${tournamentId}`,
    });
  } catch {
    // Never let notification errors surface to the caller.
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Authenticate and authorize
    const session = await getSession(request, id);
    requireSession(session, id, ['player']);

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { message: 'Invalid JSON body.' },
        { status: 400 },
      );
    }

    const { tableNumber } = body as { tableNumber?: unknown };

    // Validate tableNumber is a number
    if (typeof tableNumber !== 'number' || !Number.isFinite(tableNumber)) {
      return NextResponse.json(
        { message: 'tableNumber must be a valid number.' },
        { status: 400 },
      );
    }

    // Create the call
    const record = await createCall({
      tournamentId: id,
      teamId: session.entityId,
      teamName: session.displayName,
      tableNumber,
    });

    // Notify referees (fire-and-forget — do not block or fail the response).
    void notifyReferees(id, record.tableNumber, record.teamName);

    return NextResponse.json(
      {
        callId: record.callId,
        status: record.status,
        createdAt: record.createdAt,
      },
      { status: 201 },
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
    if (error instanceof InvalidTableError) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 },
      );
    }
    if (error instanceof MaxCallsError) {
      return NextResponse.json(
        { message: error.message },
        { status: 429 },
      );
    }

    // Generic fallback — never expose raw error details
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
