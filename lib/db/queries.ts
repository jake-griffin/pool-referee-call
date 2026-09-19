/**
 * lib/db/queries.ts
 *
 * All typed DynamoDB query and mutation functions for the Pool Referee Call App.
 *
 * Key patterns (single-table design):
 *   PK = "T#{tournamentId}"
 *   SK values:
 *     "META"              → tournament metadata
 *     "REF#{refereeId}"   → referee record
 *     "TEAM#{teamId}"     → team record
 *     "CALL#{callId}"     → call record
 *     "SESSION#{sid}"     → session record
 *
 *   Director accounts and global (non-tournament) sessions live under their own
 *   partition keys:
 *     PK = "DIRECTOR#{directorId}", SK = "META"      → director account
 *     PK = "GSESSION#{sessionId}",  SK = "META"      → global session (director/admin)
 *
 * GSI1 (index name: "GSI1", keys: GSI1PK + GSI1SK, project ALL):
 *   Unanswered queue:   GSI1PK = "T#{id}#UNANSWERED", GSI1SK = createdAt
 *   Per-referee queue:  GSI1PK = "T#{id}#REF#{refId}", GSI1SK = acknowledgedAt
 *   Director by email:  GSI1PK = "DIRECTOR#EMAIL#{email}", GSI1SK = "DIRECTOR"
 *   Tournaments by owner:GSI1PK = "OWNER#{ownerId}",       GSI1SK = createdAt
 *
 * Requirements: 2.1, 6.4, 6.5, 7.2, 7.4, 8.2, 9.1
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
  ScanCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { getDocumentClient, TABLE_NAME, GSI1_NAME } from './client';
import type { SessionPayload } from '@/lib/auth/session';
import { assignPositions } from '@/lib/queue/position';

// ---------------------------------------------------------------------------
// Typed record shapes
// ---------------------------------------------------------------------------

export type TournamentRecord = {
  tournamentId: string;
  name: string;
  status: 'active' | 'closed';
  tableNumbers: number[];
  adminTokenHash: string;
  refereeTokenHash: string;
  playerTokenHash: string;
  // Plaintext referee/player join tokens. Stored so an authenticated admin can
  // re-display the join QR codes for an existing tournament on any device.
  // These gate join access only; the admin token is never stored in plaintext.
  // Optional for backward compatibility with tournaments created before this field existed.
  refereeToken?: string;
  playerToken?: string;
  // Id of the Tournament Director who owns this tournament. Optional for
  // backward compatibility: tournaments created before director accounts
  // existed have no owner and are visible to the global admin only.
  ownerId?: string;
  createdAt: string;
};

/**
 * A Tournament Director account. Directors own the tournaments they create and
 * can only see/manage their own. The global admin (ADMIN_SECRET) can manage any
 * tournament regardless of ownership.
 *
 * passwordHash is produced by lib/auth/password.ts (scrypt) and is never
 * returned to clients.
 */
export type DirectorRecord = {
  directorId: string;
  email: string; // stored lowercased; unique
  name: string;
  passwordHash: string;
  createdAt: string;
  // When true the account is disabled and cannot sign in. Optional for
  // backward compatibility with accounts created before this field existed.
  disabled?: boolean;
};

/** Thrown when creating a director whose email is already taken. */
export class DuplicateEmailError extends Error {
  readonly code = 'DUPLICATE_EMAIL' as const;
  constructor() {
    super('A director with that email already exists.');
    this.name = 'DuplicateEmailError';
  }
}

export type SessionRecord = {
  sessionId: string;
  role: 'referee' | 'player' | 'admin';
  tournamentId: string;
  entityId: string;      // refereeId or teamId
  displayName: string;
  expiresAt: string;     // ISO 8601
};

export type RefereeRecord = {
  refereeId: string;
  tournamentId: string;
  name: string;
  joinedAt: string;
};

export type TeamRecord = {
  teamId: string;
  tournamentId: string;
  name: string;
  joinedAt: string;
};

export type CallRecord = {
  callId: string;
  tournamentId: string;
  teamId: string;
  teamName: string;
  tableNumber: number;
  status: 'unanswered' | 'acknowledged' | 'completed';
  refereeId: string | null;
  refereeName: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
};

