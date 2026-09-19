'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import CreateTournamentForm from '@/components/admin/CreateTournamentForm';
import TournamentList from '@/components/admin/TournamentList';

interface Me {
  role: 'director' | 'admin';
  entityId: string;
  displayName: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const data: Me = await res.json();
        if (!cancelled) setMe(data);
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore — clearing cookie is best-effort
    }
    router.replace('/login');
  }, [router]);

  if (checking) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    );
  }

  if (!me) return null; // redirecting

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {me.role === 'admin' ? 'Tournament Admin' : 'My Tournaments'}
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600">
            {me.displayName}
            {me.role === 'admin' && ' (admin)'}
          </span>
          {me.role === 'admin' && (
            <a
              href="/admin/directors"
              className="rounded-md bg-gray-100 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-200"
            >
              Manage Directors
            </a>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md bg-gray-100 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-200"
          >
            Sign Out
          </button>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">Create Tournament</h2>
        <CreateTournamentForm onCreated={() => setReloadKey((k) => k + 1)} />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-800">
          {me.role === 'admin' ? 'All Tournaments' : 'Your Tournaments'}
        </h2>
        <TournamentList reloadKey={reloadKey} />
      </section>
    </main>
  );
}
