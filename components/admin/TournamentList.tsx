'use client';

import { useState, useEffect, useCallback } from 'react';
import { extractUserMessage } from '@/lib/utils/errors';

interface TournamentSummary {
  tournamentId: string;
  name: string;
  status: string;
  createdAt: string;
  tableNumbers: number[];
}

interface TournamentListProps {
  /** Bump to trigger a refetch (e.g. after creating a tournament). */
  reloadKey?: number;
}

export default function TournamentList({ reloadKey = 0 }: TournamentListProps) {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchTournaments();
  }, [fetchTournaments, reloadKey]);

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

  return (
    <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
      {tournaments.map((t) => (
        <li key={t.tournamentId}>
          <a
            href={`/admin/${t.tournamentId}`}
            className="flex min-h-[44px] items-center justify-between px-4 py-3 hover:bg-gray-50"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">{t.name}</p>
              <p className="text-xs text-gray-500">
                {t.tableNumbers.length} tables · Created{' '}
                {new Date(t.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                t.status === 'active'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {t.status}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