// ---------------------------------------------------------------------------
// Typed error for acknowledge race condition
// ---------------------------------------------------------------------------

export class AlreadyClaimedError extends Error {
  readonly code = 'ALREADY_CLAIMED' as const;
  constructor() {
    super('This call was already claimed by another referee.');
    this.name = 'AlreadyClaimedError';
  }
}

// ---------------------------------------------------------------------------
// State endpoint response shapes
// ---------------------------------------------------------------------------

export type UnansweredCallEntry = {
  callId: string;
  teamName: string;
  tableNumber: number;
  createdAt: string;
  elapsedSeconds: number;
};

export type RefereeQueueEntry = {
  callId: string;
  teamName: string;
  tableNumber: number;
  acknowledgedAt: string;
  elapsedSeconds: number;
  position: number;
};

export type MyCallEntry = {
  callId: string;
  tableNumber: number;
  status: CallRecord['status'];
  refereeName: string | null;
  position: number | null;
  createdAt: string;
};

export type RecentActivityEntry = {
  callId: string;
  teamName: string;
  tableNumber: number;
  status: string;
  refereeName: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
};

export type ParticipantEntry = {
  id: string;
  name: string;
  joinedAt: string;
};

export type TournamentStateResponse = {
  lastUpdatedAt: string;
  tournament: { name: string; status: TournamentRecord['status']; tableNumbers: number[] };
  unansweredQueue: UnansweredCallEntry[];
  refereeQueues: Record<
    string,
    { refereeName: string; calls: RefereeQueueEntry[] }
  >;
  myCalls: MyCallEntry[];
  recentActivity: RecentActivityEntry[];
  /**
   * Roster of who has joined the tournament. Only populated for admin sessions
   * (undefined for player/referee sessions to avoid exposing the full roster).
   */
  participants?: {
    referees: ParticipantEntry[];
    teams: ParticipantEntry[];
  };
};

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

const pk = (tournamentId: string) => `T#${tournamentId}`;
const metaSK = () => 'META';
const refSK = (refereeId: string) => `REF#${refereeId}`;
const teamSK = (teamId: string) => `TEAM#${teamId}`;
const callSK = (callId: string) => `CALL#${callId}`;
const sessionSK = (sessionId: string) => `SESSION#${sessionId}`;
const unansweredGSI1PK = (tournamentId: string) =>
  `T#${tournamentId}#UNANSWERED`;
const refereeGSI1PK = (tournamentId: string, refereeId: string) =>
  `T#${tournamentId}#REF#${refereeId}`;

// Director + global session + ownership keys
const directorPK = (directorId: string) => `DIRECTOR#${directorId}`;
const globalSessionPK = (sessionId: string) => `GSESSION#${sessionId}`;
const directorEmailGSI1PK = (email: string) =>
  `DIRECTOR#EMAIL#${email.trim().toLowerCase()}`;
const ownerGSI1PK = (ownerId: string) => `OWNER#${ownerId}`;
// Email-uniqueness marker: a dedicated item whose PK is the normalized email,
// written in the same transaction as the director record to guarantee uniqueness.
const directorEmailKeyPK = (email: string) =>
  `DIRECTOR#EMAIL#${email.trim().toLowerCase()}`;

/**
 * Converts an ISO timestamp to epoch seconds for DynamoDB TTL.
 * DynamoDB TTL requires a Number attribute holding a Unix epoch (seconds).
 * Enable TTL on the table using the attribute name "ttl".
 */
const ttlEpochSeconds = (isoTimestamp: string): number =>
  Math.floor(new Date(isoTimestamp).getTime() / 1000);

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------

/**
 * Fetch tournament metadata. Returns null if the tournament does not exist.
 * Requirement 2.1
 */
export async function getTournamentMeta(
  tournamentId: string,
): Promise<TournamentRecord | null> {
  const client = getDocumentClient();
  const { Item } = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tournamentId), SK: metaSK() },
    }),
  );
  if (!Item) return null;
  return itemToTournament(Item);
}

/**
 * Write (create or overwrite) a tournament record.
 * Requirement 2.1
 */
