'use client';

import { useParams } from 'next/navigation';
import { usePolling } from '@/lib/hooks/usePolling';
import StickyHeader from '@/components/referee/StickyHeader';
import QueueTabs from '@/components/referee/QueueTabs';
import EnableNotifications from '@/components/referee/EnableNotifications';

interface UnansweredCallEntry {
  callId: string;
  teamName: string;
  tableNumber: number;
  createdAt: string;
  elapsedSeconds: number;
}

interface RefereeQueueEntry {
  callId: string;
  teamName: string;
  tableNumber: number;
  acknowledgedAt: string;
  elapsedSeconds: number;
  position: number;
}

interface TournamentState {
  lastUpdatedAt: string;
  tournament: { name: string; status: string };
  unansweredQueue: UnansweredCallEntry[];
  refereeQueues: Record<
    string,
    { refereeName: string; calls: RefereeQueueEntry[] }
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

export default function RefereePage() {
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

  const unansweredCalls = data?.unansweredQueue ?? [];

  // The referee's own acknowledged calls come from refereeQueues.
  // We match our queue by finding the entry whose callIds overlap with myCalls.
  const myRefereeQueue = (() => {
    if (!data?.refereeQueues) return [];
    const myCallIds = new Set((data.myCalls ?? []).map((c) => c.callId));
    for (const [, queue] of Object.entries(data.refereeQueues)) {
      if (queue.calls.some((c) => myCallIds.has(c.callId))) {
        return queue.calls.map((c) => ({
          callId: c.callId,
          teamName: c.teamName,
          tableNumber: c.tableNumber,
          acknowledgedAt: c.acknowledgedAt,
        }));
      }
    }
    return [];
  })();

  if (isLoading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <StickyHeader
        unansweredCount={unansweredCalls.length}
        myQueueCount={myRefereeQueue.length}
      />

      <EnableNotifications tournamentId={tournamentId} />

      {showConnectionBanner && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-center text-sm text-yellow-800">
          Connection issue — retrying…
        </div>
      )}

      <QueueTabs
        unansweredCalls={unansweredCalls.map((c) => ({
          callId: c.callId,
          teamName: c.teamName,
          tableNumber: c.tableNumber,
          createdAt: c.createdAt,
        }))}
        myCalls={myRefereeQueue}
        tournamentId={tournamentId}
        onAction={() => { refetch(); }}
      />
    </div>
  );
}
