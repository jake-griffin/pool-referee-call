'use client';

interface Call {
  callId: string;
  teamName: string;
  tableNumber: number;
  status: string;
  refereeName?: string;
  createdAt: string;
  acknowledgedAt?: string;
  completedAt?: string;
}

interface RefereeQueue {
  refereeId: string;
  refereeName: string;
  calls: Call[];
}

interface RefereeQueuesProps {
  refereeQueues: RefereeQueue[];
}

export default function RefereeQueues({ refereeQueues }: RefereeQueuesProps) {
  if (refereeQueues.length === 0) {
    return <p className="text-sm text-gray-400">No active referees</p>;
  }

  return (
    <div className="space-y-4">
      {refereeQueues.map((referee) => (
        <div key={referee.refereeId} className="rounded-md border border-blue-100 bg-blue-50 p-3">
          <h4 className="mb-2 text-sm font-medium text-blue-900">
            {referee.refereeName}
            <span className="ml-2 text-xs text-blue-600">
              ({referee.calls.length} {referee.calls.length === 1 ? 'call' : 'calls'})
            </span>
          </h4>
          {referee.calls.length === 0 ? (
            <p className="text-xs text-blue-400">Queue empty</p>
          ) : (
            <ul className="space-y-1">
              {referee.calls.map((call, index) => (
                <li
                  key={call.callId}
                  className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs"
                >
                  <span className="text-gray-500">#{index + 1}</span>
                  <span className="font-medium text-gray-900">Table {call.tableNumber}</span>
                  <span className="text-gray-600">{call.teamName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
