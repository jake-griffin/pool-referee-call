'use client';

interface Participant {
  id: string;
  name: string;
  joinedAt: string;
}

interface ParticipantsListProps {
  referees: Participant[];
  teams: Participant[];
}

function formatJoinedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Column({
  title,
  emptyLabel,
  people,
}: {
  title: string;
  emptyLabel: string;
  people: Participant[];
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h4 className="mb-2 flex items-center justify-between text-sm font-medium text-gray-700">
        <span>{title}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
          {people.length}
        </span>
      </h4>
      {people.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {people.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-900">{p.name}</span>
              {formatJoinedAt(p.joinedAt) && (
                <span className="text-xs text-gray-500">
                  joined {formatJoinedAt(p.joinedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Admin-only view of who has joined the tournament: the list of players/teams
 * and the list of referees.
 */
export default function ParticipantsList({ referees, teams }: ParticipantsListProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900">Participants</h3>
      <p className="mt-1 text-sm text-gray-600">
        Players and referees who have joined this tournament.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Column title="Players / Teams" emptyLabel="No players have joined yet." people={teams} />
        <Column title="Referees" emptyLabel="No referees have joined yet." people={referees} />
      </div>
    </div>
  );
}
