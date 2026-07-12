'use client';

import { useParams } from 'next/navigation';
import { usePolling } from '@/lib/hooks/usePolling';
import CallForm from '@/components/player/CallForm';
import MyCallsList from '@/components/player/MyCallsList';

interface TournamentState {
  lastUpdatedAt: string;
  tournament: { name: string; status: string; tableNumbers: number[] };
  unansweredQueue: Array<{
    callId: string;
    teamName: string;
    tableNumber: number;
    createdAt: string;
    elapsedSeconds: number;
  }>;
  refereeQueues: Record<
    string,
    {
      refereeName: string;
      calls: Array<{
        callId: string;
        teamName: string;
        tableNumber: number;
        acknowledgedAt: string;
        elapsedSeconds: number;
        position: number;
      }>;
    }
  >;
  myCalls: Array<{
    callId: string;
    tableNumber: number;
    status: string;
    refereeName: string | null;
    position: number | null;
    createdAt: string;
  }>;
}

export default function PlayerPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params.id;

  const { data, isLoading, showConnectionBanner, refetch } = usePolling<TournamentState>({
    fetchFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/state`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    intervalMs: 4000,
    enabled: true,
  });

  const tableNumbers = data?.tournament.tableNumbers ?? [];
  const myCalls = data?.myCalls ?? [];
  const lastUpdatedAt = data?.lastUpdatedAt ?? '';

  // Count active calls (unanswered or acknowledged)
  const activeCallCount = myCalls.filter(
    (c) => c.status === 'unanswered' || c.status === 'acknowledged',
  ).length;

  if (isLoading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900">
          {data?.tournament.name ?? 'Tournament'}
        </h1>
      </header>

      {showConnectionBanner && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-center text-sm text-yellow-800">
          Connection issue — retrying…
        </div>
      )}

      <main className="mx-auto max-w-lg space-y-4 p-4">
        <CallForm
          tableNumbers={tableNumbers}
          tournamentId={tournamentId}
          activeCallCount={activeCallCount}
          onCallCreated={() => { refetch(); }}
        />

        <MyCallsList
          myCalls={myCalls}
          lastUpdatedAt={lastUpdatedAt}
        />
      </main>
    </div>
  );
}
