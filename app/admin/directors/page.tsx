'use client';

import { useState, useEffect } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) { router.replace('/login'); return; }
        const data = await res.json();
        if (data.role !== 'admin') { router.replace('/admin'); return; }
        if (!cancelled) setAuthorized(true);
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

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
    </main>
  );
}
