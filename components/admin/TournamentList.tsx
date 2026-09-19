'use client';

import { useState, useEffect, useCallback } from 'react';
import { extractUserMessage } from '@/lib/utils/errors';

interface TournamentSummary {
  tournamentId: string;
  name: string;
  status: string;
  createdAt: string;
  tableNumbers: number[];
  ownerId?: string | null;
}

interface DirectorSummary {
  directorId: string;
  name: string;
  email: string;
}

interface TournamentListProps {
  /** Bump to trigger a refetch (e.g. after creating a tournament). */
  reloadKey?: number;
}

export default function TournamentList({ reloadKey = 0 }: TournamentListProps) {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Directors are only fetchable by the admin; an empty list means the viewer
  // is a director (or there are none), in which case the assign control hides.
  const [directors, setDirectors] = useState<DirectorSummary[] | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const fetchTournaments = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/tournaments', {
        credentials: 'include',
      });

      if (!response.ok) {
        const msg = await extractUserMessage(response);
        setError(msg);
        return;
      }

      const data: TournamentSummary[] = await response.json();
      setTournaments(data);
      setError(null);
    } catch {
      setError('Failed to load tournaments. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchDirectors = useCallback(async () => {
    try {
      const res = await fetch('/api/directors', { credentials: 'include' });
      if (!res.ok) {
        // 401 => viewer is a director, not the admin; no assign control.
        setDirectors(null);
        return;
      }
      setDirectors(await res.json());
    } catch {
      setDirectors(null);
    }
  }, []);

  async function assignOwner(tournamentId: string, directorId: string | null) {
    setAssignError(null);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/owner`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ directorId }),
      });
      if (!res.ok) {
        setAssignError(await extractUserMessage(res));
        return;
      }
      await fetchTournaments();
    } catch {
      setAssignError('Failed to update owner. Please try again.');
    }
  }

  useEffect(() => {
    fetchTournaments();
    fetchDirectors();
  }, [fetchTournaments, fetchDirectors, reloadKey]);

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        Loading tournaments...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
        {error}
      </div>
    );
  }

  if (tournaments.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        No tournaments yet. Create one above to get started.
      </div>
    );
  }

  const directorName = (id?: string | null) =>
    directors?.find((d) => d.directorId === id)?.name ?? null;

  return (
    <>
      {assignError && (
        <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {assignError}
        </div>
      )}
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
        {tournaments.map((t) => (
          <li key={t.tournamentId} className="px-4 py-3">
            <div className="flex min-h-[44px] items-center justify-between">
              <a href={`/admin/${t.tournamentId}`} className="flex-1 hover:opacity-80">
                <p className="text-sm font-medium text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-500">
                  {t.tableNumbers.length} tables · Created{' '}
                  {new Date(t.createdAt).toLocaleDateString()}
                  {directors && (
                    <>
                      {' · '}
                      {t.ownerId
                        ? `Owner: ${directorName(t.ownerId) ?? t.ownerId}`
                        : 'Unassigned'}
                    </>
                  )}
                </p>
              </a>
              <span
                className={`ml-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  t.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {t.status}
              </span>
            </div>

            {/* Admin-only: assign/un-assign the owning director */}
            {directors && directors.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor={`owner-${t.tournamentId}`} className="text-xs text-gray-500">
                  Assign to:
                </label>
                <select
                  id={`owner-${t.tournamentId}`}
                  value={t.ownerId ?? ''}
                  onChange={(e) => assignOwner(t.tournamentId, e.target.value || null)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Unassigned</option>
                  {directors.map((d) => (
                    <option key={d.directorId} value={d.directorId}>
                      {d.name} ({d.email})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
