'use client';

import { useState } from 'react';

interface Participant {
  id: string;
  name: string;
  joinedAt: string;
}

type ParticipantKind = 'team' | 'referee';

interface ParticipantsListProps {
  referees: Participant[];
  teams: Participant[];
  /**
   * Called to delete a participant. When omitted, the list is read-only (no
   * delete controls are shown). Should resolve after the delete completes so
   * the row can clear its pending state.
   */
  onDelete?: (kind: ParticipantKind, id: string) => Promise<void>;
  /** Hide the outer card + heading (e.g. when a collapsible wrapper provides them). */
  hideChrome?: boolean;
}

function formatJoinedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Row({
  person,
  kind,
  onDelete,
}: {
  person: Participant;
  kind: ParticipantKind;
  onDelete?: (kind: ParticipantKind, id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!onDelete) return;
    setBusy(true);
    try {
      await onDelete(kind, person.id);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-gray-900">{person.name}</span>

      {confirming ? (
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Removing…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {formatJoinedAt(person.joinedAt) && (
            <span className="text-xs text-gray-500">joined {formatJoinedAt(person.joinedAt)}</span>
          )}
          {onDelete && (
            <button
              type="button"
              aria-label={`Remove ${person.name}`}
              onClick={() => setConfirming(true)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-800"
            >
              &times;
            </button>
          )}
        </span>
      )}
    </li>
  );
}

function Column({
  title,
  emptyLabel,
  people,
  kind,
  onDelete,
}: {
  title: string;
  emptyLabel: string;
  people: Participant[];
  kind: ParticipantKind;
  onDelete?: (kind: ParticipantKind, id: string) => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h4 className="mb-2 flex items-center justify-between text-sm font-medium text-gray-700">
        <span>{title}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
          {people.length}
        </span>
      </h4>
      {people.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {people.map((p) => (
            <Row key={p.id} person={p} kind={kind} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Admin-only view of who has joined the tournament: the list of players/teams
 * and the list of referees. When onDelete is provided, each row gets a Remove
 * control (with inline confirm) to delete that participant.
 */
export default function ParticipantsList({
  referees,
  teams,
  onDelete,
  hideChrome,
}: ParticipantsListProps) {
  return (
    <div className={hideChrome ? '' : 'rounded-lg border border-gray-200 p-4'}>
      {!hideChrome && (
        <h3 className="text-lg font-semibold text-gray-900">Participants</h3>
      )}
      <p className={`text-sm text-gray-600 ${hideChrome ? '' : 'mt-1'}`}>
        Players and referees who have joined this tournament. Removing a team
        deletes its calls; removing a referee reopens their in-progress calls for
        others.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Column
          title="Players / Teams"
          emptyLabel="No players have joined yet."
          people={teams}
          kind="team"
          onDelete={onDelete}
        />
        <Column
          title="Referees"
          emptyLabel="No referees have joined yet."
          people={referees}
          kind="referee"
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
