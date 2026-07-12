'use client';

interface MyCall {
  callId: string;
  tableNumber: number;
  status: string;
  refereeName: string | null;
  position: number | null;
  createdAt: string;
}

interface MyCallsListProps {
  myCalls: MyCall[];
  lastUpdatedAt: string;
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

function getStatusDisplay(call: MyCall): { text: string; badgeClass: string } {
  if (call.status === 'unanswered') {
    return {
      text: 'Waiting for referee...',
      badgeClass: 'bg-yellow-100 text-yellow-800',
    };
  }

  if (call.status === 'acknowledged') {
    if (call.position !== null && call.position > 1) {
      return {
        text: `Acknowledged by ${call.refereeName} — you are #${call.position} in queue`,
        badgeClass: 'bg-blue-100 text-blue-800',
      };
    }
    return {
      text: `${call.refereeName} is on their way`,
      badgeClass: 'bg-green-100 text-green-800',
    };
  }

  return { text: call.status, badgeClass: 'bg-gray-100 text-gray-800' };
}

export default function MyCallsList({ myCalls, lastUpdatedAt }: MyCallsListProps) {
  // Filter to only active calls (exclude completed)
  const activeCalls = myCalls.filter(
    (c) => c.status === 'unanswered' || c.status === 'acknowledged',
  );

  if (activeCalls.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">My Calls</h2>
        <p className="mt-3 text-sm text-gray-500">
          No active calls. Submit a call to request a referee.
        </p>
        {lastUpdatedAt && (
          <p className="mt-3 text-xs text-gray-400">
            Last updated: {formatTimestamp(lastUpdatedAt)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">My Calls</h2>

      <ul className="mt-3 space-y-3">
        {activeCalls.map((call) => {
          const { text, badgeClass } = getStatusDisplay(call);
          return (
            <li
              key={call.callId}
              className="rounded-md border border-gray-100 bg-gray-50 p-3"
            >
              <div className="flex items-start justify-between">
                <p className="text-base font-bold text-gray-900">
                  Table {call.tableNumber}
                </p>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                >
                  {call.status === 'unanswered' ? 'Waiting' : 'Acknowledged'}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{text}</p>
            </li>
          );
        })}
      </ul>

      {lastUpdatedAt && (
        <p className="mt-3 text-xs text-gray-400">
          Last updated: {formatTimestamp(lastUpdatedAt)}
        </p>
      )}
    </div>
  );
}
