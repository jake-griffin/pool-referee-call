'use client';

import CallCard from './CallCard';

interface UnansweredCall {
  callId: string;
  teamName: string;
  tableNumber: number;
  createdAt: string;
}

interface MyCall {
  callId: string;
  teamName: string;
  tableNumber: number;
  acknowledgedAt: string;
}

interface QueueTabsProps {
  unansweredCalls: UnansweredCall[];
  myCalls: MyCall[];
  tournamentId: string;
  onAction?: () => void;
}

export default function QueueTabs({ unansweredCalls, myCalls, tournamentId, onAction }: QueueTabsProps) {
  return (
    <div className="space-y-6 p-4">
      {/* My Queue section — show first so referee sees their active work */}
      {myCalls.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center text-sm font-semibold uppercase tracking-wide text-gray-500">
            My Queue
            <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800">
              {myCalls.length}
            </span>
          </h2>
          <div className="space-y-3">
            {myCalls.map((call) => (
              <CallCard
                key={call.callId}
                call={call}
                mode="mine"
                tournamentId={tournamentId}
                onAction={onAction}
              />
            ))}
          </div>
        </section>
      )}

      {/* New Calls section */}
      <section>
        <h2 className="mb-3 flex items-center text-sm font-semibold uppercase tracking-wide text-gray-500">
          New Calls
          {unansweredCalls.length > 0 && (
            <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">
              {unansweredCalls.length}
            </span>
          )}
        </h2>
        <div className="space-y-3">
          {unansweredCalls.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No pending calls — all quiet!
            </p>
          ) : (
            unansweredCalls.map((call) => (
              <CallCard
                key={call.callId}
                call={call}
                mode="new"
                tournamentId={tournamentId}
                onAction={onAction}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
