'use client';

import { useState, useEffect } from 'react';
import { elapsedSeconds } from '@/lib/utils/time';
import { extractUserMessage } from '@/lib/utils/errors';

interface CallCardProps {
  call: {
    callId: string;
    teamName: string;
    tableNumber: number;
    createdAt?: string;
    acknowledgedAt?: string;
  };
  mode: 'new' | 'mine';
  tournamentId: string;
  onAction?: () => void;
}

export default function CallCard({ call, mode, tournamentId, onAction }: CallCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(() => {
    const timestamp = mode === 'new' ? call.createdAt : call.acknowledgedAt;
    return timestamp ? elapsedSeconds(timestamp) : 0;
  });

  // Tick the elapsed time every second
  useEffect(() => {
    const timestamp = mode === 'new' ? call.createdAt : call.acknowledgedAt;
    if (!timestamp) return;

    const interval = setInterval(() => {
      setElapsed(elapsedSeconds(timestamp));
    }, 1000);

    return () => clearInterval(interval);
  }, [call.createdAt, call.acknowledgedAt, mode]);

  const handleAction = async () => {
    setLoading(true);
    setError(null);

    const endpoint =
      mode === 'new'
        ? `/api/calls/${call.callId}/acknowledge`
        : `/api/calls/${call.callId}/complete`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId }),
      });

      if (!response.ok) {
        const message = await extractUserMessage(response);
        setError(message);
        return;
      }

      onAction?.();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatElapsed = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-2xl font-bold text-gray-900">
            Table {call.tableNumber}
          </p>
          <p className="mt-1 text-sm text-gray-600">{call.teamName}</p>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
          {formatElapsed(elapsed)}
        </span>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={handleAction}
          disabled={loading}
          className={`min-h-[44px] min-w-[44px] w-full rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
            mode === 'new'
              ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
              : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
          }`}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
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
              Processing…
            </span>
          ) : mode === 'new' ? (
            'Acknowledge'
          ) : (
            'Mark Complete'
          )}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