export async function putTournament(record: TournamentRecord): Promise<void> {
  const client = getDocumentClient();
  // When the tournament has an owner, index it on GSI1 under the owner
  // partition so we can list a director's tournaments without a full scan.
  const ownerIndex = record.ownerId
    ? { GSI1PK: ownerGSI1PK(record.ownerId), GSI1SK: record.createdAt }
    : {};
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: pk(record.tournamentId),
        SK: metaSK(),
        ...ownerIndex,
        ...record,
      },
    }),
  );
}

/**
 * List all tournaments owned by a specific director, newest first.
 * Uses the GSI1 owner partition (OWNER#{ownerId}).
 */
export async function listTournamentsByOwner(
  ownerId: string,
): Promise<TournamentRecord[]> {
  const client = getDocumentClient();
  const { Items = [] } = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :owner',
      ExpressionAttributeValues: { ':owner': ownerGSI1PK(ownerId) },
      ScanIndexForward: false, // newest first
    }),
  );
  return Items.map(itemToTournament);
}

/**
 * Scan all tournament META records.
 * Used by GET /api/admin/tournaments.
 * Requirement 2.8
 */
export async function listTournaments(): Promise<TournamentRecord[]> {
  const client = getDocumentClient();
  // Scan for tournament META records only. NOTE: SK = "META" alone is NOT
  // sufficient — director accounts (PK=DIRECTOR#) and global sessions
  // (PK=GSESSION#) also use SK="META". We must additionally scope to the
  // tournament partition (PK begins with "T#") or those records leak into the
  // list as blank/invalid rows.
  const { Items = [] } = await client.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'SK = :meta AND begins_with(PK, :tpref)',
      ExpressionAttributeValues: { ':meta': 'META', ':tpref': 'T#' },
    }),
  );
  return Items.map(itemToTournament);
}

/**
 * Update tournament status to "closed".
 * Requirement 13.1
 */
export async function closeTournament(tournamentId: string): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tournamentId), SK: metaSK() },
      UpdateExpression: 'SET #s = :closed',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':closed': 'closed' },
    }),
  );
}

/**
 * Assign (or clear) a tournament's owning director.
 *
 * Passing an ownerId sets `ownerId` and writes the GSI1 owner-index keys
 * (OWNER#{ownerId} / createdAt) so the tournament appears in that director's
 * list. Passing null un-assigns: it removes `ownerId` and the GSI1 keys,
 * returning the tournament to admin-only visibility.
 *
 * Works for any tournament, including ones created before director accounts
 * existed (an ownerless tournament simply has no ownerId to begin with).
 */
export async function assignTournamentOwner(
  tournamentId: string,
  ownerId: string | null,
): Promise<void> {
  const client = getDocumentClient();

  if (ownerId) {
    // Need the tournament's createdAt for the GSI1 sort key (matches putTournament).
    const meta = await getTournamentMeta(tournamentId);
    if (!meta) throw new Error(`Tournament ${tournamentId} not found`);
    await client.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk(tournamentId), SK: metaSK() },
        UpdateExpression: 'SET ownerId = :owner, GSI1PK = :gpk, GSI1SK = :gsk',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: {
          ':owner': ownerId,
          ':gpk': ownerGSI1PK(ownerId),
          ':gsk': meta.createdAt,
        },
      }),
    );
  } else {
    // Un-assign: drop ownership and the owner-index keys.
    await client.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk(tournamentId), SK: metaSK() },
        UpdateExpression: 'REMOVE ownerId, GSI1PK, GSI1SK',
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }
}

/**
 * Replace a tournament's tableNumbers with a new sorted, deduplicated list.
 * Used by the admin "manage tables" feature to add or remove tables while a
 * tournament is in progress. The caller is responsible for validating and
 * normalising the list (sorted, unique, positive integers).
 */
export async function updateTableNumbers(
  tournamentId: string,
  tableNumbers: number[],
): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tournamentId), SK: metaSK() },
      UpdateExpression: 'SET tableNumbers = :tables',
      ExpressionAttributeValues: { ':tables': tableNumbers },
    }),
  );
}

// ---------------------------------------------------------------------------
// Director accounts
// ---------------------------------------------------------------------------

/**
 * Create a director account with atomic email-uniqueness enforcement.
 *
 * Writes two items in a single TransactWriteItems:
 *   1. the director record (PK=DIRECTOR#{id}), and
 *   2. an email-uniqueness marker (PK=DIRECTOR#EMAIL#{email}, SK=UNIQUE),
 * each conditioned on its own non-existence. If two requests race on the same
 * email, only one transaction commits; the other throws DuplicateEmailError.
 *
 * The director record also carries the GSI1 email index for lookup-by-email.
 */
