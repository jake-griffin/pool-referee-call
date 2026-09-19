'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { extractUserMessage } from '@/lib/utils/errors';

/**
 * Sign-in page for Tournament Directors and the global admin.
 *
 * Directors sign in with email + password. The admin can sign in with the
 * ADMIN_SECRET. Both receive a global session cookie (gsession) and land on
 * the admin dashboard.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'director' | 'admin'>('director');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminSecret, setAdminSecret] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const payload =
      mode === 'admin'
        ? { adminSecret: adminSecret.trim() }
        : { email: email.trim(), password };

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setError(await extractUserMessage(res));
        return;
      }

      router.push('/admin');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Sign In</h1>

      <div className="mb-6 flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'director'}
          onClick={() => { setMode('director'); setError(null); }}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
            mode === 'director'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Tournament Director
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'admin'}
          onClick={() => { setMode('admin'); setError(null); }}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
            mode === 'admin'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Admin
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'director' ? (
          <>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="admin-secret" className="block text-sm font-medium text-gray-700">
              Admin Secret
            </label>
            <input
              id="admin-secret"
              type="password"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              required
              placeholder="Enter ADMIN_SECRET"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[44px] w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </main>
  );
}
