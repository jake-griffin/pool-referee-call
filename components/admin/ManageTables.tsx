'use client';

import { useState } from 'react';
import { parseTableRange } from '@/lib/tables/range-parser';
import { extractUserMessage } from '@/lib/utils/errors';

interface ManageTablesProps {
  tournamentId: string;
  /** Legacy per-tournament admin token. Optional when authorized via session. */
  adminToken?: string | null;
  tableNumbers: number[];
  /** Called after a successful update so the dashboard can refetch state. */
  onUpdated?: () => void;
  /** Hide the outer card + heading (e.g. when a collapsible wrapper provides them). */
  hideChrome?: boolean;
}

/**
 * Admin control to add or remove tables while a tournament is in progress.
 *
 * Removing a table does not cancel existing calls on it — referees can still
 * finish them — it only stops new calls from targeting that table. When a
 * removal affects active calls, the API reports the count and we surface it.
 */
export default function ManageTables({
  tournamentId,
  adminToken,
  tableNumbers,
  onUpdated,
  hideChrome,
}: ManageTablesProps) {
  const [addInput, setAddInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);

  async function saveTables(nextTables: number[]) {
    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/tables`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          // Include the admin token on the legacy path; when authorized via a
          // director/admin session the cookie carries authorization.
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ tableNumbers: nextTables }),
      });

      if (!response.ok) {
        setError(await extractUserMessage(response));
        return false;
      }

      const data = await response.json();
      if (data.affectedActiveCalls > 0) {
        const n = data.affectedActiveCalls;
        setNotice(
          `${n} active call${n === 1 ? '' : 's'} remain${n === 1 ? 's' : ''} on removed table${
            data.removedTables.length === 1 ? '' : 's'
          }. Those calls stay active so referees can finish them.`,
        );
      }
      onUpdated?.();
      return true;
    } catch {
      setError('Network error. Please try again.');
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addInput.trim()) return;

    const parsed = parseTableRange(addInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    const merged = Array.from(new Set([...tableNumbers, ...parsed.tables])).sort(
      (a, b) => a - b,
    );
    const ok = await saveTables(merged);
    if (ok) setAddInput('');
  }

  async function handleRemove(table: number) {
    // Guard against removing the last table.
    if (tableNumbers.length <= 1) {
      setError('A tournament must keep one or more tables.');
      setPendingRemove(null);
      return;
    }
    const next = tableNumbers.filter((t) => t !== table);
    await saveTables(next);
    setPendingRemove(null);
  }

  return (
    <div className={hideChrome ? '' : 'rounded-lg border border-gray-200 p-4'}>
      {!hideChrome && (
        <h3 className="text-lg font-semibold text-gray-900">Manage Tables</h3>
      )}
      <p className={`text-sm text-gray-600 ${hideChrome ? '' : 'mt-1'}`}>
        Add or remove tables while the tournament is in progress. Removing a table
        stops new calls for it; existing calls stay active.
      </p>

      {/* Current tables as removable chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        {tableNumbers.length === 0 ? (
          <span className="text-sm text-gray-500">No tables configured.</span>
        ) : (
          tableNumbers.map((table) => (
            <span
              key={table}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800"
            >
              Table {table}
              {pendingRemove === table ? (
                <span className="ml-1 inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleRemove(table)}
                    disabled={isSaving}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemove(null)}
                    disabled={isSaving}
                    className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Remove table ${table}`}
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setPendingRemove(table);
                  }}
                  className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                >
                  &times;
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {/* Add tables */}
      <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          placeholder="Add tables, e.g. 19 or 20-22"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={isSaving || !addInput.trim()}
          className="min-h-[44px] rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Add'}
        </button>
      </form>

      {error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