export async function putDirector(record: DirectorRecord): Promise<void> {
  const client = getDocumentClient();
  const email = record.email.trim().toLowerCase();
  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: directorPK(record.directorId),
                SK: metaSK(),
                GSI1PK: directorEmailGSI1PK(email),
                GSI1SK: 'DIRECTOR',
                ...record,
                email,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: directorEmailKeyPK(email),
                SK: 'UNIQUE',
                directorId: record.directorId,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (isTransactionCancelled(err)) {
      // A cancelled transaction here means the email marker (or id) already exists.
      throw new DuplicateEmailError();
    }
    throw err;
  }
}

/** List all director accounts (admin management). */
export async function listDirectors(): Promise<DirectorRecord[]> {
  const client = getDocumentClient();
  // Directors by email are indexed on GSI1 under DIRECTOR#EMAIL# with a
  // constant GSI1SK of 'DIRECTOR'; a base-table scan filtered to director META
  // records is simplest and fine for the expected handful of accounts.
  const { Items = [] } = await client.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(PK, :dpref) AND SK = :meta',
      ExpressionAttributeValues: { ':dpref': 'DIRECTOR#', ':meta': 'META' },
    }),
  );
  // begins_with(PK, 'DIRECTOR#') also matches the email marker PK, but those
  // have SK='UNIQUE', so the SK=META filter excludes them.
  return Items.map(itemToDirector);
}

/**
 * Enable or disable a director account. A disabled director cannot sign in.
 */
export async function setDirectorDisabled(
  directorId: string,
  disabled: boolean,
): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: directorPK(directorId), SK: metaSK() },
      UpdateExpression: 'SET disabled = :d',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':d': disabled },
    }),
  );
}

/** Fetch a director by id. Returns null if not found. */
export async function getDirectorById(
  directorId: string,
): Promise<DirectorRecord | null> {
  const client = getDocumentClient();
  const { Item } = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: directorPK(directorId), SK: metaSK() },
    }),
  );
  if (!Item) return null;
  return itemToDirector(Item);
}

/** Fetch a director by email (case-insensitive). Returns null if not found. */
export async function getDirectorByEmail(
  email: string,
): Promise<DirectorRecord | null> {
  const client = getDocumentClient();
  const { Items = [] } = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: {
        ':pk': directorEmailGSI1PK(email),
        ':sk': 'DIRECTOR',
      },
      Limit: 1,
    }),
  );
  if (Items.length === 0) return null;
  return itemToDirector(Items[0]);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Fetch a session record by sessionId.
 * Returns null if the record doesn't exist (or is expired — caller checks expiresAt).
 * Requirement 15.1, 15.2
 */
export async function getSession(
  tournamentId: string,
  sessionId: string,
): Promise<SessionRecord | null> {
  const client = getDocumentClient();
  const { Item } = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tournamentId), SK: sessionSK(sessionId) },
    }),
  );
  if (!Item) return null;
  return itemToSession(Item);
}

/**
 * Write a new session record.
 * Requirement 15.2
 */
export async function putSession(record: SessionRecord): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: pk(record.tournamentId),
        SK: sessionSK(record.sessionId),
        // Numeric TTL (epoch seconds) so DynamoDB can auto-expire the record.
        ttl: ttlEpochSeconds(record.expiresAt),
        ...record,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Global sessions (director / admin) — not scoped to a single tournament
// ---------------------------------------------------------------------------

/**
 * A global session for a director or the admin. Unlike tournament sessions,
 * these are not tied to a tournamentId and are looked up by sessionId alone.
 * entityId holds the directorId (or 'admin' for the global admin).
 */
export type GlobalSessionRecord = {
  sessionId: string;
  role: 'director' | 'admin';
  entityId: string;
  displayName: string;
  expiresAt: string;
};

/** Write a global (director/admin) session record. */
export async function putGlobalSession(
  record: GlobalSessionRecord,
): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: globalSessionPK(record.sessionId),
        SK: metaSK(),
        // Numeric TTL (epoch seconds) so DynamoDB can auto-expire the record.
        ttl: ttlEpochSeconds(record.expiresAt),
        ...record,
      },
    }),
  );
}

