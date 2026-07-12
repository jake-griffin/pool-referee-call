'use client';

import { useState } from 'react';
import { extractUserMessage } from '@/lib/utils/errors';

interface CallFormProps {
  tableNumbers: number[];
  tournamentId: string;
  activeCallCount: number;
  onCallCreated?: () => void;
}

export default function CallForm({
  tableNumbers,
  tournamentId,
  activeCallCount,
  onCallCreated,
}: CallFormProps) {
  const [selectedTable, setSelectedTable] = useState<string>(
    tableNumbers.length > 0 ? String(tableNumbers[0]) : '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAtLimit = activeCallCount >= 2;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAtLimit || loading || !selectedTable) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber: Number(selectedTable) }),
      });

      if (!response.ok) {
        const message = await extractUserMessage(response);
        setError(message);
        return;
      }

      onCallCreated?.();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Request a Referee</h2>

      {isAtLimit ? (
        <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          You already have 2 active calls. Wait for one to be completed.
        </p>
      ) : (
        <>
          <label htmlFor="table-select" className="mt-3 block text-sm font-medium text-gray-700">
            Table Number
          </label>
          <select
            id="table-select"
            value={selectedTable}
            onChange={(e) => setSelectedTable(e.target.value)}
            disabled={loading}
            className="mt-1 block w-full min-h-[44px] rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {tableNumbers.map((num) => (
              <option key={num} value={String(num)}>
                Table {num}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={loading || !selectedTable}
            className="mt-4 min-h-[44px] min-w-[44px] w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Submitting…
              </span>
            ) : (
              'Call Referee'
            )}
          </button>
        </>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
