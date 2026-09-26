/**
 * app/api/tournaments/[id]/push/subscribe/route.ts
 *
 * POST   — Register the caller's Web Push subscription for this tournament.
 * DELETE — Remove a subscription (by endpoint) for this tournament.
 *
 * Requires a referee session for the tournament. The subscription is tied to
 * the referee so notifications reach their device(s). Subscriptions are keyed
 * by a hash of the endpoint, so posting the same subscription again is
 * idempotent.
 */

import { NextResponse } from 'next/server';
import { getSession, requireSession, AuthError } from '@/lib/auth/session';
import {
  putPushSubscription,
  deletePushSubscription,
  pushSubIdFromEndpoint,
} from '@/lib/db/queries';

interface IncomingSubscription {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const session = await getSession(request, id);
    requireSession(session, id, ['referee']);

    let body: IncomingSubscription;
    try {
      body = (await request.json()) as IncomingSubscription;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { message: 'A valid push subscription (endpoint + keys) is required.' },
        { status: 400 },
      );
    }

    const subId = pushSubIdFromEndpoint(endpoint);
    await putPushSubscription({
      subId,
      tournamentId: id,
      refereeId: session.entityId,
      endpoint,
      keys: { p256dh, auth },
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ subscribed: true }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const session = await getSession(request, id);
    requireSession(session, id, ['referee']);

    let body: IncomingSubscription;
    try {
      body = (await request.json()) as IncomingSubscription;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) {
      return NextResponse.json({ message: 'endpoint is required.' }, { status: 400 });
    }

    await deletePushSubscription(id, pushSubIdFromEndpoint(endpoint));
    return NextResponse.json({ subscribed: false }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
