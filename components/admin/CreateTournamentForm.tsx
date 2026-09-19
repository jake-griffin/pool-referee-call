'use client';

import { useState, useMemo } from 'react';
import { parseTableRange } from '@/lib/tables/range-parser';
import { extractUserMessage } from '@/lib/utils/errors';
import JoinLinks from './JoinLinks';

interface CreateTournamentFormProps {
  /** Called after a tournament is successfully created. */
  onCreated?: () => void;
}

interface CreatedTournament {
  tournamentId: string;
  name: string;
  tableNumbers: number[];
  adminToken: string;
  refereeToken: string;
  playerToken: string;
  joinLinks: {
    referee: string;
    player: string;
  };
}

export default function CreateTournamentForm({ onCreated }: CreateTournamentFormProps) {
  const [name, setName] = useState('');
  const [tableRange, setTableRange] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedTournament | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const tablePreview = useMemo(() => {
    if (!tableRange.trim()) return null;
    const result = parseTableRange(tableRange);
    if (!result.ok) return { error: result.error, tables: null };
    return { error: null, tables: result.tables };
  }, [tableRange]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/admin/tournaments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), tableRange }),
      });

      if (!response.ok) {
        const msg = await extractUserMessage(response);
        setError(msg);
        return;
      }

      const data: CreatedTournament = await response.json();
      setCreated(data);
      onCreated?.();

      // Save the admin token to localStorage as a fallback for managing this
      // tournament without a signed-in session (legacy access path). The
      // referee/player tokens don't need saving — they're always recoverable
      // via the join links / QR codes shown on the dashboard.
      localStorage.setItem(`adminToken_${data.tournamentId}`, data.adminToken);

      setName('');
      setTableRange('');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <h3 className="text-lg font-semibold text-green-900">
            Tournament Created Successfully
          </h3>
          <p className="mt-1 text-sm text-green-700">
            <strong>{created.name}</strong> — {created.tableNumbers.length} tables
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            {showAdvanced ? '▾ Hide advanced' : '▸ Show advanced'}
          </button>

          {showAdvanced && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-800">
                Admin token (optional backup)
              </p>
              <p className="mt-1 text-xs text-gray-600">
                You already manage this tournament from your account, so you
                normally won&apos;t need this. It&apos;s a fallback credential:
                anyone with it can manage this tournament by entering it on the
                tournament admin page, without a director account. Keep it
                secret, and only save it if you want that fallback. It cannot be
                retrieved again later.
              </p>
              <dl className="mt-3 text-sm">
                <div>
                  <dt className="sr-only">Admin Token</dt>
                  <dd className="font-mono text-xs break-all text-gray-900">{created.adminToken}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        <JoinLinks
          refereeLink={created.joinLinks.referee}
          playerLink={created.joinLinks.player}
        />

        <button
          type="button"
          onClick={() => { setCreated(null); setShowAdvanced(false); }}
          className="min-h-[44px] min-w-[44px] rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
        >
          Create Another Tournament
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="tournament-name" className="block text-sm font-medium text-gray-700">
          Tournament Name
        </label>
        <input
          id="tournament-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. Friday Night 8-Ball"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="table-range" className="block text-sm font-medium text-gray-700">
          Table Range
        </label>
        <input
          id="table-range"
          type="text"
          value={tableRange}
          onChange={(e) => setTableRange(e.target.value)}
          required
          placeholder="e.g. 11-18, 29-36"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {tablePreview && (
          <div className="mt-2 text-sm">
            {tablePreview.error ? (
              <p className="text-red-600">{tablePreview.error}</p>
            ) : (
              <p className="text-green-700">
                Tables: {tablePreview.tables!.join(', ')} ({tablePreview.tables!.length} total)
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !name.trim() || !tableRange.trim() || (tablePreview !== null && tablePreview.error !== null)}
        className="min-h-[44px] min-w-[44px] w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? 'Creating...' : 'Create Tournament'}
      </button>
    </form>
  );
}
