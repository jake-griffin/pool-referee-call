'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { usePolling } from '@/lib/hooks/usePolling';
import { extractUserMessage } from '@/lib/utils/errors';
import JoinLinks from '@/components/admin/JoinLinks';
import QueueBoard from '@/components/admin/QueueBoard';
import ManageTables from '@/components/admin/ManageTables';
import ParticipantsList from '@/components/admin/ParticipantsList';
import ClearData from '@/components/admin/ClearData';
import CollapsibleSection from '@/components/admin/CollapsibleSection';
import ActOnBehalf from '@/components/admin/ActOnBehalf';

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
  participants?: {
    referees: Array<{ id: string; name: string; joinedAt: string }>;
    teams: Array<{ id: string; name: string; joinedAt: string }>;
  };
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
  const [serverJoinLinks, setServerJoinLinks] = useState<{ referee: string; player: string } | null>(null);
  // True when a director/admin global session authorizes this tournament, so no
  // per-tournament admin token prompt is needed.
  const [hasGlobalAccess, setHasGlobalAccess] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  // When true, only the Queue Board is shown; all other sections are hidden.
  const [queuesMaximized, setQueuesMaximized] = useState(false);

  // Whether the dashboard is authorized (via global session or admin token).
  const isAuthorized = hasGlobalAccess || !!adminToken;

  // Fetch the referee/player join links from the server (admin session required).
  // This lets the QR codes render on any device, not just the one that created
  // the tournament. Returns null if unavailable (e.g. legacy tournament).
  const fetchJoinLinks = useCallback(async () => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/join-links`, {
        credentials: 'include',
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.available && data.joinLinks) {
        setServerJoinLinks(data.joinLinks);
      }
    } catch {
      // Network error — fall back to localStorage tokens if present.
    }
  }, [tournamentId]);

  // On mount, try to authorize via a director/admin global session first. If
  // that works we can manage this tournament without the admin token. Otherwise
  // fall back to a stored per-tournament admin token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Try the global session path (director owner / admin).
      try {
        const res = await fetch(`/api/tournaments/${tournamentId}/join/admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        if (!cancelled && res.ok) {
          setHasGlobalAccess(true);
          setCheckingAccess(false);
          fetchJoinLinks();
          return;
        }
      } catch {
        // fall through to token path
      }

      // 2. Fall back to a stored per-tournament admin token.
      const stored = localStorage.getItem(`adminToken_${tournamentId}`);
      if (!cancelled && stored) {
        setAdminToken(stored);
        fetch(`/api/tournaments/${tournamentId}/join/admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ adminToken: stored }),
        })
          .then(() => fetchJoinLinks())
          .catch(() => {});
      }
      if (!cancelled) setCheckingAccess(false);
    })();
    return () => { cancelled = true; };
  }, [tournamentId, fetchJoinLinks]);

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

  const { data: state, isLoading, showConnectionBanner, refetch } = usePolling<TournamentState | null>({
    fetchFn: fetchState,
    intervalMs: 4000,
    enabled: isAuthorized,
  });

  async function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tokenInput.trim()) {
      const token = tokenInput.trim();
      setAdminToken(token);
      localStorage.setItem(`adminToken_${tournamentId}`, token);

      // Create an admin session so the state endpoint works
      try {
        await fetch(`/api/tournaments/${tournamentId}/join/admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ adminToken: token }),
        });
        // Session established — fetch join links so QR codes render.
        await fetchJoinLinks();
      } catch {
        // Session creation failed — dashboard still works, just no queue board
      }
    }
  }

  async function handleDeleteParticipant(kind: 'team' | 'referee', entityId: string) {
    const path =
      kind === 'team'
        ? `/api/tournaments/${tournamentId}/teams/${entityId}`
        : `/api/tournaments/${tournamentId}/referees/${entityId}`;
    try {
      const response = await fetch(path, {
        method: 'DELETE',
        headers: {
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        credentials: 'include',
      });
      if (response.ok) {
        refetch();
      }
    } catch {
      // Swallow — the row clears its pending state and polling will reconcile.
    }
  }

  async function handleClose() {
    if (!isAuthorized) return;
    setIsClosing(true);
    setCloseError(null);

    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Include the admin token when we only have that (legacy path). When
          // authorized via a global session, the cookie carries authorization.
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        credentials: 'include',
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

  if (checkingAccess) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    );
  }

  if (!isAuthorized) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Tournament Admin</h1>
        <p className="mb-4 text-sm text-gray-600">
          Sign in as the tournament&apos;s director to manage it, or enter the
          tournament admin token below.
        </p>
        <a
          href="/login"
          className="mb-4 inline-block text-sm font-medium text-blue-600 hover:underline"
        >
          Sign in as director / admin
        </a>
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

  // Construct join links. Prefer links fetched from the server (they include
  // the required ?t=<tournamentId> query string and work on any device). Fall
  // back to tokens saved in localStorage at creation time, appending the same
  // query string the join pages require.
  const localRefereeToken = localStorage.getItem(`refereeToken_${tournamentId}`) ?? '';
  const localPlayerToken = localStorage.getItem(`playerToken_${tournamentId}`) ?? '';
  const refereeLink =
    serverJoinLinks?.referee ??
    (localRefereeToken
      ? `${baseUrl}/join/referee/${localRefereeToken}?t=${tournamentId}`
      : '');
  const playerLink =
    serverJoinLinks?.player ??
    (localPlayerToken
      ? `${baseUrl}/join/player/${localPlayerToken}?t=${tournamentId}`
      : '');

  const tournamentName = state?.tournament?.name ?? 'Tournament';
  const tournamentStatus = isClosed ? 'closed' : (state?.tournament?.status ?? 'unknown');

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      {!queuesMaximized && (
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
          <div className="flex flex-wrap items-center gap-2">
            {isAuthorized && state?.participants && (
              <ClearData
                tournamentId={tournamentId}
                adminToken={adminToken}
                refereeCount={state.participants.referees?.length ?? 0}
                teamCount={state.participants.teams?.length ?? 0}
                onCleared={() => { refetch(); }}
              />
            )}
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
      )}

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
      {!queuesMaximized && (refereeLink || playerLink) && (
        <section className="mb-8">
          <CollapsibleSection title="Join Links">
            <JoinLinks
              refereeLink={refereeLink || `${baseUrl}/join/referee/[token not available]`}
              playerLink={playerLink || `${baseUrl}/join/player/[token not available]`}
              hideTitle
            />
          </CollapsibleSection>
        </section>
      )}

      {/* Manage Tables */}
      {!queuesMaximized && tournamentStatus === 'active' && isAuthorized && state?.tournament && (
        <section className="mb-8">
          <CollapsibleSection title="Manage Tables">
            <ManageTables
              tournamentId={tournamentId}
              adminToken={adminToken}
              tableNumbers={state.tournament.tableNumbers ?? []}
              onUpdated={() => { refetch(); }}
              hideChrome
            />
          </CollapsibleSection>
        </section>
      )}

      {/* Participants */}
      {!queuesMaximized && state?.participants && (
        <section className="mb-8">
          <CollapsibleSection title="Participants">
            <ParticipantsList
              referees={state.participants.referees ?? []}
              teams={state.participants.teams ?? []}
              onDelete={isAuthorized ? handleDeleteParticipant : undefined}
              hideChrome
            />
          </CollapsibleSection>
        </section>
      )}

      {/* Act on behalf of participants */}
      {!queuesMaximized && tournamentStatus === 'active' && isAuthorized && state?.participants && (
        <section className="mb-8">
          <CollapsibleSection title="Act on behalf" defaultOpen={false}>
            <ActOnBehalf
              tournamentId={tournamentId}
              adminToken={adminToken}
              tableNumbers={state.tournament?.tableNumbers ?? []}
              teams={(state.participants.teams ?? []).map((t) => ({ id: t.id, name: t.name }))}
              referees={(state.participants.referees ?? []).map((r) => ({ id: r.id, name: r.name }))}
              activeCalls={[
                ...(state.unansweredQueue ?? []).map((c) => ({
                  callId: c.callId,
                  teamName: c.teamName,
                  tableNumber: c.tableNumber,
                  status: 'unanswered',
                })),
                ...Object.values(state.refereeQueues ?? {}).flatMap((q) =>
                  q.calls.map((c) => ({
                    callId: c.callId,
                    teamName: c.teamName,
                    tableNumber: c.tableNumber,
                    status: 'acknowledged',
                  })),
                ),
              ]}
              onChanged={() => { refetch(); }}
            />
          </CollapsibleSection>
        </section>
      )}

      {/* Queue Board */}
      <section>
        <div className="mb-2 flex items-center justify-end">
          <button
            type="button"
            onClick={() => setQueuesMaximized((v) => !v)}
            aria-label={queuesMaximized ? 'Exit full screen' : 'Maximize queues'}
            title={queuesMaximized ? 'Exit full screen' : 'Maximize queues'}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100"
          >
            {queuesMaximized ? (
              /* Minimize / exit-fullscreen icon */
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              /* Maximize / fullscreen icon */
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
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
