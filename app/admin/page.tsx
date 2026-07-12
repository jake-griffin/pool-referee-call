'use client';

import { useState } from 'react';
import CreateTournamentForm from '@/components/admin/CreateTournamentForm';
import TournamentList from '@/components/admin/TournamentList';

export default function AdminPage() {
  const [adminSecret, setAdminSecret] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [secretInput, setSecretInput] = useState('');

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (secretInput.trim()) {
      setAdminSecret(secretInput.trim());
      setIsAuthenticated(true);
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Admin Login</h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="admin-secret" className="block text-sm font-medium text-gray-700">
              Admin Secret
            </label>
            <input
              id="admin-secret"
              type="password"
              value={secretInput}
              onChange={(e) => setSecretInput(e.target.value)}
              required
              placeholder="Enter ADMIN_SECRET"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={!secretInput.trim()}
            className="min-h-[44px] min-w-[44px] w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sign In
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-8 text-2xl font-bold text-gray-900">Tournament Admin</h1>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">Create Tournament</h2>
        <CreateTournamentForm adminSecret={adminSecret} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-800">Tournaments</h2>
        <TournamentList adminSecret={adminSecret} />
      </section>
    </main>
  );
}