/**
 * Delete a global session record by sessionId (used on logout to revoke the
 * session server-side, not just clear the cookie).
 */
export async function deleteGlobalSession(sessionId: string): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: globalSessionPK(sessionId), SK: metaSK() },
    }),
  );
}

/** Fetch a global session by sessionId. Returns null if not found. */
export async function getGlobalSession(
  sessionId: string,
): Promise<GlobalSessionRecord | null> {
  const client = getDocumentClient();
  const { Item } = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: globalSessionPK(sessionId), SK: metaSK() },
    }),
  );
  if (!Item) return null;
  return {
    sessionId: Item.sessionId,
    role: Item.role,
    entityId: Item.entityId,
    displayName: Item.displayName,
    expiresAt: Item.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Referee
// ---------------------------------------------------------------------------

/**
 * Write a referee record.
 * Requirement 4.4
 */
export async function putReferee(record: RefereeRecord): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: pk(record.tournamentId),
        SK: refSK(record.refereeId),
        ...record,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/**
 * Write a team record.
 * Requirement 5.4
 */
export async function putTeam(record: TeamRecord): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: pk(record.tournamentId),
        SK: teamSK(record.teamId),
        ...record,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Call — basic operations
// ---------------------------------------------------------------------------

/**
 * Fetch a single call record. Returns null if not found.
 * Requirement 7.2
 */
export async function getCall(
  tournamentId: string,
  callId: string,
): Promise<CallRecord | null> {
  const client = getDocumentClient();
  const { Item } = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tournamentId), SK: callSK(callId) },
    }),
  );
  if (!Item) return null;
  return itemToCall(Item);
}

/**
 * Write a new call record with GSI1 unanswered-queue attributes.
 * Requirements 6.4, 6.5
 */
export async function putCall(record: CallRecord): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: pk(record.tournamentId),
        SK: callSK(record.callId),
        // GSI1 — unanswered queue partition
        GSI1PK: unansweredGSI1PK(record.tournamentId),
        GSI1SK: record.createdAt,
        ...record,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Call — acknowledge (atomic, TransactWriteItems)
// ---------------------------------------------------------------------------

/**
 * Atomically acknowledge a call.
 *
 * Uses TransactWriteItems with a condition on status = "unanswered".
 * If the condition fails (another referee already claimed it), throws AlreadyClaimedError.
 *
 * On success:
 *   - Sets status = "acknowledged", refereeId, refereeName, acknowledgedAt
 *   - Removes the unanswered GSI1PK/SK (takes call out of unanswered queue)
 *   - Sets the per-referee GSI1PK/SK (puts call into referee's personal queue)
 *
 * Requirements 7.2, 7.3, 7.4
 */
export async function updateCallAcknowledge(
  tournamentId: string,
  callId: string,
  refereeId: string,
  refereeName: string,
  acknowledgedAt: string,
): Promise<void> {
  const client = getDocumentClient();
  try {
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE_NAME,
              Key: { PK: pk(tournamentId), SK: callSK(callId) },
              // Atomically transition unanswered → acknowledged.
              // SET overwrites GSI1PK/GSI1SK from the unanswered partition
              // to the per-referee partition in a single operation.
              UpdateExpression: `
                SET #status = :ack,
                    refereeId = :refId,
                    refereeName = :refName,
                    acknowledgedAt = :ackedAt,
                    GSI1PK = :refGSI1PK,
                    GSI1SK = :ackedAt
              `.trim(),
              ConditionExpression: '#status = :unanswered',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':ack': 'acknowledged',
                ':refId': refereeId,
                ':refName': refereeName,
                ':ackedAt': acknowledgedAt,
                ':refGSI1PK': refereeGSI1PK(tournamentId, refereeId),
                ':unanswered': 'unanswered',
              },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (isTransactionCancelled(err)) {
      throw new AlreadyClaimedError();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Call — complete
// ---------------------------------------------------------------------------

/**
 * Mark an acknowledged call as completed.
 *
 * Conditions:
 *   - status must be "acknowledged"
 *   - refereeId must match the requesting referee (ownership check)
 *
 * On success:
 *   - Sets status = "completed", completedAt
 *   - Removes GSI1PK / GSI1SK (takes call out of referee's personal queue)
 *
 * Requirements 8.2, 8.3, 8.4
 */
export async function updateCallComplete(
  tournamentId: string,
  callId: string,
  refereeId: string,
  completedAt: string,
): Promise<void> {
  const client = getDocumentClient();
  await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk(tournamentId), SK: callSK(callId) },
      UpdateExpression: `
        SET #status = :completed,
            completedAt = :completedAt
        REMOVE GSI1PK, GSI1SK
      `.trim(),
      ConditionExpression:
        '#status = :acknowledged AND refereeId = :refId',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':completed': 'completed',
        ':completedAt': completedAt,
        ':acknowledged': 'acknowledged',
        ':refId': refereeId,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Queue queries via GSI1
// ---------------------------------------------------------------------------

/**
 * Query all unanswered calls for a tournament, ordered by createdAt ascending (FIFO).
 * Uses GSI1 unanswered partition.
 * Requirements 6.5, 9.1
 */
export async function queryUnansweredQueue(
  tournamentId: string,
): Promise<CallRecord[]> {
  const client = getDocumentClient();
  const { Items = [] } = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': unansweredGSI1PK(tournamentId),
      },
      ScanIndexForward: true, // ascending (oldest first)
    }),
  );
  return Items.map(itemToCall);
}

