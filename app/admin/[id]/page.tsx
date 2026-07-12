'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { usePolling } from '@/lib/hooks/usePolling';
import { extractUserMessage } from '@/lib/utils/errors';
import JoinLinks from '@/components/admin/JoinLinks';
import QueueBoard from '@/components/admin/QueueBoard';

interface TournamentState {
  tournament: {
    tournamentId: string;
    name: string;
    status: string;
    tableNumbers: number[];
  };
  unansweredQueue: Array<{
    callId: string;
    teamName: string;
    tableNumber: number;
    status: string;
    refereeName?: string;
    createdAt: string;
    acknowledgedAt?: string;
    completedAt?: string;
  }>;
  refereeQueues: Array<{
    refereeId: string;
    refereeName: string;
    calls: Array<{
      callId: string;
      teamName: string;
      tableNumber: number;
      status: string;
      refereeName?: string;
      createdAt: string;
      acknowledgedAt?: string;
      completedAt?: string;
    }>;
  }>;
  recentActivity: Array<{
    callId: string;
    teamName: string;
    tableNumber: number;
    status: string;
    refereeName?: string;
    createdAt: string;
    acknowledgedAt?: string;
    completedAt?: string;
  }>;
}

export default function TournamentAdminDashboard() {
  const params = useParams<{ id: string }>();
  const tournamentId = params.id;

  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState(false);

  // Load adminToken from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(`adminToken_${tournamentId}`);
    if (stored) {
      setAdminToken(stored);
    }
  }, [tournamentId]);

  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:3000';

  const fetchState = useCallback(async (): Promise<TournamentState | null> => {
    // Try fetching state — this requires a session cookie
    const response = await fetch(`/api/tournaments/${tournamentId}/state`, {
      credentials: 'include',
    });
    if (!response.ok) {
      // If unauthorized, we don't have a session — return null
      return null;
    }
    return response.json();
  }, [tournamentId]);

  const { data: state, isLoading, showConnectionBanner } = usePolling<TournamentState | null>({
    fetchFn: fetchState,
    intervalMs: 4000,
    enabled: !!adminToken,
  });

  function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tokenInput.trim()) {
      const token = tokenInput.trim();
      setAdminToken(token);
      localStorage.setItem(`adminToken_${tournamentId}`, token);
    }
  }

  async function handleClose() {
    if (!adminToken) return;
    setIsClosing(true);
    setCloseError(null);

    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
      });

      if (!response.ok) {
        const msg = await extractUserMessage(response);
        setCloseError(msg);
        return;
      }

      setIsClosed(true);
      setCloseConfirm(false);
    } catch {
      setCloseError('Network error. Please try again.');
    } finally {
      setIsClosing(false);
    }
  }

  if (!adminToken) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Tournament Admin</h1>
        <form onSubmit={handleTokenSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-token" className="block text-sm font-medium text-gray-700">
              Admin Token
            </label>
            <input
              id="admin-token"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              required
              placeholder="Enter admin token for this tournament"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={!tokenInput.trim()}
            className="min-h-[44px] min-w-[44px] w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Access Dashboard
          </button>
        </form>
      </main>
    );
  }

  // Construct join links from token info stored in localStorage
  const refereeToken = localStorage.getItem(`refereeToken_${tournamentId}`) ?? '';
  const playerToken = localStorage.getItem(`playerToken_${tournamentId}`) ?? '';
  const refereeLink = refereeToken ? `${baseUrl}/join/referee/${refereeToken}` : '';
  const playerLink = playerToken ? `${baseUrl}/join/player/${playerToken}` : '';

  const tournamentName = state?.tournament?.name ?? 'Tournament';
  const tournamentStatus = isClosed ? 'closed' : (state?.tournament?.status ?? 'unknown');

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tournamentName}</h1>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              tournamentStatus === 'active'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {tournamentStatus}
          </span>
        </div>

        {tournamentStatus === 'active' && (
          <div>
            {!closeConfirm ? (
              <button
                type="button"
                onClick={() => setCloseConfirm(true)}
                className="min-h-[44px] min-w-[44px] rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Close Tournament
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-700">Are you sure?</span>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isClosing}
                  className="min-h-[44px] min-w-[44px] rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isClosing ? 'Closing...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setCloseConfirm(false)}
                  className="min-h-[44px] min-w-[44px] rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {closeError && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {closeError}
        </div>
      )}

      {showConnectionBanner && (
        <div className="mb-4 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800" role="alert">
          Connection issue — attempting to reconnect...
        </div>
      )}

      {/* Join Links */}
      {(refereeLink || playerLink) && (
        <section className="mb-8">
          <JoinLinks
            refereeLink={refereeLink || `${baseUrl}/join/referee/[token not available]`}
            playerLink={playerLink || `${baseUrl}/join/player/[token not available]`}
          />
        </section>
      )}

      {/* Queue Board */}
      <section>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-500">Loading tournament state...</div>
        ) : state ? (
          <QueueBoard
            unansweredQueue={state.unansweredQueue ?? []}
            refereeQueues={Object.entries(state.refereeQueues ?? {}).map(([refereeId, queue]) => ({
              refereeId,
              refereeName: queue.refereeName,
              calls: queue.calls,
            }))}
            recentActivity={(state.recentActivity ?? []).slice(0, 20)}
          />
        ) : (
          <div className="rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-500">
            <p className="mb-2">Queue board requires an active session.</p>
            <p>Join the tournament as admin to see live queue data, or share the join links with referees and players.</p>
          </div>
        )}
      </section>

      {/* Archive link for closed tournaments */}
      {tournamentStatus === 'closed' && (
        <div className="mt-6">
          <a
            href={`/t/${tournamentId}/archive`}
            className="min-h-[44px] inline-flex items-center rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
          >
            View Archive
          </a>
        </div>
      )}
    </main>
  );
}
