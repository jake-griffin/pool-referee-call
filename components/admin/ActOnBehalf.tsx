'use client';

import { useState } from 'react';
import { extractUserMessage } from '@/lib/utils/errors';

interface Participant {
  id: string;
  name: string;
}

interface ActiveCall {
  callId: string;
  teamName: string;
  tableNumber: number;
  status: string; // 'unanswered' | 'acknowledged'
}

interface ActOnBehalfProps {
  tournamentId: string;
  adminToken?: string | null;
  tableNumbers: number[];
  teams: Participant[];
  referees: Participant[];
  /** Unanswered + acknowledged calls the admin can act on. */
  activeCalls: ActiveCall[];
  onChanged?: () => void;
}

const NEW = '__new__';

/**
 * Admin/owning-director controls to act on behalf of participants:
 *  - place a call for an existing or new team,
 *  - acknowledge an unanswered call as an existing or new referee,
 *  - complete or cancel an acknowledged call.
 */
export default function ActOnBehalf({
  tournamentId,
  adminToken,
  tableNumbers,
  teams,
  referees,
  activeCalls,
  onChanged,
}: ActOnBehalfProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Place-a-call form state
  const [teamChoice, setTeamChoice] = useState<string>(teams[0]?.id ?? NEW);
  const [newTeamName, setNewTeamName] = useState('');
  const [table, setTable] = useState<string>(tableNumbers[0] ? String(tableNumbers[0]) : '');

  // Acknowledge form state (per selected call)
  const [ackRefChoice, setAckRefChoice] = useState<string>(referees[0]?.id ?? NEW);
  const [newRefName, setNewRefName] = useState('');
  const [ackCallId, setAckCallId] = useState<string>('');

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
  };

  async function run(fn: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(await extractUserMessage(res));
        return false;
      }
      onChanged?.();
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function placeCall(e: React.FormEvent) {
    e.preventDefault();
    if (!table) return;
    const body: Record<string, unknown> = { tableNumber: Number(table) };
    if (teamChoice === NEW) {
      if (!newTeamName.trim()) { setError('Enter a team name.'); return; }
      body.newTeamName = newTeamName.trim();
    } else {
      body.teamId = teamChoice;
    }
    const ok = await run(() =>
      fetch(`/api/tournaments/${tournamentId}/admin/calls`, {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify(body),
      }),
    );
    if (ok) setNewTeamName('');
  }

  async function acknowledge(e: React.FormEvent) {
    e.preventDefault();
    if (!ackCallId) { setError('Choose a call to acknowledge.'); return; }
    const body: Record<string, unknown> = {};
    if (ackRefChoice === NEW) {
      if (!newRefName.trim()) { setError('Enter a referee name.'); return; }
      body.newRefereeName = newRefName.trim();
    } else {
      body.refereeId = ackRefChoice;
    }
    const ok = await run(() =>
      fetch(`/api/tournaments/${tournamentId}/admin/calls/${ackCallId}/acknowledge`, {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify(body),
      }),
    );
    if (ok) { setNewRefName(''); setAckCallId(''); }
  }

  async function completeCall(callId: string) {
    await run(() =>
      fetch(`/api/tournaments/${tournamentId}/admin/calls/${callId}/complete`, {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({}),
      }),
    );
  }

  async function cancelCall(callId: string) {
    await run(() =>
      fetch(`/api/calls/${callId}/cancel`, {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({ tournamentId }),
      }),
    );
  }

  const unanswered = activeCalls.filter((c) => c.status === 'unanswered');
  const acknowledged = activeCalls.filter((c) => c.status === 'acknowledged');

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* Place a call on behalf of a team */}
      <form onSubmit={placeCall} className="space-y-2">
        <p className="text-sm font-medium text-gray-800">Place a call for a team</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={teamChoice}
            onChange={(e) => setTeamChoice(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
            <option value={NEW}>+ New team…</option>
          </select>
          {teamChoice === NEW && (
            <input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="New team name"
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          )}
          <select
            value={table}
            onChange={(e) => setTable(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {tableNumbers.map((n) => (
              <option key={n} value={String(n)}>Table {n}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !table}
            className="min-h-[36px] rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Place call
          </button>
        </div>
      </form>

      {/* Acknowledge an unanswered call as a referee */}
      <form onSubmit={acknowledge} className="space-y-2">
        <p className="text-sm font-medium text-gray-800">Acknowledge a call as a referee</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={ackCallId}
            onChange={(e) => setAckCallId(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select unanswered call…</option>
            {unanswered.map((c) => (
              <option key={c.callId} value={c.callId}>
                Table {c.tableNumber} — {c.teamName}
              </option>
            ))}
          </select>
          <select
            value={ackRefChoice}
            onChange={(e) => setAckRefChoice(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {referees.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
            <option value={NEW}>+ New referee…</option>
          </select>
          {ackRefChoice === NEW && (
            <input
              type="text"
              value={newRefName}
              onChange={(e) => setNewRefName(e.target.value)}
              placeholder="New referee name"
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          )}
          <button
            type="submit"
            disabled={busy || !ackCallId}
            className="min-h-[36px] rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Acknowledge
          </button>
        </div>
      </form>

      {/* Complete / cancel acknowledged calls */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-800">In-progress calls</p>
        {acknowledged.length === 0 && unanswered.length === 0 ? (
          <p className="text-sm text-gray-500">No active calls.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {acknowledged.map((c) => (
              <li key={c.callId} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-900">
                  Table {c.tableNumber} — {c.teamName} (acknowledged)
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => completeCall(c.callId)}
                    disabled={busy}
                    className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-200 disabled:opacity-50"
                  >
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelCall(c.callId)}
                    disabled={busy}
                    className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </span>
              </li>
            ))}
            {unanswered.map((c) => (
              <li key={c.callId} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-900">
                  Table {c.tableNumber} — {c.teamName} (unanswered)
                </span>
                <button
                  type="button"
                  onClick={() => cancelCall(c.callId)}
                  disabled={busy}
                  className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
