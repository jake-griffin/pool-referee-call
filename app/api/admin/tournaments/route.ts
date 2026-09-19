/**
 * app/api/admin/tournaments/route.ts
 *
 * POST — Create a new tournament (requires ADMIN_SECRET)
 * GET  — List all tournaments (requires ADMIN_SECRET)
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8
 */

import { NextResponse } from 'next/server';
import { parseTableRange } from '@/lib/tables/range-parser';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import {
  putTournament,
  listTournaments,
  listTournamentsByOwner,
} from '@/lib/db/queries';
import { getGlobalSession, type GlobalSessionPayload } from '@/lib/auth/session';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** True if the request carries a valid ADMIN_SECRET Bearer header. */
function hasAdminSecret(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET;
  if (!authHeader || !adminSecret) return false;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
  return parts[1] === adminSecret;
}

/**
 * Resolves the caller's identity for tournament create/list. Supports:
 *   - the ADMIN_SECRET Bearer header (legacy global admin), and
 *   - a global session cookie (director or admin).
 * Returns null when unauthenticated.
 */
async function resolveCaller(
  request: Request,
): Promise<{ role: 'admin' | 'director'; directorId?: string } | null> {
  if (hasAdminSecret(request)) return { role: 'admin' };

  const session: GlobalSessionPayload | null = await getGlobalSession(request);
  if (session?.role === 'admin') return { role: 'admin' };
  if (session?.role === 'director') {
    return { role: 'director', directorId: session.entityId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/admin/tournaments
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Authorize
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json(
      { message: 'Unauthorized. Sign in as a director or admin to create tournaments.' },
      { status: 401 },
    );
  }

  // 2. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const { name, tableRange } = body as { name?: string; tableRange?: string };

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json(
      { message: 'Tournament name is required and must be a non-empty string.' },
      { status: 400 },
    );
  }

  if (tableRange === undefined || tableRange === null || typeof tableRange !== 'string') {
    return NextResponse.json(
      { message: 'tableRange is required and must be a string.' },
      { status: 400 },
    );
  }

  // 3. Parse table range
  const parseResult = parseTableRange(tableRange);
  if (!parseResult.ok) {
    return NextResponse.json(
      { message: parseResult.error },
      { status: 400 },
    );
  }

  // 4. Generate tokens (plaintext UUIDs) and hash them
  const adminToken = generateToken();
  const refereeToken = generateToken();
  const playerToken = generateToken();

  const adminTokenHash = hashToken(adminToken);
  const refereeTokenHash = hashToken(refereeToken);
  const playerTokenHash = hashToken(playerToken);

  // 5. Generate tournament ID
  const tournamentId = `t_${generateToken()}`;
  const createdAt = new Date().toISOString();

  // Stamp ownership when a director creates the tournament. Admin-created
  // tournaments (legacy ADMIN_SECRET path) remain ownerless, i.e. admin-only.
  const ownerId = caller.role === 'director' ? caller.directorId : undefined;

  // 6. Write to DynamoDB
  try {
    await putTournament({
      tournamentId,
      name: name.trim(),
      status: 'active',
      tableNumbers: parseResult.tables,
      adminTokenHash,
      refereeTokenHash,
      playerTokenHash,
      // Persist plaintext join tokens so an authenticated admin can re-display
      // the join QR codes later on any device. Admin token is never stored.
      refereeToken,
      playerToken,
      ownerId,
      createdAt,
    });
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }

  // 7. Build join links (include tournamentId as query param for the join pages)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const joinLinks = {
    referee: `${baseUrl}/join/referee/${refereeToken}?t=${tournamentId}`,
    player: `${baseUrl}/join/player/${playerToken}?t=${tournamentId}`,
  };

  // 8. Return 201 with plaintext tokens (never stored)
  return NextResponse.json(
    {
      tournamentId,
      name: name.trim(),
      tableNumbers: parseResult.tables,
      adminToken,
      refereeToken,
      playerToken,
      joinLinks,
      createdAt,
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// GET /api/admin/tournaments
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<NextResponse> {
  // 1. Authorize
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json(
      { message: 'Unauthorized. Sign in as a director or admin to view tournaments.' },
      { status: 401 },
    );
  }

  // 2. List tournaments — admin sees all; a director sees only their own.
  try {
    const tournaments =
      caller.role === 'admin'
        ? await listTournaments()
        : await listTournamentsByOwner(caller.directorId!);

    // Return summaries only (no token hashes)
    const summaries = tournaments.map((t) => ({
      tournamentId: t.tournamentId,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      tableNumbers: t.tableNumbers,
      ownerId: t.ownerId ?? null,
    }));

    return NextResponse.json(summaries, { status: 200 });
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
