'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { extractUserMessage } from '@/lib/utils/errors';

/**
 * Admin-only page to create Tournament Director accounts (invite-only).
 * Redirects non-admins to /login.
 */
export default function ManageDirectorsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  interface DirectorSummary {
    directorId: string;
    email: string;
    name: string;
    createdAt: string;
    disabled: boolean;
  }
  const [directors, setDirectors] = useState<DirectorSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const fetchDirectors = useCallback(async () => {
    try {
      const res = await fetch('/api/directors', { credentials: 'include' });
      if (!res.ok) {
        setListError(await extractUserMessage(res));
        return;
      }
      setDirectors(await res.json());
      setListError(null);
    } catch {
      setListError('Failed to load directors.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) { router.replace('/login'); return; }
        const data = await res.json();
        if (data.role !== 'admin') { router.replace('/admin'); return; }
        if (!cancelled) {
          setAuthorized(true);
          fetchDirectors();
        }
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router, fetchDirectors]);

  async function toggleDisabled(directorId: string, disabled: boolean) {
    try {
      const res = await fetch(`/api/directors/${directorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ disabled }),
      });
      if (!res.ok) {
        setListError(await extractUserMessage(res));
        return;
      }
      await fetchDirectors();
    } catch {
      setListError('Failed to update director.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/directors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });

      if (!res.ok) {
        setError(await extractUserMessage(res));
        return;
      }

      const data = await res.json();
      setCreated(`${data.name} (${data.email})`);
      setName('');
      setEmail('');
      setPassword('');
      fetchDirectors();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (checking) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Manage Directors</h1>
        <a href="/admin" className="text-sm font-medium text-blue-600 hover:underline">
          Back
        </a>
      </div>

      <p className="mb-4 text-sm text-gray-600">
        Create a Tournament Director account. They will be able to sign in and
        manage only the tournaments they create.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="d-name" className="block text-sm font-medium text-gray-700">Name</label>
          <input
            id="d-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="d-email" className="block text-sm font-medium text-gray-700">Email</label>
          <input
            id="d-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="d-password" className="block text-sm font-medium text-gray-700">
            Temporary Password (min 8 characters)
          </label>
          <input
            id="d-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}
        {created && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700" role="status">
            Created director: {created}. Share the temporary password securely.
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[44px] w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Creating...' : 'Create Director'}
        </button>
      </form>

      {/* Existing directors */}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">Directors</h2>
        {listError && (
          <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
            {listError}
          </div>
        )}
        {directors.length === 0 ? (
          <p className="text-sm text-gray-500">No directors yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
            {directors.map((d) => (
              <li key={d.directorId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {d.name}
                    {d.disabled && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        disabled
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{d.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleDisabled(d.directorId, !d.disabled)}
                  className={`min-h-[36px] rounded-md px-3 py-1.5 text-sm font-medium ${
                    d.disabled
                      ? 'bg-green-100 text-green-800 hover:bg-green-200'
                      : 'bg-red-100 text-red-800 hover:bg-red-200'
                  }`}
                >
                  {d.disabled ? 'Enable' : 'Disable'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
