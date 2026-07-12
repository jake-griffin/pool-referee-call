'use client';

import { useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';

/**
 * Referee join page.
 *
 * URL: /join/referee/[token]?t=[tournamentId]
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 19.1
 */
export default function RefereeJoinPage() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = params.token;
  const tournamentId = searchParams.get('t');

  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!tournamentId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <p className="text-center text-sm text-red-600">Invalid join link.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/join/referee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name }),
      });

      if (res.ok) {
        router.push(`/t/${tournamentId}/referee`);
        return;
      }

      if (res.status === 401) {
        setError('Invalid or expired link.');
      } else if (res.status === 403) {
        setError('This tournament is closed.');
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow"
      >
        <h1 className="text-lg font-bold text-gray-900 text-center">
          Join as Referee
        </h1>

        <div>
          <label
            htmlFor="display-name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Display Name
          </label>
          <input
            id="display-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Enter your name"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 text-center" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full min-h-[44px] rounded bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Joining…' : 'Join Tournament'}
        </button>
      </form>
    </div>
  );
}
