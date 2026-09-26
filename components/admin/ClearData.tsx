'use client';

import { useState } from 'react';
import { extractUserMessage } from '@/lib/utils/errors';

interface ClearDataProps {
  tournamentId: string;
  /** Legacy per-tournament admin token, when authorized that way. */
  adminToken?: string | null;
  refereeCount: number;
  teamCount: number;
  /** Called after a successful clear so the dashboard can refetch. */
  onCleared?: () => void;
}

/**
 * Admin/owning-director control to wipe a tournament's participants and history
 * (referees, teams, calls, sessions, push subscriptions) before the real event.
 * The tournament and its join links are preserved. Requires typing CLEAR to
 * confirm, since this is destructive and irreversible.
 */
export default function ClearData({
  tournamentId,
  adminToken,
  refereeCount,
  teamCount,
  onCleared,
}: ClearDataProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleClear() {
    setIsClearing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/participants`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        setError(await extractUserMessage(res));
        return;
      }
      const data = await res.json();
      const c = data.cleared ?? {};
      setNotice(
        `Cleared ${c.teams ?? 0} teams, ${c.referees ?? 0} referees, and ${c.calls ?? 0} calls.`,
      );
      setOpen(false);
      setConfirmText('');
      onCleared?.();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="rounded-lg border border-red-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900">Clear participants &amp; history</h3>
      <p className="mt-1 text-sm text-gray-600">
        Permanently remove all players/teams, referees, and call history for this
        tournament. The tournament and its join links are kept, so everyone can
        re-join for the real event. Use this to clear test data.
      </p>
      <p className="mt-2 text-xs text-gray-500">
        Currently: {teamCount} team{teamCount === 1 ? '' : 's'} · {refereeCount}{' '}
        referee{refereeCount === 1 ? '' : 's'}.
      </p>

      {notice && (
        <div className="mt-3 rounded-md bg-green-50 p-3 text-sm text-green-700" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setNotice(null); setError(null); }}
          className="mt-3 min-h-[44px] rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Clear test data
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-medium text-red-700">
            This cannot be undone. Type <span className="font-mono">CLEAR</span> to confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="CLEAR"
            className="block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClear}
              disabled={confirmText !== 'CLEAR' || isClearing}
              className="min-h-[44px] rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isClearing ? 'Clearing…' : 'Permanently clear'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirmText(''); }}
              disabled={isClearing}
              className="min-h-[44px] rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
