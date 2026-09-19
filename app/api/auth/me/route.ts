/**
 * app/api/auth/me/route.ts
 *
 * GET — Return the current global session identity (director or admin), or 401
 * if not signed in. Used by the UI to decide what to render.
 */

import { NextResponse } from 'next/server';
import { getGlobalSession } from '@/lib/auth/session';

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getGlobalSession(request);
  if (!session) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }
  return NextResponse.json(
    {
      role: session.role,
      entityId: session.entityId,
      displayName: session.displayName,
    },
    { status: 200 },
  );
}
