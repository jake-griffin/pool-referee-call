/**
 * app/api/tournaments/[id]/tables/route.ts
 *
 * PUT — Replace a tournament's set of tables while it is in progress.
 *
 * Admins sometimes need to add or remove tables mid-tournament (e.g. giving
 * tables back to the venue as the field thins out). This endpoint replaces the
 * tournament's `tableNumbers` with a new set.
 *
 * Auth: per-tournament admin token (Bearer header or body.adminToken),
 * verified against the stored adminTokenHash — the same pattern as the close
 * endpoint.
 *
 * Request body (one of):
 *   { tableNumbers: number[] }   — explicit list of table numbers
 *   { tableRange: string }       — compact range string, e.g. "11-18, 29-36"
 *
 * Removing a table does NOT delete or cancel existing calls on that table;
 * referees can still finish them. New calls simply can't target a removed
 * table (the client only offers the current set and call creation validates
 * against it). The response reports how many active calls remain on any
 * removed tables so the admin is aware.
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth/tokens';
import {
  getTournamentMeta,
  queryUnansweredQueue,
  queryAllTournamentItems,
  updateTableNumbers,
} from '@/lib/db/queries';
import { parseTableRange } from '@/lib/tables/range-parser';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Parse body first (we need it both for auth-via-body and for the payload)
    let body: Record<string, unknown> | null = null;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    // Extract admin token from Authorization header or body
    const adminToken = extractAdminToken(request, body);
    if (!adminToken) {
      return NextResponse.json(
        { message: 'Unauthorized. A valid admin token is required.' },
        { status: 401 },
      );
    }

    // Fetch tournament metadata
    const tournament = await getTournamentMeta(id);
    if (!tournament) {
      return NextResponse.json({ message: 'Tournament not found.' }, { status: 404 });
    }

    // Verify admin token
    if (!verifyToken(adminToken, tournament.adminTokenHash)) {
      return NextResponse.json(
        { message: 'Unauthorized. A valid admin token is required.' },
        { status: 401 },
      );
    }

    // Resolve the new table list from either tableNumbers or tableRange
    const parsed = resolveTableNumbers(body);
    if (!parsed.ok) {
      return NextResponse.json({ message: parsed.error }, { status: 400 });
    }
    const newTables = parsed.tables;

    // Determine which tables are being removed and whether active calls sit on them
    const previousTables = tournament.tableNumbers ?? [];
    const removedTables = previousTables.filter((t) => !newTables.includes(t));

    let affectedActiveCalls = 0;
    if (removedTables.length > 0) {
      affectedActiveCalls = await countActiveCallsOnTables(id, removedTables);
    }

    // Persist the new table list
    await updateTableNumbers(id, newTables);

    return NextResponse.json(
      {
        tournamentId: id,
        tableNumbers: newTables,
        removedTables,
        affectedActiveCalls,
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResolveResult = { ok: true; tables: number[] } | { ok: false; error: string };

/**
 * Resolves the new table list from the request body. Accepts either an explicit
 * `tableNumbers` array or a `tableRange` string. Always returns a sorted,
 * deduplicated list of positive integers, or an error.
 */
function resolveTableNumbers(body: Record<string, unknown>): ResolveResult {
  const { tableNumbers, tableRange } = body as {
    tableNumbers?: unknown;
    tableRange?: unknown;
  };

  if (Array.isArray(tableNumbers)) {
    const nums: number[] = [];
    for (const value of tableNumbers) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        return {
          ok: false,
          error: 'tableNumbers must be an array of positive integers.',
        };
      }
      nums.push(value);
    }
    if (nums.length === 0) {
      return { ok: false, error: 'A tournament must keep one or more tables.' };
    }
    const unique = Array.from(new Set(nums)).sort((a, b) => a - b);
    return { ok: true, tables: unique };
  }

  if (typeof tableRange === 'string') {
    const result = parseTableRange(tableRange);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, tables: result.tables };
  }

  return {
    ok: false,
    error: 'Provide either tableNumbers (number[]) or tableRange (string).',
  };
}

/**
 * Counts active (unanswered + acknowledged) calls sitting on any of the given
 * table numbers. Used to warn the admin when removing tables that still have
 * work in progress.
 */
async function countActiveCallsOnTables(
  tournamentId: string,
  tables: number[],
): Promise<number> {
  const tableSet = new Set(tables);

  // Unanswered calls come from the GSI1 queue; acknowledged calls are in the
  // base-table item set. Combine both, de-duplicating by callId.
  const [unanswered, allItems] = await Promise.all([
    queryUnansweredQueue(tournamentId),
    queryAllTournamentItems(tournamentId),
  ]);

  const activeById = new Map<string, number>();
  for (const call of unanswered) {
    activeById.set(call.callId, call.tableNumber);
  }
  for (const call of allItems.calls) {
    if (call.status === 'unanswered' || call.status === 'acknowledged') {
      activeById.set(call.callId, call.tableNumber);
    }
  }

  let count = 0;
  for (const tableNumber of activeById.values()) {
    if (tableSet.has(tableNumber)) count++;
  }
  return count;
}

/**
 * Extracts adminToken from the Authorization Bearer header or the request body.
 * Mirrors the close endpoint's auth extraction.
 */
function extractAdminToken(
  request: Request,
  body: Record<string, unknown> | null,
): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      return parts[1];
    }
  }

  if (body && typeof body.adminToken === 'string' && body.adminToken) {
    return body.adminToken;
  }

  return null;
}