/**
 * Query all acknowledged calls for a specific referee, ordered by acknowledgedAt ascending.
 * Uses GSI1 per-referee partition.
 * Requirement 7.4
 */
export async function queryRefereeQueue(
  tournamentId: string,
  refereeId: string,
): Promise<CallRecord[]> {
  const client = getDocumentClient();
  const { Items = [] } = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': refereeGSI1PK(tournamentId, refereeId),
      },
      ScanIndexForward: true, // ascending (oldest acknowledged first)
    }),
  );
  return Items.map(itemToCall);
}

// ---------------------------------------------------------------------------
// All tournament items (base-table query for state endpoint + archive)
// ---------------------------------------------------------------------------

export type AllTournamentItems = {
  tournament: TournamentRecord | null;
  calls: CallRecord[];
  referees: RefereeRecord[];
  teams: TeamRecord[];
  sessions: SessionRecord[];
};

/**
 * Query all items under a tournament partition key.
 * Single base-table Query — efficient for typical tournament sizes (~1000 items).
 * Used by the state endpoint fan-out and the archive endpoint.
 * Requirement 9.1
 */
export async function queryAllTournamentItems(
  tournamentId: string,
): Promise<AllTournamentItems> {
  const client = getDocumentClient();
  const { Items = [] } = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk(tournamentId) },
    }),
  );

  const result: AllTournamentItems = {
    tournament: null,
    calls: [],
    referees: [],
    teams: [],
    sessions: [],
  };

  for (const item of Items) {
    if (item.SK === 'META') {
      result.tournament = itemToTournament(item);
    } else if (typeof item.SK === 'string' && item.SK.startsWith('CALL#')) {
      result.calls.push(itemToCall(item));
    } else if (typeof item.SK === 'string' && item.SK.startsWith('REF#')) {
      result.referees.push(itemToReferee(item));
    } else if (typeof item.SK === 'string' && item.SK.startsWith('TEAM#')) {
      result.teams.push(itemToTeam(item));
    } else if (typeof item.SK === 'string' && item.SK.startsWith('SESSION#')) {
      result.sessions.push(itemToSession(item));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// State endpoint — composite query for polling
// ---------------------------------------------------------------------------

/**
 * Assemble the full TournamentStateResponse for the polling endpoint.
 *
 * Algorithm:
 *  1. Query base table (PK=T#{id}) for all items in one request.
 *  2. Extract META, calls, referees.
 *  3. Query GSI1 for unanswered queue (already sorted by createdAt ASC).
 *  4. For each unique refereeId in acknowledged calls, query GSI1 per-referee queue.
 *  5. Run assignPositions() on each referee queue.
 *  6. Compute elapsedSeconds for each call.
 *  7. Filter myCalls based on session role + entityId.
 *  8. Return TournamentStateResponse.
 *
 * Requirement 9.1
 */
export async function getTournamentState(
  tournamentId: string,
  session: SessionPayload,
): Promise<TournamentStateResponse> {
  const now = new Date();
  const lastUpdatedAt = now.toISOString();

  // Step 1-2: all items in one base-table query
  const allItems = await queryAllTournamentItems(tournamentId);

  if (!allItems.tournament) {
    throw new Error(`Tournament ${tournamentId} not found`);
  }

  // Step 3: unanswered queue from GSI1
  const unansweredCalls = await queryUnansweredQueue(tournamentId);

  // Step 4: collect unique refereeIds from acknowledged calls
  const acknowledgedCalls = allItems.calls.filter(
    (c) => c.status === 'acknowledged' && c.refereeId,
  );
  const refereeIds = [...new Set(acknowledgedCalls.map((c) => c.refereeId as string))];

  // Fetch all referee queues in parallel
  const refereeQueueResults = await Promise.all(
    refereeIds.map((refId) => queryRefereeQueue(tournamentId, refId)),
  );

  // Build a name lookup from REF# records
  const refereeNameMap = new Map<string, string>();
  for (const ref of allItems.referees) {
    refereeNameMap.set(ref.refereeId, ref.name);
  }

  // Step 5-6: build refereeQueues map with positions and elapsedSeconds
  const refereeQueues: TournamentStateResponse['refereeQueues'] = {};
  for (let i = 0; i < refereeIds.length; i++) {
    const refId = refereeIds[i];
    const rawQueue = refereeQueueResults[i];
    const positioned = assignPositions(
      rawQueue.map((c) => ({
        callId: c.callId,
        teamId: c.teamId,
        teamName: c.teamName,
        tableNumber: c.tableNumber,
        acknowledgedAt: c.acknowledgedAt!,
      })),
    );
    refereeQueues[refId] = {
      refereeName: refereeNameMap.get(refId) ?? refId,
      calls: positioned.map((entry) => ({
        callId: entry.callId,
        teamName: entry.teamName,
        tableNumber: entry.tableNumber,
        acknowledgedAt: entry.acknowledgedAt,
        elapsedSeconds: elapsedSeconds(entry.acknowledgedAt, now),
        position: entry.position,
      })),
    };
  }

  // Step 7: filter myCalls
  const myCalls = buildMyCalls(
    session,
    allItems.calls,
    unansweredCalls,
    refereeQueues,
    now,
  );

  // Build unanswered queue response entries
  const unansweredQueue: UnansweredCallEntry[] = unansweredCalls.map((c) => ({
    callId: c.callId,
    teamName: c.teamName,
    tableNumber: c.tableNumber,
    createdAt: c.createdAt,
    elapsedSeconds: elapsedSeconds(c.createdAt, now),
  }));

  // Build recent activity: completed and acknowledged calls, sorted by most recent event
  const recentActivity: RecentActivityEntry[] = allItems.calls
    .filter((c) => c.status === 'completed' || c.status === 'acknowledged')
    .map((c) => ({
      callId: c.callId,
      teamName: c.teamName,
      tableNumber: c.tableNumber,
      status: c.status,
      refereeName: c.refereeName,
      createdAt: c.createdAt,
      acknowledgedAt: c.acknowledgedAt,
      completedAt: c.completedAt,
    }))
    .sort((a, b) => {
      const timeA = a.completedAt ?? a.acknowledgedAt ?? a.createdAt;
      const timeB = b.completedAt ?? b.acknowledgedAt ?? b.createdAt;
      return timeB.localeCompare(timeA); // most recent first
    })
    .slice(0, 20);

  // Participants roster — admin only. Players/referees don't need (and
  // shouldn't see) the full list of who has joined.
  let participants: TournamentStateResponse['participants'];
  if (session.role === 'admin') {
    const byJoinedAt = (a: ParticipantEntry, b: ParticipantEntry) =>
      a.joinedAt.localeCompare(b.joinedAt);
    participants = {
      referees: allItems.referees
        .map((r) => ({ id: r.refereeId, name: r.name, joinedAt: r.joinedAt }))
        .sort(byJoinedAt),
      teams: allItems.teams
        .map((t) => ({ id: t.teamId, name: t.name, joinedAt: t.joinedAt }))
        .sort(byJoinedAt),
    };
  }

  return {
    lastUpdatedAt,
    tournament: {
      name: allItems.tournament.name,
      status: allItems.tournament.status,
      tableNumbers: allItems.tournament.tableNumbers,
    },
    unansweredQueue,
    refereeQueues,
    myCalls,
    recentActivity,
    participants,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function elapsedSeconds(isoTimestamp: string, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(isoTimestamp).getTime()) / 1000),
  );
}

function buildMyCalls(
  session: SessionPayload,
  allCalls: CallRecord[],
  _unansweredCalls: CallRecord[],
  refereeQueues: TournamentStateResponse['refereeQueues'],
  now: Date,
): MyCallEntry[] {
  if (session.role === 'player') {
    // Player sees their own team's active (unanswered + acknowledged) calls.
    const teamId = session.entityId;
    return allCalls
      .filter(
        (c) =>
          c.teamId === teamId &&
          (c.status === 'unanswered' || c.status === 'acknowledged'),
      )
      .map((c) => {
        let position: number | null = null;
        if (c.status === 'acknowledged' && c.refereeId) {
          const refQueue = refereeQueues[c.refereeId];
          if (refQueue) {
            const entry = refQueue.calls.find((rc) => rc.callId === c.callId);
            position = entry?.position ?? null;
          }
        }
        return {
          callId: c.callId,
          tableNumber: c.tableNumber,
          status: c.status,
          refereeName: c.refereeName,
          position,
          createdAt: c.createdAt,
        };
      });
  }

  if (session.role === 'referee') {
    // Referee sees their own acknowledged calls (personal queue).
    const refId = session.entityId;
    const refQueue = refereeQueues[refId];
    if (!refQueue) return [];
    return refQueue.calls.map((rc) => ({
      callId: rc.callId,
      tableNumber: rc.tableNumber,
      status: 'acknowledged' as const,
      refereeName: null, // own queue — referee name not needed
      position: rc.position,
      createdAt: rc.acknowledgedAt,
    }));
  }

  // Admin: empty myCalls (they see all queues separately)
  return [];
}

/** Checks whether a thrown error is a DynamoDB TransactionCanceledException. */
function isTransactionCancelled(err: unknown): boolean {
  if (err instanceof TransactionCanceledException) return true;
  // Also handle the error shape returned by the Document client wrapper
  if (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'TransactionCanceledException'
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// DynamoDB item → typed record converters
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemToTournament(item: Record<string, any>): TournamentRecord {
  return {
    tournamentId: item.tournamentId,
    name: item.name,
    status: item.status,
    tableNumbers: item.tableNumbers ?? [],
    adminTokenHash: item.adminTokenHash,
    refereeTokenHash: item.refereeTokenHash,
    playerTokenHash: item.playerTokenHash,
    refereeToken: item.refereeToken ?? undefined,
    playerToken: item.playerToken ?? undefined,
    ownerId: item.ownerId ?? undefined,
    createdAt: item.createdAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemToDirector(item: Record<string, any>): DirectorRecord {
  return {
    directorId: item.directorId,
    email: item.email,
    name: item.name,
    passwordHash: item.passwordHash,
    createdAt: item.createdAt,
    disabled: item.disabled ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemToSession(item: Record<string, any>): SessionRecord {
  return {
    sessionId: item.sessionId,
    role: item.role,
    tournamentId: item.tournamentId,
    entityId: item.entityId,
    displayName: item.displayName,
    expiresAt: item.expiresAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemToCall(item: Record<string, any>): CallRecord {
  return {
    callId: item.callId,
    tournamentId: item.tournamentId,
    teamId: item.teamId,
    teamName: item.teamName,
    tableNumber: item.tableNumber,
    status: item.status,
    refereeId: item.refereeId ?? null,
    refereeName: item.refereeName ?? null,
    createdAt: item.createdAt,
    acknowledgedAt: item.acknowledgedAt ?? null,
    completedAt: item.completedAt ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemToReferee(item: Record<string, any>): RefereeRecord {
  return {
    refereeId: item.refereeId,
    tournamentId: item.tournamentId,
    name: item.name,
    joinedAt: item.joinedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemToTeam(item: Record<string, any>): TeamRecord {
  return {
    teamId: item.teamId,
    tournamentId: item.tournamentId,
    name: item.name,
    joinedAt: item.joinedAt,
  };
}
