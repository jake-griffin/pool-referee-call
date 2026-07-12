'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { extractUserMessage } from '@/lib/utils/errors';

interface ArchiveCall {
  callId: string;
  teamName: string;
  tableNumber: number;
  status: string;
  refereeName?: string;
  createdAt: string;
  acknowledgedAt?: string;
  completedAt?: string;
}

interface ArchiveData {
  tournament: {
    name: string;
    status: string;
    createdAt: string;
  };
  calls: ArchiveCall[];
  referees: Array<{ refereeId: string; refereeName: string }>;
  teams: Array<{ teamId: string; teamName: string }>;
}

export default function TournamentArchivePage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params.id;

  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [archive, setArchive] = useState<ArchiveData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load adminToken from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(`adminToken_${tournamentId}`);
    if (stored) {
      setAdminToken(stored);
    }
  }, [tournamentId]);

  const fetchArchive = useCallback(async (token: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/archive`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const msg = await extractUserMessage(response);
        setError(msg);
        return;
      }

      const data: ArchiveData = await response.json();
      setArchive(data);
    } catch {
      setError('Failed to load archive. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    if (adminToken) {
      fetchArchive(adminToken);
    }
  }, [adminToken, fetchArchive]);

  function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tokenInput.trim()) {
      const token = tokenInput.trim();
      setAdminToken(token);
      localStorage.setItem(`adminToken_${tournamentId}`, token);
    }
  }

  if (!adminToken) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Tournament Archive</h1>
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
              placeholder="Enter admin token to view archive"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={!tokenInput.trim()}
            className="min-h-[44px] min-w-[44px] w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            View Archive
          </button>
        </form>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="py-8 text-center text-sm text-gray-500">Loading archive...</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Tournament Archive</h1>
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      </main>
    );
  }

  if (!archive) {
    return null;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{archive.tournament.name} — Archive</h1>
        <p className="text-sm text-gray-500">
          Created {new Date(archive.tournament.createdAt).toLocaleDateString()}
        </p>
      </header>

      {archive.calls.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">No calls recorded for this tournament.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Call ID
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Team
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Table
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Referee
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Created
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Acknowledged
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Completed
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {archive.calls.map((call) => (
                <tr key={call.callId}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs font-mono text-gray-500">
                    {call.callId.slice(0, 8)}…
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
                    {call.teamName}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">
                    {call.tableNumber}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        call.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : call.status === 'acknowledged'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {call.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-600">
                    {call.refereeName ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                    {formatTimestamp(call.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                    {call.acknowledgedAt ? formatTimestamp(call.acknowledgedAt) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                    {call.completedAt ? formatTimestamp(call.completedAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}
