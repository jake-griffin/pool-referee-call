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
 * The tournament and its join links are preserved.
 *
 * Renders as a header button that opens a modal with the clear panel, so the
 * dashboard isn't cluttered with this rarely-used destructive UI. Requires
 * typing CLEAR to confirm.
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

  function close() {
    setOpen(false);
    setConfirmText('');
    setError(null);
  }

  async function handleClear() {
    setIsClearing(true);
    setError(null);
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
      close();
      onCleared?.();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Reset Tournament
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reset tournament"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900">
              Reset Tournament
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Permanently remove all players/teams, referees, and call history for
              this tournament. The tournament and its join links are kept, so
              everyone can re-join for the real event.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Currently: {teamCount} team{teamCount === 1 ? '' : 's'} · {refereeCount}{' '}
              referee{refereeCount === 1 ? '' : 's'}.
            </p>

            {error && (
              <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            <p className="mt-4 text-sm font-medium text-red-700">
              This cannot be undone. Type <span className="font-mono">RESET</span> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET"
              autoFocus
              className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={isClearing}
                className="min-h-[44px] rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={confirmText !== 'RESET' || isClearing}
                className="min-h-[44px] rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isClearing ? 'Resetting…' : 'Reset Tournament'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
