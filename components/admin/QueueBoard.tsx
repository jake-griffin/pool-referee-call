'use client';

import { elapsedSeconds } from '@/lib/utils/time';
import RefereeQueues from './RefereeQueues';

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

interface QueueBoardProps {
  unansweredQueue: Call[];
  refereeQueues: RefereeQueue[];
  recentActivity: Call[];
}

export default function QueueBoard({ unansweredQueue, refereeQueues, recentActivity }: QueueBoardProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Unanswered Queue */}
      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Unanswered Queue
          <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            {unansweredQueue.length}
          </span>
        </h3>
        {unansweredQueue.length === 0 ? (
          <p className="text-sm text-gray-400">No unanswered calls</p>
        ) : (
          <ul className="space-y-2">
            {unansweredQueue.map((call) => (
              <li
                key={call.callId}
                className="rounded-md border border-red-100 bg-red-50 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Table {call.tableNumber}
                  </span>
                  <span className="text-xs text-gray-500">
                    {elapsedSeconds(call.createdAt)}s ago
                  </span>
                </div>
                <p className="text-xs text-gray-600">{call.teamName}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Referee Queues */}
      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Referee Queues
        </h3>
        <RefereeQueues refereeQueues={refereeQueues} />
      </section>

      {/* Recent Activity */}
      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Recent Activity
          <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {recentActivity.length}
          </span>
        </h3>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-gray-400">No recent activity</p>
        ) : (
          <ul className="space-y-2">
            {recentActivity.map((call) => (
              <li
                key={call.callId}
                className="rounded-md border border-gray-100 bg-gray-50 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Table {call.tableNumber}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      call.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : call.status === 'cancelled'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {call.status}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  {call.teamName}
                  {call.refereeName && ` · ${call.refereeName}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
