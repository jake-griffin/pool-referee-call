'use client';

import { useState } from 'react';
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
  const [activeTab, setActiveTab] = useState<'new' | 'mine'>('new');

  return (
    <div>
      {/* Tab buttons */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab('new')}
          className={`min-h-[44px] min-w-[44px] flex-1 px-4 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
            activeTab === 'new'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          New Calls
          {unansweredCalls.length > 0 && (
            <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">
              {unansweredCalls.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mine')}
          className={`min-h-[44px] min-w-[44px] flex-1 px-4 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
            activeTab === 'mine'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          My Queue
          {myCalls.length > 0 && (
            <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800">
              {myCalls.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'new' && (
          <div className="space-y-3">
            {unansweredCalls.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
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
        )}

        {activeTab === 'mine' && (
          <div className="space-y-3">
            {myCalls.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                No calls in your queue.
              </p>
            ) : (
              myCalls.map((call) => (
                <CallCard
                  key={call.callId}
                  call={call}
                  mode="mine"
                  tournamentId={tournamentId}
                  onAction={onAction}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
